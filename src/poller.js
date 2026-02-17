// src/poller.js
const { saveState } = require("./state");
const { sendBatchToLaravel } = require("./webhook");

function toIsoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------- LOCATIONS ----------------
function mapLocationRow(row) {
  return {
    id: Number(row.id),
    mac_id_gps: row.mac_id_gps ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    speed: row.speed != null ? Number(row.speed) : null,
    direction: row.direction != null ? Number(row.direction) : null,
    status: row.status ?? null,
    user_name: row.user_name ?? null,
    sys_time: toIsoOrNull(row.sys_time),
    datetime: toIsoOrNull(row.datetime),
    heart_time: toIsoOrNull(row.heart_time),
    processed: row.processed != null ? Boolean(row.processed) : undefined,
    trip_id: row.trip_id != null ? Number(row.trip_id) : null,
  };
}

async function fetchLocationsAfterId(db, lastId, limit) {
  const sql = `
    SELECT
      id, mac_id_gps, latitude, longitude, speed, direction, status, user_name,
      sys_time, datetime, heart_time, processed, trip_id
    FROM locations
    WHERE id > ?
    ORDER BY id ASC
    LIMIT ?
  `;
  const [rows] = await db.execute(sql, [lastId, limit]);
  return rows || [];
}

// ---------------- ALERTS ----------------
function mapAlertRow(row) {
  return {
    id: Number(row.id),
    voiture_id: row.voiture_id != null ? Number(row.voiture_id) : null,
    alert_type: row.alert_type ?? null,
    alerted_at: toIsoOrNull(row.alerted_at),
    processed: row.processed != null ? Boolean(row.processed) : undefined,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
  };
}

async function fetchAlertsAfterId(db, lastId, limit) {
  const sql = `
    SELECT
      id, voiture_id, alert_type, alerted_at, processed, latitude, longitude
    FROM alerts
    WHERE id > ?
    ORDER BY id ASC
    LIMIT ?
  `;
  const [rows] = await db.execute(sql, [lastId, limit]);
  return rows || [];
}

// ---------------- LOOP UTILS ----------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Drain pattern:
 * - on envoie batch par batch tant qu'il y a des rows
 * - si webhook OK => on avance cursor & save state
 * - si webhook FAIL => on stop (on ne consomme pas plus)
 */
async function drainStream({
  name,
  db,
  state,
  batchSize,
  fetchAfterId,
  mapRow,
  sendEvent,
  makeData,
  cursorKey, // "lastLocationId" ou "lastAlertId"
  stateFile,
  config,
  logger,
}) {
  let totalSent = 0;
  let loops = 0;

  while (true) {
    loops++;
    const lastId = Number(state[cursorKey] || 0);
    const rows = await fetchAfterId(db, lastId, batchSize);

    if (!rows.length) break;

    const items = rows.map(mapRow);
    const newLastId = Number(rows[rows.length - 1].id);

    const res = await sendBatchToLaravel({
      url: config.laravel.url,
      token: config.laravel.token,
      event: sendEvent,
      data: makeData(items),
      timeoutMs: config.http.timeoutMs,
      maxRetries: config.http.maxRetries,
      logger,
    });

    if (!res.ok) {
      logger.warn(
        { name, keepCursor: lastId, rows: rows.length },
        `[DRAIN] ${name} webhook failed -> stop draining`
      );
      return { ok: false, totalSent };
    }

    // ✅ advance cursor only on success
    state[cursorKey] = newLastId;
    await saveState(stateFile, state, logger);

    totalSent += items.length;

    // protection anti-boucle infinie si DB spam
    if (loops >= 1000) {
      logger.warn({ name, loops }, `[DRAIN] safety stop (too many loops)`);
      break;
    }

    // si on veut envoyer “ultra temps réel”, on continue direct
    // (pas de sleep ici)
  }

  return { ok: true, totalSent };
}

function startPoller({ db, state, config, logger }) {
  const batchSize = Number(config.poll.batchSize || 300);

  // ✅ quasi temps réel : petite latence quand il y a du trafic
  const hotIntervalMs = Number(config.poll.hotIntervalMs || 250);

  // ✅ quand idle : on ralentit
  const idleIntervalMs = Number(config.poll.idleIntervalMs || 1500);

  // ✅ backoff si erreur webhook
  const errorBackoffMs = Number(config.poll.errorBackoffMs || 2000);

  logger.info(
    { batchSize, hotIntervalMs, idleIntervalMs, errorBackoffMs },
    "[POLL] starting (drain loop)"
  );

  let stopped = false;
  let running = false;
  let lastWasIdle = false;

  const loop = async () => {
    if (stopped) return;

    if (running) {
      // devrait jamais arriver avec setTimeout loop, mais safety
      return void setTimeout(loop, hotIntervalMs);
    }
    running = true;

    try {
      // 1) drain locations
      const locRes = await drainStream({
        name: "locations",
        db,
        state,
        batchSize,
        fetchAfterId: fetchLocationsAfterId,
        mapRow: mapLocationRow,
        sendEvent: config.laravel.locationEvent, // ex: "location.batch"
        makeData: (items) => ({ items }),
        cursorKey: "lastLocationId",
        stateFile: config.stateFile,
        config,
        logger,
      });

      // 2) drain alerts
      const alertRes = await drainStream({
        name: "alerts",
        db,
        state,
        batchSize,
        fetchAfterId: fetchAlertsAfterId,
        mapRow: mapAlertRow,
        sendEvent: config.laravel.alertEvent, // ex: "alert.batch"
        makeData: (items) => ({ items, limit: 10 }),
        cursorKey: "lastAlertId",
        stateFile: config.stateFile,
        config,
        logger,
      });

      const sentLoc = locRes.totalSent || 0;
      const sentAlert = alertRes.totalSent || 0;

      const ok = locRes.ok && alertRes.ok;

      if (!ok) {
        lastWasIdle = false;
        logger.warn(
          { sentLoc, sentAlert },
          "[POLL] webhook error -> backoff"
        );
        return void setTimeout(loop, errorBackoffMs);
      }

      const idle = sentLoc === 0 && sentAlert === 0;

      if (!idle) {
        lastWasIdle = false;
        logger.info(
          { sentLoc, sentAlert, lastLocationId: state.lastLocationId, lastAlertId: state.lastAlertId },
          "[POLL] pushed"
        );
        return void setTimeout(loop, hotIntervalMs);
      }

      // idle
      if (!lastWasIdle) {
        logger.debug(
          { lastLocationId: state.lastLocationId, lastAlertId: state.lastAlertId },
          "[POLL] idle"
        );
      }
      lastWasIdle = true;
      return void setTimeout(loop, idleIntervalMs);
    } catch (err) {
      logger.error({ message: err.message, stack: err.stack }, "[POLL] fatal tick error");
      return void setTimeout(loop, errorBackoffMs);
    } finally {
      running = false;
    }
  };

  loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

module.exports = {
  startPoller,
};
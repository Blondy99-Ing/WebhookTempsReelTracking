// src/poller.js
const { sendBatchToLaravel } = require("./webhook");
const { saveState } = require("./state");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// =========================
// LOCATIONS
// =========================
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
  const safeLastId = toInt(lastId, 0);
  const safeLimit = Math.max(1, toInt(limit, 300));

  const sql = `
    SELECT
      id, mac_id_gps, latitude, longitude, speed, direction, status, user_name,
      sys_time, datetime, heart_time, processed, trip_id
    FROM locations
    WHERE id > ${safeLastId}
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;

  const [rows] = await db.query(sql);
  return rows || [];
}

// =========================
// ALERTS
// =========================
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
  const safeLastId = toInt(lastId, 0);
  const safeLimit = Math.max(1, toInt(limit, 300));

  const sql = `
    SELECT
      id, voiture_id, alert_type, alerted_at, processed, latitude, longitude
    FROM alerts
    WHERE id > ${safeLastId}
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;

  const [rows] = await db.query(sql);
  return rows || [];
}

// =========================
// DRAIN ONCE
// =========================
async function drainOnce({ db, state, config, logger }) {
  const batchSize = toInt(config?.poll?.batchSize, 300);
  let didWork = false;

  // 1) LOCATIONS
  const lastLocId = toInt(state?.lastLocationId, 0);
  const locRows = await fetchLocationsAfterId(db, lastLocId, batchSize);

  if (locRows.length) {
    didWork = true;

    const items = locRows.map(mapLocationRow);
    const newLastId = toInt(locRows[locRows.length - 1]?.id, lastLocId);

    const prevLocId = lastLocId;
    state.lastLocationId = newLastId;

    const res = await sendBatchToLaravel({
      url: config.laravel.url,
      token: config.laravel.token,
      event: config.laravel.locationEvent,
      data: { items },
      timeoutMs: config.http.timeoutMs,
      maxRetries: config.http.maxRetries,
      logger,
    });

    if (res?.ok) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { from: prevLocId, to: newLastId, sent: items.length },
        "[POLL] locations cursor advanced"
      );
    } else {
      state.lastLocationId = prevLocId;
      logger.warn(
        { keepLastId: prevLocId, attemptedTo: newLastId, rows: locRows.length },
        "[POLL] locations webhook failed => keep cursor"
      );
      return { didWork, hadError: true };
    }
  }

  // 2) ALERTS
  const lastAlertId = toInt(state?.lastAlertId, 0);
  const alertRows = await fetchAlertsAfterId(db, lastAlertId, batchSize);

  if (alertRows.length) {
    didWork = true;

    const items = alertRows.map(mapAlertRow);
    const newLastId = toInt(alertRows[alertRows.length - 1]?.id, lastAlertId);

    const prevAlertId = lastAlertId;
    state.lastAlertId = newLastId;

    const res = await sendBatchToLaravel({
      url: config.laravel.url,
      token: config.laravel.token,
      event: config.laravel.alertEvent,
      data: { items, limit: 10 },
      timeoutMs: config.http.timeoutMs,
      maxRetries: config.http.maxRetries,
      logger,
    });

    if (res?.ok) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { from: prevAlertId, to: newLastId, sent: items.length },
        "[POLL] alerts cursor advanced"
      );
    } else {
      state.lastAlertId = prevAlertId;
      logger.warn(
        { keepLastId: prevAlertId, attemptedTo: newLastId, rows: alertRows.length },
        "[POLL] alerts webhook failed => keep cursor"
      );
      return { didWork, hadError: true };
    }
  }

  return { didWork, hadError: false };
}

// =========================
// START
// =========================
function startPoller({ db, state, config, logger }) {
  const hot = Math.max(250, toInt(config?.poll?.hotIntervalMs, 2000));
  const idle = Math.max(250, toInt(config?.poll?.idleIntervalMs, 2000));
  const backoff = Math.max(500, toInt(config?.poll?.errorBackoffMs, 3000));
  const maxLoops = Math.max(1, toInt(config?.poll?.maxDrainLoops, 1000));

  logger.info(
    { hot, idle, backoff, maxLoops, batchSize: toInt(config?.poll?.batchSize, 300) },
    "[POLL] starting drain loop"
  );

  let running = true;

  (async () => {
    let loops = 0;

    while (running) {
      loops++;

      if (loops > maxLoops) {
        loops = 0;
        await sleep(idle);
        continue;
      }

      try {
        const { didWork, hadError } = await drainOnce({ db, state, config, logger });

        if (hadError) {
          loops = 0;
          await sleep(backoff);
          continue;
        }

        if (didWork) {
          await sleep(hot);
        } else {
          loops = 0;
          await sleep(idle);
        }
      } catch (err) {
        loops = 0;
        logger.error({ message: err.message, stack: err.stack }, "[POLL] tick error");
        await sleep(backoff);
      }
    }
  })();

  return () => {
    running = false;
  };
}

module.exports = {
  startPoller,
};
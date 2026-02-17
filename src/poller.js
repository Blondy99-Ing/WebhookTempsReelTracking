// src/poller.js
// (Fichier corrigé : suppression de db.execute + LIMIT ?, remplacement par db.query avec entiers sécurisés)

const { sendBatchToLaravel } = require("./webhook");
const { saveState } = require("./state");

// ---------------- UTILITAIRES ----------------
function toIsoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Force un entier sûr (évite NaN/undefined/float/string bizarre)
function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
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

/**
 * IMPORTANT:
 * - On évite db.execute() + LIMIT ? (source du bug "mysqld_stmt_execute" sur ton serveur)
 * - On utilise db.query() avec des entiers "sanitisés".
 */
async function fetchLocationsAfterId(db, lastId, limit) {
  const safeLastId = toInt(lastId, 0);
  const safeLimit = toInt(limit, 300);

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
  const safeLastId = toInt(lastId, 0);
  const safeLimit = toInt(limit, 300);

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

// ---------------- LOOP UTILS ----------------
async function drainStream({ db, state, config, logger }) {
  const batchSize = toInt(config?.poll?.batchSize, 300);

  // 1) LOCATIONS
  const lastLocId = toInt(state?.lastLocationId, 0);
  const locRows = await fetchLocationsAfterId(db, lastLocId, batchSize);

  if (locRows.length) {
    const items = locRows.map(mapLocationRow);
    const newLastId = toInt(locRows[locRows.length - 1]?.id, lastLocId);

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
      state.lastLocationId = newLastId;
      await saveState(config.stateFile, state, logger);
      logger.info({ newLastId, sent: items.length }, "[POLL] locations cursor advanced");
    } else {
      logger.warn({ keepLastId: lastLocId, rows: locRows.length }, "[POLL] locations webhook failed => keep cursor");
    }
  }

  // 2) ALERTS
  const lastAlertId = toInt(state?.lastAlertId, 0);
  const alertRows = await fetchAlertsAfterId(db, lastAlertId, batchSize);

  if (alertRows.length) {
    const items = alertRows.map(mapAlertRow);
    const newLastId = toInt(alertRows[alertRows.length - 1]?.id, lastAlertId);

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
      state.lastAlertId = newLastId;
      await saveState(config.stateFile, state, logger);
      logger.info({ newLastId, sent: items.length }, "[POLL] alerts cursor advanced");
    } else {
      logger.warn({ keepLastId: lastAlertId, rows: alertRows.length }, "[POLL] alerts webhook failed => keep cursor");
    }
  }
}

// ---------------- POLLER ----------------
function startPoller({ db, state, config, logger }) {
  const intervalMs = Math.max(250, toInt(config?.poll?.intervalMs, 2000));

  logger.info(
    { intervalMs, batchSize: toInt(config?.poll?.batchSize, 300) },
    "[POLL] starting"
  );

  let running = false;

  const loop = async () => {
    if (running) return;
    running = true;

    try {
      await drainStream({ db, state, config, logger });
    } catch (err) {
      logger.error({ message: err.message, stack: err.stack }, "[POLL] fatal tick error");
    } finally {
      running = false;
    }
  };

  loop();
  setInterval(loop, intervalMs);
}

module.exports = {
  startPoller,
};
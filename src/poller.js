const { sendBatchToLaravel } = require("./webhook");
const { saveState } = require("./state");

function toIsoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// --------- LOCATIONS ----------
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

// --------- ALERTS ----------
function mapAlertRow(row) {
  // On envoie le minimum nécessaire pour router côté Laravel
  return {
    id: Number(row.id),
    voiture_id: row.voiture_id != null ? Number(row.voiture_id) : null,
    // si tu as mac_id_gps dans alerts tu peux l'ajouter, sinon voiture_id suffit
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

// --------- POLLER ----------
function startPoller({ db, state, config, logger }) {
  const intervalMs = Number(config.poll.intervalMs || 2000);
  const batchSize = Number(config.poll.batchSize || 300);

  logger.info({ intervalMs, batchSize }, "[POLL] starting");

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      // 1) LOCATIONS
      const lastLocId = Number(state.lastLocationId || 0);
      const locRows = await fetchLocationsAfterId(db, lastLocId, batchSize);

      if (locRows.length) {
        const items = locRows.map(mapLocationRow);
        const newLastId = Number(locRows[locRows.length - 1].id);

        const res = await sendBatchToLaravel({
          url: config.laravel.url,
          token: config.laravel.token,
          event: config.laravel.locationEvent,
          data: { items },
          timeoutMs: config.http.timeoutMs,
          maxRetries: config.http.maxRetries,
          logger,
        });

        if (res.ok) {
          state.lastLocationId = newLastId;
          await saveState(config.stateFile, state, logger);
          logger.info({ newLastId, sent: items.length }, "[POLL] locations cursor advanced");
        } else {
          logger.warn({ keepLastId: lastLocId, rows: locRows.length }, "[POLL] locations webhook failed => keep cursor");
        }
      }

      // 2) ALERTS
      const lastAlertId = Number(state.lastAlertId || 0);
      const alertRows = await fetchAlertsAfterId(db, lastAlertId, batchSize);

      if (alertRows.length) {
        const items = alertRows.map(mapAlertRow);
        const newLastId = Number(alertRows[alertRows.length - 1].id);

        const res = await sendBatchToLaravel({
          url: config.laravel.url,
          token: config.laravel.token,
          event: config.laravel.alertEvent,
          data: { items, limit: 10 },
          timeoutMs: config.http.timeoutMs,
          maxRetries: config.http.maxRetries,
          logger,
        });

        if (res.ok) {
          state.lastAlertId = newLastId;
          await saveState(config.stateFile, state, logger);
          logger.info({ newLastId, sent: items.length }, "[POLL] alerts cursor advanced");
        } else {
          logger.warn({ keepLastId: lastAlertId, rows: alertRows.length }, "[POLL] alerts webhook failed => keep cursor");
        }
      }
    } catch (err) {
      logger.error({ message: err.message, stack: err.stack }, "[POLL] error");
    } finally {
      running = false;
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

module.exports = {
  startPoller,
};
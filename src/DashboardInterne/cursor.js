// src/DashboardInterne/cursor.js
async function getMaxId(db, table) {
  const [rows] = await db.execute(`SELECT MAX(id) as maxId FROM ${table}`);
  return Number(rows?.[0]?.maxId || 0);
}

async function syncCursorsWithDb({ db, state, logger, startFromNow = true }) {
  let changed = false;

  const maxLocationId = await getMaxId(db, "locations");
  const maxAlertId = await getMaxId(db, "alerts");

  logger.info({ maxLocationId, maxAlertId }, "[DASH-INTERNE][CURSOR] DB max ids");

  // LOCATIONS
  if (!state.lastLocationId || state.lastLocationId === 0) {
    if (startFromNow) {
      state.lastLocationId = maxLocationId;
      changed = true;
      logger.warn("[DASH-INTERNE][CURSOR] lastLocationId was 0 → start from NOW");
    }
  } else if (state.lastLocationId > maxLocationId) {
    state.lastLocationId = maxLocationId;
    changed = true;
    logger.warn("[DASH-INTERNE][CURSOR] lastLocationId > DB max → reset");
  }

  // ALERTS
  if (!state.lastAlertId || state.lastAlertId === 0) {
    if (startFromNow) {
      state.lastAlertId = maxAlertId;
      changed = true;
      logger.warn("[DASH-INTERNE][CURSOR] lastAlertId was 0 → start from NOW");
    }
  } else if (state.lastAlertId > maxAlertId) {
    state.lastAlertId = maxAlertId;
    changed = true;
    logger.warn("[DASH-INTERNE][CURSOR] lastAlertId > DB max → reset");
  }

  return changed;
}

module.exports = { syncCursorsWithDb };
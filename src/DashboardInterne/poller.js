const { refreshDashboard } = require("./webhook");
const { saveState } = require("./state");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function fetchLocationsAfterId(db, lastId, limit) {
  const safeLastId = toInt(lastId, 0);
  const safeLimit = Math.max(1, toInt(limit, 300));

  const sql = `
    SELECT id
    FROM locations
    WHERE id > ${safeLastId}
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;

  const [rows] = await db.query(sql);
  return rows || [];
}

async function fetchAlertsAfterId(db, lastId, limit) {
  const safeLastId = toInt(lastId, 0);
  const safeLimit = Math.max(1, toInt(limit, 300));

  const sql = `
    SELECT id
    FROM alerts
    WHERE id > ${safeLastId}
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;

  const [rows] = await db.query(sql);
  return rows || [];
}

async function triggerRefresh({ config, logger, what }) {
  return refreshDashboard({
    url: config.dashboard.url,
    secret: config.dashboard.secret,
    what,
    timeoutMs: config.http.timeoutMs,
    maxRetries: config.http.maxRetries,
    logger,
  });
}

async function drainOnce({ db, state, config, logger }) {
  const batchSize = toInt(config?.poll?.batchSize, 300);
  let didWork = false;

  const lastLocId = toInt(state?.lastLocationId, 0);
  const locRows = await fetchLocationsAfterId(db, lastLocId, batchSize);

  if (locRows.length) {
    didWork = true;

    const newLastId = toInt(locRows[locRows.length - 1]?.id, lastLocId);
    const prevLocId = lastLocId;
    state.lastLocationId = newLastId;

    const fleetRes = await triggerRefresh({ config, logger, what: "fleet" });
    const statsRes = await triggerRefresh({ config, logger, what: "stats" });

    if (fleetRes?.ok && statsRes?.ok) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { from: prevLocId, to: newLastId, count: locRows.length },
        "[DASH-INTERNE][POLL] locations processed"
      );
    } else {
      state.lastLocationId = prevLocId;
      logger.warn(
        { keepLastId: prevLocId, attemptedTo: newLastId, rows: locRows.length },
        "[DASH-INTERNE][POLL] location refresh failed => keep cursor"
      );
      return { didWork, hadError: true };
    }
  }

  const lastAlertId = toInt(state?.lastAlertId, 0);
  const alertRows = await fetchAlertsAfterId(db, lastAlertId, batchSize);

  if (alertRows.length) {
    didWork = true;

    const newLastId = toInt(alertRows[alertRows.length - 1]?.id, lastAlertId);
    const prevAlertId = lastAlertId;
    state.lastAlertId = newLastId;

    // Pour chaque nouvelle alerte, appelle alert_new individuellement.
    // Laravel charge l'alerte depuis la DB et appelle publishNewAlertEvent()
    // qui déclenche le son + la modale sur le dashboard live.
    let alertNewOk = true;
    for (const row of alertRows) {
      const res = await refreshDashboard({
        url: config.dashboard.url,
        secret: config.dashboard.secret,
        what: "alert_new",
        alertId: toInt(row.id),
        timeoutMs: config.http.timeoutMs,
        maxRetries: config.http.maxRetries,
        logger,
      });
      if (!res?.ok) {
        logger.warn(
          { alert_id: row.id },
          "[DASH-INTERNE][POLL] alert_new failed for alert"
        );
        alertNewOk = false;
      }
    }

    // Rebuild la liste + stats après avoir notifié chaque alerte
    const alertsRes = await triggerRefresh({ config, logger, what: "alerts" });
    const statsRes  = await triggerRefresh({ config, logger, what: "stats" });

    if (alertsRes?.ok && statsRes?.ok) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { from: prevAlertId, to: newLastId, count: alertRows.length, alertNewOk },
        "[DASH-INTERNE][POLL] alerts processed"
      );
    } else {
      state.lastAlertId = prevAlertId;
      logger.warn(
        { keepLastId: prevAlertId, attemptedTo: newLastId, rows: alertRows.length },
        "[DASH-INTERNE][POLL] alerts refresh failed => keep cursor"
      );
      return { didWork, hadError: true };
    }
  }

  return { didWork, hadError: false };
}

function startPoller({ db, state, config, logger }) {
  const hot = Math.max(250, toInt(config?.poll?.hotIntervalMs, 1000));
  const idle = Math.max(250, toInt(config?.poll?.idleIntervalMs, 2000));
  const backoff = Math.max(500, toInt(config?.poll?.errorBackoffMs, 3000));
  const maxLoops = Math.max(1, toInt(config?.poll?.maxDrainLoops, 1000));

  logger.info(
    { hot, idle, backoff, maxLoops, batchSize: toInt(config?.poll?.batchSize, 300) },
    "[DASH-INTERNE][POLL] starting drain loop"
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
        logger.error(
          { message: err.message, stack: err.stack },
          "[DASH-INTERNE][POLL] tick error"
        );
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
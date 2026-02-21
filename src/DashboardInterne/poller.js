// src/DashboardInterne/poller.js
const { refreshDashboard } = require("./webhook");
const { saveState } = require("./state");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// -------- DB FETCH (IDs only) --------
async function fetchNewIdsAfter(db, table, lastId, limit) {
  const safeLastId = toInt(lastId, 0);
  const safeLimit = Math.max(1, toInt(limit, 300));

  const sql = `
    SELECT id
    FROM ${table}
    WHERE id > ${safeLastId}
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;

  const [rows] = await db.query(sql);
  return rows || [];
}

// -------- DRAIN ONCE --------
async function drainOnce({ db, state, config, logger }) {
  const batchSize = toInt(config?.poll?.batchSize, 300);

  let didWork = false;

  // 1) LOCATIONS => refresh fleet
  const lastLocId = toInt(state?.lastLocationId, 0);
  const locRows = await fetchNewIdsAfter(db, "locations", lastLocId, batchSize);

  if (locRows.length) {
    didWork = true;

    const newLastId = toInt(locRows[locRows.length - 1]?.id, lastLocId);

    const prevLocId = lastLocId;
    state.lastLocationId = newLastId;

    const res = await refreshDashboard({
      url: config.dashboard.url,
      secret: config.dashboard.secret,
      what: "fleet",
      timeoutMs: config.http.timeoutMs,
      maxRetries: config.http.maxRetries,
      logger,
    });

    if (res?.ok) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { from: prevLocId, to: newLastId, rows: locRows.length, what: "fleet" },
        "[DASH-INTERNE][POLL] locations -> refresh OK"
      );
    } else {
      state.lastLocationId = prevLocId;
      logger.warn(
        { keepLastId: prevLocId, attemptedTo: newLastId, rows: locRows.length },
        "[DASH-INTERNE][POLL] refresh fleet failed => keep cursor"
      );
      return { didWork, hadError: true };
    }
  }

  // 2) ALERTS => refresh alerts
  const lastAlertId = toInt(state?.lastAlertId, 0);
  const alertRows = await fetchNewIdsAfter(db, "alerts", lastAlertId, batchSize);

  if (alertRows.length) {
    didWork = true;

    const newLastId = toInt(alertRows[alertRows.length - 1]?.id, lastAlertId);

    const prevAlertId = lastAlertId;
    state.lastAlertId = newLastId;

    const res = await refreshDashboard({
      url: config.dashboard.url,
      secret: config.dashboard.secret,
      what: "alerts",
      timeoutMs: config.http.timeoutMs,
      maxRetries: config.http.maxRetries,
      logger,
    });

    if (res?.ok) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { from: prevAlertId, to: newLastId, count: alertRows.length, what: "alerts" },
        "[DASH-INTERNE][POLL] alerts(new) -> refresh alerts OK"
      );
    } else {
      state.lastAlertId = prevAlertId;
      logger.warn(
        { keepLastId: prevAlertId, attemptedTo: newLastId, count: alertRows.length },
        "[DASH-INTERNE][POLL] refresh alerts failed => keep cursor"
      );
      return { didWork, hadError: true };
    }
  }

  return { didWork, hadError: false };
}

// -------- START --------
function startPoller({ db, state, config, logger }) {
  const hot = Math.max(50, toInt(config?.poll?.hotIntervalMs, 250));
  const idle = Math.max(250, toInt(config?.poll?.idleIntervalMs, 1500));
  const backoff = Math.max(500, toInt(config?.poll?.errorBackoffMs, 2000));
  const maxLoops = Math.max(1, toInt(config?.poll?.maxDrainLoops, 1000));

  logger.info({ hot, idle, backoff, maxLoops }, "[DASH-INTERNE][POLL] starting (refresh mode)");

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

        if (didWork) await sleep(hot);
        else {
          loops = 0;
          await sleep(idle);
        }
      } catch (err) {
        loops = 0;
        logger.error({ message: err.message, stack: err.stack }, "[DASH-INTERNE][POLL] tick error");
        await sleep(backoff);
      }
    }
  })();

  return () => {
    running = false;
  };
}

module.exports = { startPoller };
// src/DashboardInterne/index.js
const pino = require("pino");

const config = require("./config");
const { connectDb } = require("../db"); // ✅ on réutilise le db.js de la racine (src/db.js)
const { loadState, saveState } = require("./state");
const { startPoller } = require("./poller");
const { syncCursorsWithDb } = require("../cursor"); // ✅ on réutilise cursor.js racine

(async () => {
  const logger = pino({
    level: config.logLevel || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l" },
          }
        : undefined,
  });

  try {
    logger.info(
      {
        mysql: config.mysql,
        dashboardUrl: config.dashboard?.url,
        stateFile: config.stateFile,
        hot: config.poll.hotIntervalMs,
        idle: config.poll.idleIntervalMs,
      },
      "[DASH-INTERNE] boot"
    );

    // 1) DB
    const db = await connectDb(config.mysql, logger);
    logger.info("[DASH-INTERNE][DB] connected");

    // 2) State
    const state = await loadState(config.stateFile, logger);

    // 3) Normalize cursors (startFromNow = true)
    const changed = await syncCursorsWithDb({
      db,
      state,
      logger,
      startFromNow: true,
    });

    if (changed) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        { lastLocationId: state.lastLocationId, lastAlertId: state.lastAlertId },
        "[DASH-INTERNE][STATE] normalized & saved"
      );
    }

    // 4) Start poller (refresh mode)
    startPoller({ db, state, config, logger });

    logger.info("[DASH-INTERNE] running");
  } catch (err) {
    console.error("FATAL", err);
    process.exit(1);
  }
})();
const pino = require("pino");

const config = require("./config");
const { connectDb } = require("../db");
const { loadState, saveState } = require("./state");
const { startPoller } = require("./poller");
const { syncCursorsWithDb } = require("./cursor");

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
        mysql: {
          host: config.mysql.host,
          port: config.mysql.port,
          database: config.mysql.database,
          user: config.mysql.user,
        },
        dashboardUrl: config.dashboard.url,
        stateFile: config.stateFile,
        hot: config.poll.hotIntervalMs,
        idle: config.poll.idleIntervalMs,
      },
      "[DASH-INTERNE] boot"
    );

    const db = await connectDb(config.mysql, logger);
    logger.info("[DASH-INTERNE][DB] connected");

    const state = await loadState(config.stateFile, logger);

    const changed = await syncCursorsWithDb({
      db,
      state,
      logger,
      startFromNow: true,
    });

    if (changed) {
      await saveState(config.stateFile, state, logger);
      logger.info(
        {
          lastLocationId: state.lastLocationId,
          lastAlertId: state.lastAlertId,
        },
        "[DASH-INTERNE][STATE] normalized & saved"
      );
    }

    startPoller({ db, state, config, logger });

    logger.info("[DASH-INTERNE] running");
  } catch (err) {
    console.error("FATAL", err);
    process.exit(1);
  }
})();

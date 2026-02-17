// src/index.js
const pino = require("pino");
const config = require("./config");

const { connectDb } = require("./db");
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
            options: {
              colorize: true,
              translateTime: "HH:MM:ss.l",
            },
          }
        : undefined,
  });

  try {
    logger.info(
      {
        mysql: config.mysql,
        laravelUrl: config.laravel.url,
        locationEvent: config.laravel.locationEvent,
        alertEvent: config.laravel.alertEvent,
        stateFile: config.stateFile,
      },
      "[BRIDGE] boot"
    );

    const db = await connectDb(config.mysql, logger);
    logger.info("[DB] connected");

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
        "[STATE] normalized & saved"
      );
    }

    startPoller({
      db,
      state,
      config,
      logger,
    });

    logger.info("[BRIDGE] running");
  } catch (err) {
    console.error("FATAL", err);
    process.exit(1);
  }
})();
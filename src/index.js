// src/index.js
const pino = require("pino");
const config = require("./config");

const { connectDb, closeDb } = require("./db");
const { loadState, saveState } = require("./state");
const { startPoller } = require("./poller");
const { syncCursorsWithDb } = require("./cursor");
const { acquireSingleInstanceLock } = require("./lock");

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

  let db = null;
  let stopPoller = null;
  let releaseLock = null;
  let shuttingDown = false;

  async function shutdown(code = 0, reason = "shutdown") {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ reason }, "[BRIDGE] shutting down");

    try {
      if (typeof stopPoller === "function") {
        stopPoller();
      }

      await closeDb(db, logger);
    } finally {
      if (typeof releaseLock === "function") {
        releaseLock();
      }

      process.exit(code);
    }
  }

  process.on("SIGINT", () => shutdown(0, "SIGINT"));
  process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ message: err.message, stack: err.stack }, "[BRIDGE] uncaught exception");
    shutdown(1, "uncaughtException");
  });
  process.on("unhandledRejection", (err) => {
    logger.fatal(
      { message: err?.message || String(err), stack: err?.stack },
      "[BRIDGE] unhandled rejection"
    );
    shutdown(1, "unhandledRejection");
  });

  try {
    logger.info(
      {
        mysql: {
          host: config.mysql.host,
          port: config.mysql.port,
          database: config.mysql.database,
          user: config.mysql.user,
          connectionLimit: config.mysql.connectionLimit,
        },
        laravelUrl: config.laravel.url,
        locationEvent: config.laravel.locationEvent,
        alertEvent: config.laravel.alertEvent,
        stateFile: config.stateFile,
        lockFile: config.lockFile,
      },
      "[BRIDGE] boot"
    );

    releaseLock = acquireSingleInstanceLock(config.lockFile, logger, "BRIDGE");

    db = await connectDb(config.mysql, logger);

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

    stopPoller = startPoller({
      db,
      state,
      config,
      logger,
    });

    logger.info("[BRIDGE] running");
  } catch (err) {
    logger.fatal({ message: err.message, stack: err.stack }, "[BRIDGE] fatal boot error");

    if (typeof releaseLock === "function") {
      releaseLock();
    }

    process.exit(1);
  }
})();

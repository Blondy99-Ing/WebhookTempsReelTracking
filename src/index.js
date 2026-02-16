// src/index.js
const pino = require("pino");
const config = require("./config");

const { connectDb } = require("./db");
const { loadState } = require("./state");
const { startPoller } = require("./poller");

(async () => {
  // ✅ logger très tôt
  const logger = pino({
    level: config.logLevel || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
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
        laravelUrl: config.laravel.url,
        laravelEvent: config.laravel.event,
        poll: config.poll,
        http: config.http,
        stateFile: config.stateFile,
      },
      "[BRIDGE] boot"
    );

    // ✅ DB
    const db = await connectDb(config.mysql, logger);
    logger.info("[DB] Connected");

    // ✅ State
    const state = await loadState(config.stateFile, logger);
    logger.info({ stateFile: config.stateFile, lastLocationId: state.lastLocationId ?? null }, "[STATE] loaded");

    // ✅ Start poller
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
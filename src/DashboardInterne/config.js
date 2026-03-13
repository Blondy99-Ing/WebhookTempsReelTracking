// src/config.js
require("dotenv").config();

function must(name, fallback = null) {
  const v = process.env[name] ?? fallback;
  if (v === null || v === undefined || v === "") {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
}

function int(name, fallback) {
  const raw = process.env[name] ?? fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number env var: ${name}=${raw}`);
  return n;
}

module.exports = {
  mysql: {
    host: must("MYSQL_HOST"),
    port: int("MYSQL_PORT", 3306),
    user: must("MYSQL_USER"),
    password: must("MYSQL_PASSWORD"),
    database: must("MYSQL_DATABASE"),
  },

  laravel: {
    url: must("LARAVEL_WEBHOOK_URL"),
    token: must("LARAVEL_WEBHOOK_TOKEN"),
    locationEvent: process.env.WEBHOOK_LOCATION_EVENT || "location.batch",
    alertEvent: process.env.WEBHOOK_ALERT_EVENT || "alert.batch",
  },

  poll: {
    batchSize: int("BATCH_SIZE", 300),

    // ✅ ce soir : on fixe un rythme stable à 2 secondes
    hotIntervalMs: int("POLL_HOT_INTERVAL_MS", 2000),
    idleIntervalMs: int("POLL_IDLE_INTERVAL_MS", 2000),

    // en cas d’erreur
    errorBackoffMs: int("POLL_ERROR_BACKOFF_MS", 3000),

    maxDrainLoops: int("POLL_MAX_DRAIN_LOOPS", 1000),
  },

  http: {
    timeoutMs: int("HTTP_TIMEOUT_MS", 15000),
    maxRetries: int("HTTP_MAX_RETRIES", 3),
  },

  stateFile: process.env.STATE_FILE || "./state/state.json",
  logLevel: process.env.LOG_LEVEL || "info",
};
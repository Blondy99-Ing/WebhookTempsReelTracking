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

    // ✅ events attendus par Laravel
    locationEvent: process.env.WEBHOOK_LOCATION_EVENT || "location.batch",
    alertEvent: process.env.WEBHOOK_ALERT_EVENT || "alert.batch",
  },

  // ✅ Solution 1: drain loop (pas de setInterval fixe)
  poll: {
    batchSize: int("BATCH_SIZE", 300),

    // 🔥 quand il y a du trafic (quasi temps réel)
    hotIntervalMs: int("POLL_HOT_INTERVAL_MS", 250),

    // 💤 quand il n’y a rien à envoyer
    idleIntervalMs: int("POLL_IDLE_INTERVAL_MS", 1500),

    // ⚠️ quand webhook down / erreurs
    errorBackoffMs: int("POLL_ERROR_BACKOFF_MS", 2000),

    // (optionnel) protection: max loops par tick (si ta DB spam trop)
    maxDrainLoops: int("POLL_MAX_DRAIN_LOOPS", 1000),
  },

  http: {
    timeoutMs: int("HTTP_TIMEOUT_MS", 15000),
    maxRetries: int("HTTP_MAX_RETRIES", 3),
  },

  stateFile: process.env.STATE_FILE || "./state/state.json",
  logLevel: process.env.LOG_LEVEL || "info",
};
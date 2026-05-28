// src/db.js
// Robust MySQL connection helper.
// We intentionally keep the same query/execute interface used by the pollers,
// but use a pool instead of a single connection so transient MySQL disconnects
// do not permanently stop the bridge.

const mysql = require("mysql2/promise");

async function connectDb(mysqlConfig, logger) {
  const pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    waitForConnections: true,
    connectionLimit: Number(mysqlConfig.connectionLimit || 5),
    queueLimit: 0,
    dateStrings: false,
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

  // Initial ping. If this fails, boot should fail loudly.
  await pool.execute("SELECT 1");

  logger?.info?.(
    {
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      database: mysqlConfig.database,
      user: mysqlConfig.user,
      connectionLimit: Number(mysqlConfig.connectionLimit || 5),
    },
    "[DB] pool connected"
  );

  return pool;
}

async function closeDb(db, logger) {
  if (!db || typeof db.end !== "function") return;

  try {
    await db.end();
    logger?.info?.("[DB] pool closed");
  } catch (err) {
    logger?.warn?.({ message: err.message }, "[DB] pool close failed");
  }
}

module.exports = {
  connectDb,
  closeDb,
};

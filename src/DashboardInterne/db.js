// src/DashboardInterne/db.js
const mysql = require("mysql2/promise");

async function connectDb(mysqlConfig, logger) {
  const conn = await mysql.createConnection({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    dateStrings: false,
    timezone: "Z",
  });

  await conn.execute("SELECT 1");
  logger?.info?.("[DASH-INTERNE][DB] Connected");
  return conn;
}

module.exports = { connectDb };
const pino = require("pino");

function createLogger(level = "info") {
  const isPretty = process.stdout.isTTY;

  return pino(
    {
      level,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    isPretty
      ? require("pino-pretty")({
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
        })
      : undefined
  );
}

module.exports = { createLogger };
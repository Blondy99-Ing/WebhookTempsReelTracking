// src/lock.js
// File-based single-instance lock.
// This prevents accidentally running two bridge instances against the same
// state file, which would duplicate webhooks and corrupt cursor progression.

const fs = require("fs");
const path = require("path");

function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function readExistingLock(lockFile) {
  try {
    const raw = fs.readFileSync(lockFile, "utf-8");
    return JSON.parse(raw || "{}");
  } catch (_) {
    return null;
  }
}

function acquireSingleInstanceLock(lockFile, logger, label = "BRIDGE") {
  const full = path.resolve(lockFile);
  fs.mkdirSync(path.dirname(full), { recursive: true });

  if (fs.existsSync(full)) {
    const existing = readExistingLock(full);
    const existingPid = Number(existing?.pid || 0);

    if (isProcessAlive(existingPid)) {
      throw new Error(
        `[${label}] Another instance is already running with pid=${existingPid}. ` +
        `Lock file: ${full}`
      );
    }

    logger?.warn?.(
      { lockFile: full, existingPid },
      `[${label}] stale lock detected, removing it`
    );
    fs.unlinkSync(full);
  }

  const payload = JSON.stringify(
    {
      pid: process.pid,
      label,
      cwd: process.cwd(),
      startedAt: new Date().toISOString(),
    },
    null,
    2
  );

  const fd = fs.openSync(full, "wx");
  try {
    fs.writeFileSync(fd, payload, "utf-8");
  } finally {
    fs.closeSync(fd);
  }

  logger?.info?.({ lockFile: full, pid: process.pid }, `[${label}] lock acquired`);

  let released = false;

  return function releaseLock() {
    if (released) return;
    released = true;

    try {
      const existing = readExistingLock(full);
      if (Number(existing?.pid || 0) === process.pid) {
        fs.unlinkSync(full);
        logger?.info?.({ lockFile: full }, `[${label}] lock released`);
      }
    } catch (err) {
      logger?.warn?.({ lockFile: full, message: err.message }, `[${label}] lock release failed`);
    }
  };
}

module.exports = {
  acquireSingleInstanceLock,
};

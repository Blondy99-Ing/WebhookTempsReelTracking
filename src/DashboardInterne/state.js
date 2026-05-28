// src/DashboardInterne/state.js
// Same robust state persistence as the partner bridge, with a separate state file.

const fs = require("fs");
const path = require("path");

function normalizeState(json = {}) {
  return {
    lastLocationId: Number(json.lastLocationId ?? json.last_location_id ?? 0) || 0,
    lastAlertId: Number(json.lastAlertId ?? json.last_alert_id ?? 0) || 0,
  };
}

async function readJsonFile(file) {
  const raw = await fs.promises.readFile(file, "utf-8");
  return JSON.parse(raw || "{}");
}

async function loadState(stateFile, logger) {
  const full = path.resolve(stateFile);
  const backup = `${full}.bak`;

  if (!fs.existsSync(full)) {
    logger?.warn?.({ stateFile: full }, "[DASH-INTERNE][STATE] file not found, starting with empty cursor");
    return { lastLocationId: 0, lastAlertId: 0 };
  }

  try {
    const json = await readJsonFile(full);
    return normalizeState(json);
  } catch (err) {
    logger?.error?.(
      { stateFile: full, message: err.message },
      "[DASH-INTERNE][STATE] primary state file is unreadable"
    );

    if (fs.existsSync(backup)) {
      try {
        const json = await readJsonFile(backup);
        const state = normalizeState(json);
        logger?.warn?.(
          { backup, state },
          "[DASH-INTERNE][STATE] recovered cursor from backup state file"
        );
        return state;
      } catch (backupErr) {
        logger?.error?.(
          { backup, message: backupErr.message },
          "[DASH-INTERNE][STATE] backup state file is also unreadable"
        );
      }
    }

    throw new Error(
      `DashboardInterne state file is corrupted and no valid backup exists: ${full}. ` +
      `Fix the state file manually instead of silently skipping data.`
    );
  }
}

async function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  const handle = await fs.promises.open(tmp, "w");

  try {
    await handle.writeFile(content, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.promises.rename(tmp, file);
}

async function saveState(stateFile, state, logger) {
  const full = path.resolve(stateFile);
  const backup = `${full}.bak`;

  const payload = JSON.stringify(
    {
      lastLocationId: Number(state.lastLocationId || 0),
      lastAlertId: Number(state.lastAlertId || 0),
      savedAt: new Date().toISOString(),
    },
    null,
    2
  );

  try {
    if (fs.existsSync(full)) {
      try {
        const current = await fs.promises.readFile(full, "utf-8");
        JSON.parse(current || "{}");
        await writeFileAtomic(backup, current);
      } catch (backupErr) {
        logger?.warn?.(
          { message: backupErr.message },
          "[DASH-INTERNE][STATE] could not refresh backup before saving state"
        );
      }
    }

    await writeFileAtomic(full, payload);
  } catch (err) {
    logger?.error?.({ stateFile: full, message: err.message }, "[DASH-INTERNE][STATE] save error");
    throw err;
  }
}

module.exports = { loadState, saveState };

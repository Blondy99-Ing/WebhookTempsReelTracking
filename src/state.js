// src/state.js
// Robust state persistence for bridge cursors.
// Why: if state.json is corrupted during a server crash, silently resetting to 0
// can make the bridge skip data when startFromNow=true. We therefore write the
// file atomically and keep a .bak copy of the last valid state.

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
    logger?.warn?.({ stateFile: full }, "[STATE] file not found, starting with empty cursor");
    return { lastLocationId: 0, lastAlertId: 0 };
  }

  try {
    const json = await readJsonFile(full);
    return normalizeState(json);
  } catch (err) {
    logger?.error?.(
      { stateFile: full, message: err.message },
      "[STATE] primary state file is unreadable"
    );

    if (fs.existsSync(backup)) {
      try {
        const json = await readJsonFile(backup);
        const state = normalizeState(json);
        logger?.warn?.(
          { backup, state },
          "[STATE] recovered cursor from backup state file"
        );
        return state;
      } catch (backupErr) {
        logger?.error?.(
          { backup, message: backupErr.message },
          "[STATE] backup state file is also unreadable"
        );
      }
    }

    throw new Error(
      `State file is corrupted and no valid backup exists: ${full}. ` +
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
        // Only keep a backup if the current file is valid JSON.
        JSON.parse(current || "{}");
        await writeFileAtomic(backup, current);
      } catch (backupErr) {
        logger?.warn?.(
          { message: backupErr.message },
          "[STATE] could not refresh backup before saving state"
        );
      }
    }

    await writeFileAtomic(full, payload);
  } catch (err) {
    logger?.error?.({ stateFile: full, message: err.message }, "[STATE] save error");
    throw err;
  }
}

module.exports = {
  loadState,
  saveState,
};

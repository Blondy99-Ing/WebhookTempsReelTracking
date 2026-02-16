const fs = require("fs");
const path = require("path");

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
}

async function loadState(stateFile, logger) {
  try {
    const full = path.resolve(stateFile);
    await ensureDir(path.dirname(full));

    if (!fs.existsSync(full)) {
      const init = { lastLocationId: 0, lastAlertId: 0 };
      await fs.promises.writeFile(full, JSON.stringify(init, null, 2), "utf-8");
      return init;
    }

    const raw = await fs.promises.readFile(full, "utf-8");
    const state = JSON.parse(raw || "{}");

    state.lastLocationId = Number(state.lastLocationId || 0);
    state.lastAlertId = Number(state.lastAlertId || 0);

    return state;
  } catch (err) {
    logger?.warn?.({ message: err.message }, "[STATE] load failed => fallback");
    return { lastLocationId: 0, lastAlertId: 0 };
  }
}

async function saveState(stateFile, state, logger) {
  const full = path.resolve(stateFile);
  await ensureDir(path.dirname(full));
  await fs.promises.writeFile(full, JSON.stringify(state, null, 2), "utf-8");
  logger?.debug?.({ stateFile }, "[STATE] saved");
}

module.exports = {
  loadState,
  saveState,
};
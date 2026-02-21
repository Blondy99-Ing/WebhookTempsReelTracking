// src/DashboardInterne/state.js
const fs = require("fs");
const path = require("path");

async function loadState(stateFile, logger) {
  const full = path.resolve(stateFile);

  try {
    if (!fs.existsSync(full)) {
      logger?.warn?.({ stateFile: full }, "[DASH-INTERNE][STATE] file not found, creating new one");
      return {
        lastLocationId: 0,
        lastAlertId: 0,
        lastAlertUpdatedAt: null, // 👈 nouveau
      };
    }

    const raw = await fs.promises.readFile(full, "utf-8");
    const json = JSON.parse(raw || "{}");

    const lastLocationId = Number(json.lastLocationId ?? json.last_location_id ?? 0) || 0;
    const lastAlertId = Number(json.lastAlertId ?? json.last_alert_id ?? 0) || 0;

    // ISO string ou null
    const lastAlertUpdatedAt =
      typeof (json.lastAlertUpdatedAt ?? json.last_alert_updated_at) === "string"
        ? (json.lastAlertUpdatedAt ?? json.last_alert_updated_at)
        : null;

    return { lastLocationId, lastAlertId, lastAlertUpdatedAt };
  } catch (err) {
    logger?.error?.({ err }, "[DASH-INTERNE][STATE] load error");
    return { lastLocationId: 0, lastAlertId: 0, lastAlertUpdatedAt: null };
  }
}

async function saveState(stateFile, state, logger) {
  const full = path.resolve(stateFile);

  try {
    await fs.promises.writeFile(
      full,
      JSON.stringify(
        {
          lastLocationId: Number(state.lastLocationId || 0),
          lastAlertId: Number(state.lastAlertId || 0),
          lastAlertUpdatedAt: state.lastAlertUpdatedAt || null, // 👈 nouveau
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch (err) {
    logger?.error?.({ err }, "[DASH-INTERNE][STATE] save error");
  }
}

module.exports = { loadState, saveState };
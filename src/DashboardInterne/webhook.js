const axios = require("axios");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRetryAfterMs(headers) {
  const ra = headers?.["retry-after"];
  if (!ra) return null;
  const n = Number(ra);
  if (!Number.isNaN(n)) return n * 1000;
  return null;
}

async function refreshDashboard({
  url,
  secret,
  what,
  alertId = null,
  timeoutMs = 15000,
  maxRetries = 3,
  logger,
}) {
  let attempt = 0;
  const retries = Math.max(1, Number(maxRetries || 1));

  while (attempt < retries) {
    attempt++;

    try {
      // Construit le body : ajoute alert_id si fourni (cas alert_new)
      const body = { what: what || "all" };
      if (alertId != null) body.alert_id = alertId;

      const res = await axios.post(
        url,
        body,
        {
          timeout: timeoutMs,
          headers: {
            "Content-Type": "application/json",
            "X-INTERNAL-SECRET": secret || "",
          },
          validateStatus: () => true,
        }
      );

      const status = res.status;

      if (status >= 200 && status < 300) {
        logger?.info?.({ status, what }, "[DASH-INTERNE][REFRESH] ok");
        return { ok: true, status, data: res.data };
      }

      if (status === 429) {
        const retryAfterMs = getRetryAfterMs(res.headers) || 2000;
        logger?.warn?.(
          { attempt, retries, status, retryAfterMs, what },
          "[DASH-INTERNE][REFRESH] rate limited"
        );
        await sleep(retryAfterMs);
        continue;
      }

      logger?.warn?.(
        { attempt, retries, status, what, data: res.data },
        "[DASH-INTERNE][REFRESH] failed"
      );

      if (status >= 400 && status < 500) {
        return { ok: false, status, data: res.data };
      }

      await sleep(1000);
    } catch (err) {
      logger?.warn?.(
        { attempt, retries, what, message: err.message },
        "[DASH-INTERNE][REFRESH] exception"
      );
      await sleep(1000);
    }
  }

  logger?.error?.(
    { what, message: "Max retries exceeded" },
    "[DASH-INTERNE][REFRESH] giving up"
  );

  return { ok: false, status: null };
}

module.exports = { refreshDashboard };
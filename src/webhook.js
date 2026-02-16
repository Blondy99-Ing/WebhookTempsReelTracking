const axios = require("axios");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRetryAfterMs(headers) {
  const ra = headers?.["retry-after"];
  if (!ra) return null;
  const n = Number(ra);
  if (!isNaN(n)) return n * 1000;
  return null;
}

async function sendBatchToLaravel({ url, token, event, data, timeoutMs, maxRetries, logger }) {
  const payload = { event, data };

  let attempt = 0;
  while (attempt < (maxRetries || 1)) {
    attempt++;

    try {
      const res = await axios.post(url, payload, {
        timeout: timeoutMs || 15000,
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Token": token || "",
        },
        validateStatus: () => true,
      });

      const status = res.status;

      if (status >= 200 && status < 300) {
        logger?.info?.({ status, ok: true, event }, "[WEBHOOK] sent");
        return { ok: true, status, data: res.data };
      }

      if (status === 429) {
        const retryAfterMs = getRetryAfterMs(res.headers) || 2000;
        logger?.warn?.({ attempt, maxRetries, status, retryAfterMs, event }, "[WEBHOOK] rate limited");
        await sleep(retryAfterMs);
        continue;
      }

      logger?.warn?.(
        { attempt, maxRetries, status, event, message: res.data?.message || `HTTP ${status}`, data: res.data },
        "[WEBHOOK] send failed"
      );

      if (status >= 400 && status < 500) {
        return { ok: false, status, data: res.data };
      }

      await sleep(1000);
    } catch (err) {
      logger?.warn?.({ attempt, maxRetries, event, message: err.message }, "[WEBHOOK] exception");
      await sleep(1000);
    }
  }

  logger?.error?.({ event, message: "Max retries exceeded" }, "[WEBHOOK] giving up");
  return { ok: false, status: null };
}

module.exports = {
  sendBatchToLaravel,
};
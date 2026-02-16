const axios = require("axios");
const config = require("./config");
const logger = require("./logger");

const client = axios.create({
  baseURL: config.laravel.url,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Token": config.laravel.token,
  },
});

async function sendLocationBatch(items) {
  if (!items.length) return { ok: true, skipped: true };

  const payload = {
    event: "location.batch",
    data: { items },
  };

  const res = await client.post("", payload);

  logger.info(
    {
      status: res.status,
      macs: res.data?.macs,
      items: res.data?.items,
      partner_ids: res.data?.partner_ids,
    },
    "[WEBHOOK] location.batch sent"
  );

  return res.data;
}

module.exports = { sendLocationBatch };
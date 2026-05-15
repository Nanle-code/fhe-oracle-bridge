/**
 * Optional Discord webhook notifications for testnet ops.
 * Set DISCORD_WEBHOOK_URL in .env
 */

async function sendDiscordWebhook(content, embeds) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;

  const body = { content: content?.slice(0, 2000) };
  if (embeds?.length) body.embeds = embeds;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook HTTP ${res.status}: ${text}`);
  }
  return true;
}

async function notifySmokeFailure(report, errorMessage) {
  const fields = [];
  for (const [name, comp] of Object.entries(report?.components || {})) {
    fields.push({
      name,
      value: (comp.message || comp.status || "—").slice(0, 256),
      inline: true,
    });
  }

  await sendDiscordWebhook(null, [
    {
      title: "FHE Oracle Bridge — testnet smoke FAILED",
      description: errorMessage || `Overall: ${report?.overall}`,
      color: 0xef4444,
      fields: fields.slice(0, 10),
      timestamp: new Date().toISOString(),
    },
  ]);
}

module.exports = { sendDiscordWebhook, notifySmokeFailure };

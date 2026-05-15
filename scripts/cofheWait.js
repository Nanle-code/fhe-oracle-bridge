/**
 * cofheWait.js — Block until CoFHE testnet endpoints respond (or timeout).
 *
 *   node scripts/cofheWait.js
 *   COFHE_WAIT_MS=600000 node scripts/cofheWait.js
 */

const { checkCofheEndpoints } = require("./lib/liveHealth");

const maxWait = Number.parseInt(process.env.COFHE_WAIT_MS || "300000", 10);
const poll = Number.parseInt(process.env.COFHE_WAIT_POLL_MS || "10000", 10);
const needOk = Number.parseInt(process.env.COFHE_WAIT_MIN_OK || "2", 10);

async function main() {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const r = await checkCofheEndpoints();
    const ok = r.endpoints.filter((e) => e.ok).length;
    console.log(`[${new Date().toISOString()}] CoFHE ${ok}/${r.endpoints.length} up — ${r.message}`);
    if (ok >= needOk) {
      console.log("CoFHE ready.");
      return;
    }
    await new Promise((res) => setTimeout(res, poll));
  }
  console.error(`CoFHE not ready after ${maxWait}ms`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * testnetHealth.js — Live health check (JSON-friendly).
 *
 *   npm run testnet:health
 *   npm run testnet:health -- --json
 */

require("dotenv").config();
const { runLiveHealthCheck } = require("./lib/liveHealth");

async function main() {
  const json = process.argv.includes("--json");
  const report = await runLiveHealthCheck("arbitrumSepolia");

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.overall === "error") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

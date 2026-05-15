/**
 * testnetSmoke.js — Quick live testnet validation (Arbitrum Sepolia by default).
 *
 *   npm run testnet:smoke
 *   npm run testnet:smoke -- --strict   # exit 1 on warnings too
 */

require("dotenv").config();
const { runLiveHealthCheck } = require("./lib/liveHealth");
const { requireAddresses, loadTestnetConfig } = require("./lib/testnetConfig");
const { notifySmokeFailure } = require("./lib/notify");

function printReport(report) {
  console.log(`\n=== Testnet smoke — ${report.network} ===`);
  console.log(`Overall: ${report.overall.toUpperCase()} @ ${report.timestamp}\n`);

  for (const [name, comp] of Object.entries(report.components)) {
    console.log(`[${comp.status}] ${name}: ${comp.message || JSON.stringify(comp)}`);
    if (name === "oracle" && comp.feeds) {
      for (const f of comp.feeds) {
        const age = f.ageSeconds != null ? `${Math.floor(f.ageSeconds / 60)}m ago` : "never";
        console.log(`       feed ${f.feedId} ${f.description}: round ${f.roundId}, ${age}, ${f.status}`);
      }
    }
    if (name === "cofhe" && comp.endpoints) {
      for (const e of comp.endpoints) {
        console.log(`       ${e.name}: ${e.ok ? `HTTP ${e.status}` : e.error || "down"}`);
      }
    }
    if (name === "spin" && comp.processes) {
      for (const p of comp.processes) {
        console.log(`       ${p.name}: ${p.alive ? `pid ${p.pid}` : "not running"}`);
      }
    }
  }

  console.log("\nContracts:");
  console.log(`  oracle:     ${report.config.oracle}`);
  console.log(`  liquidator: ${report.config.liquidator}`);
  console.log(`  registry:   ${report.config.registry}`);
}

async function main() {
  const strict = process.argv.includes("--strict");
  requireAddresses(loadTestnetConfig());

  const report = await runLiveHealthCheck("arbitrumSepolia");
  printReport(report);

  const fail =
    report.overall === "error" || (strict && report.overall === "warning");

  if (fail) {
    console.error("\nSmoke check FAILED. Run: npm run spin  |  npm run testnet:health");
    try {
      await notifySmokeFailure(report, strict ? "strict mode" : "error status");
    } catch (notifyErr) {
      console.error("Discord notify failed:", notifyErr.message);
    }
    process.exit(1);
  }
  console.log("\nSmoke check passed.");
}

main().catch(async (e) => {
  console.error(e);
  try {
    await notifySmokeFailure(null, e.message);
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});

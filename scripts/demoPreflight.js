/**
 * demoPreflight.js — Fail fast before a live demo if RPC, feeds, or CoFHE are unhealthy.
 *
 *   npm run demo:preflight
 *   npm run demo:preflight -- --strict
 */

require("dotenv").config();
const { runLiveHealthCheck } = require("./lib/liveHealth");
const { requireAddresses, loadTestnetConfig } = require("./lib/testnetConfig");

async function main() {
  const strict = process.argv.includes("--strict");
  requireAddresses(loadTestnetConfig());

  console.log("Checking Arbitrum Sepolia demo prerequisites…\n");
  const report = await runLiveHealthCheck("arbitrumSepolia");

  for (const [name, comp] of Object.entries(report.components)) {
    const icon = comp.status === "healthy" ? "OK" : comp.status === "warning" ? "WARN" : "FAIL";
    console.log(`[${icon}] ${name}: ${comp.message || ""}`);
    if (name === "cofhe" && comp.endpoints) {
      for (const e of comp.endpoints) {
        console.log(`      ${e.name}: ${e.ok ? `HTTP ${e.status}` : e.error || "down"}`);
      }
    }
    if (name === "oracle" && comp.feeds) {
      for (const f of comp.feeds) {
        const age = f.ageSeconds != null ? `${Math.floor(f.ageSeconds / 60)}m ago` : "never";
        console.log(`      feed ${f.feedId}: ${f.status}, round ${f.roundId}, ${age}`);
      }
    }
  }

  console.log(`\nOverall: ${report.overall.toUpperCase()}`);

  const cofhe = report.components.cofhe;
  if (cofhe?.status === "error") {
    console.error(
      "\nCoFHE testnet unreachable — wave4:live will fail. Retry in a few minutes or check https://docs.fhenix.io"
    );
    process.exit(1);
  }

  const fail = report.overall === "error" || (strict && report.overall === "warning");
  if (fail) {
    console.error("\nPreflight FAILED. Fix issues above before npm run wave4:live");
    process.exit(1);
  }

  console.log("\nPreflight OK — run: npm run wave4:live");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

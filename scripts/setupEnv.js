/**
 * setupEnv.js — Copy frontend/config.json addresses into .env (keeps existing PRIVATE_KEY).
 *
 *   node scripts/setupEnv.js
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const configPath = path.join(root, "frontend/config.json");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    map.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return map;
}

function serializeEnv(map, templateLines) {
  const used = new Set();
  const out = [];

  for (const line of templateLines) {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, line.indexOf("="));
    if (map.has(key)) {
      out.push(`${key}=${map.get(key)}`);
      used.add(key);
    } else {
      out.push(line);
    }
  }

  for (const [key, val] of map) {
    if (!used.has(key) && val) out.push(`${key}=${val}`);
  }

  return out.join("\n") + "\n";
}

function main() {
  if (!fs.existsSync(configPath)) {
    console.error("Missing frontend/config.json");
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const template = fs.readFileSync(examplePath, "utf8");
  const templateLines = template.split("\n");

  const existing = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : new Map();

  const merged = new Map(existing);
  const fromConfig = {
    ACCESS_REGISTRY: cfg.registry || "",
    FHE_ORACLE_BRIDGE: cfg.oracle || "",
    MOCK_CONSUMER: cfg.mockConsumer || "",
    PRIVATE_LIQUIDATOR: cfg.liquidator || "",
    PRIVATE_THRESHOLD_ALERTS: cfg.thresholdAlerts || "",
    ARBITRUM_SEPOLIA_RPC: cfg.rpcUrls?.[0] || "",
  };

  for (const [key, val] of Object.entries(fromConfig)) {
    if (val) merged.set(key, val);
  }

  if (!merged.get("PRIVATE_KEY") || merged.get("PRIVATE_KEY") === "your_private_key_here") {
    console.warn("WARNING: Set PRIVATE_KEY in .env before running live demos (wave4:live / wave5:live).");
  }

  fs.writeFileSync(envPath, serializeEnv(merged, templateLines));
  console.log(`Wrote ${envPath} from frontend/config.json`);
  console.log("Next: add PRIVATE_KEY, then npm run demo:preflight && npm run wave5:live");
}

main();

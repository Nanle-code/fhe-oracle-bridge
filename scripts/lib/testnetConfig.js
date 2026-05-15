const fs = require("fs");
const path = require("path");

function loadJsonConfig() {
  const p = path.join(__dirname, "../../frontend/config.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Resolve testnet addresses: .env overrides frontend/config.json.
 */
function loadTestnetConfig() {
  const json = loadJsonConfig();
  return {
    chainId: json?.chainId ?? 421614,
    registry: process.env.ACCESS_REGISTRY || json?.registry || "",
    oracle: process.env.FHE_ORACLE_BRIDGE || json?.oracle || "",
    mockConsumer: process.env.MOCK_CONSUMER || json?.mockConsumer || "",
    liquidator: process.env.PRIVATE_LIQUIDATOR || json?.liquidator || "",
    thresholdAlerts: process.env.PRIVATE_THRESHOLD_ALERTS || json?.thresholdAlerts || "",
    rpcUrls: [
      process.env.ARBITRUM_SEPOLIA_RPC,
      ...(json?.rpcUrls || []),
    ].filter(Boolean),
  };
}

function rpcForNetwork(networkName) {
  if (networkName === "arbitrumSepolia") {
    return process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";
  }
  if (networkName === "baseSepolia") {
    return process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
  }
  return null;
}

function requireAddresses(cfg) {
  const missing = [];
  if (!cfg.oracle) missing.push("FHE_ORACLE_BRIDGE");
  if (!cfg.registry) missing.push("ACCESS_REGISTRY");
  if (!cfg.liquidator) missing.push("PRIVATE_LIQUIDATOR");
  if (missing.length) {
    throw new Error(`Missing in .env or frontend/config.json: ${missing.join(", ")}`);
  }
}

module.exports = { loadTestnetConfig, rpcForNetwork, requireAddresses };

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { loadTestnetConfig } = require("./testnetConfig");

const ORACLE_ABI = [
  "function feedCount() view returns (uint256)",
  "function getFeedInfo(uint256) view returns (string description, uint256 lastUpdated, uint256 roundId, uint256 ttl, uint8 minFeeders, bool active)",
  "function feeders(address) view returns (bool)",
];

const COFHE_URLS = [
  { name: "coFHE", url: "https://testnet-cofhe.fhenix.zone" },
  { name: "zkVerifier", url: "https://testnet-cofhe-vrf.fhenix.zone" },
  { name: "thresholdNetwork", url: "https://testnet-cofhe-tn.fhenix.zone" },
];

async function fetchHead(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, method: "GET" });
    return { ok: res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function checkCofheEndpoints() {
  const results = [];
  for (const { name, url } of COFHE_URLS) {
    const r = await fetchHead(url);
    results.push({ name, url, ...r });
  }
  const healthy = results.filter((r) => r.ok).length;
  return {
    status: healthy === results.length ? "healthy" : healthy > 0 ? "warning" : "error",
    endpoints: results,
    message: `${healthy}/${results.length} CoFHE endpoints reachable`,
  };
}

async function checkOracleFeeds(provider, oracleAddr) {
  const oracle = new ethers.Contract(oracleAddr, ORACLE_ABI, provider);
  const count = Number(await oracle.feedCount());
  const now = Math.floor(Date.now() / 1000);
  const feeds = [];

  for (let id = 1; id <= count; id++) {
    const [desc, lastUpdated, roundId, ttl, minFeeders, active] = await oracle.getFeedInfo(id);
    const updated = Number(lastUpdated);
    const age = updated > 0 ? now - updated : null;
    const stale = !active || updated === 0 || age > Number(ttl);
    feeds.push({
      feedId: id,
      description: desc,
      lastUpdated: updated,
      roundId: Number(roundId),
      ttl: Number(ttl),
      minFeeders: Number(minFeeders),
      active,
      ageSeconds: age,
      status: stale ? "stale" : "fresh",
    });
  }

  const fresh = feeds.filter((f) => f.status === "fresh").length;
  return {
    status: fresh === feeds.length && feeds.length > 0 ? "healthy" : "warning",
    feeds,
    message: `${fresh}/${feeds.length} feeds fresh`,
  };
}

function checkSpinProcesses() {
  const logDir = path.join(__dirname, "../../logs/spin");
  const names = ["feeder", "liquidation-keeper", "threshold-keeper", "frontend"];
  const processes = [];

  if (!fs.existsSync(logDir)) {
    return { status: "warning", processes: [], message: "spin not running (no logs/spin)" };
  }

  for (const name of names) {
    const pidPath = path.join(logDir, `${name}.pid`);
    let alive = false;
    let pid = null;
    if (fs.existsSync(pidPath)) {
      pid = Number.parseInt(fs.readFileSync(pidPath, "utf8"), 10);
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    processes.push({ name, pid, alive });
  }

  const aliveCount = processes.filter((p) => p.alive).length;
  return {
    status: aliveCount >= 2 ? "healthy" : "warning",
    processes,
    message: `${aliveCount}/${processes.length} spin processes alive`,
  };
}

async function checkWalletBalance(provider, address, minEth = "0.002") {
  const bal = await provider.getBalance(address);
  const ok = bal >= ethers.parseEther(minEth);
  return {
    address,
    balanceEth: ethers.formatEther(bal),
    minEth,
    status: ok ? "healthy" : "warning",
    message: ok ? `${ethers.formatEther(bal)} ETH` : `low balance ${ethers.formatEther(bal)} ETH`,
  };
}

async function checkFrontend(url = process.env.FRONTEND_URL || "http://127.0.0.1:8765/") {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const ms = Date.now() - t0;
    return {
      status: res.ok ? "healthy" : "warning",
      url,
      httpStatus: res.status,
      responseMs: ms,
      message: res.ok ? `OK ${ms}ms` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { status: "error", url, message: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function runLiveHealthCheck(networkName = "arbitrumSepolia") {
  const cfg = loadTestnetConfig();
  const rpc = process.env.ARBITRUM_SEPOLIA_RPC || cfg.rpcUrls[0];
  if (!cfg.oracle) {
    throw new Error("No oracle address — set FHE_ORACLE_BRIDGE or frontend/config.json");
  }

  const provider = new ethers.JsonRpcProvider(rpc, cfg.chainId);
  const block = await provider.getBlockNumber();

  const cofhe = await checkCofheEndpoints();
  const oracle = await checkOracleFeeds(provider, cfg.oracle);
  const spin = checkSpinProcesses();
  const frontend = await checkFrontend();

  let wallet = null;
  if (process.env.PRIVATE_KEY) {
    const pk = process.env.PRIVATE_KEY.startsWith("0x")
      ? process.env.PRIVATE_KEY
      : `0x${process.env.PRIVATE_KEY}`;
    const w = new ethers.Wallet(pk, provider);
    wallet = await checkWalletBalance(provider, w.address);
  }

  const components = { network: { status: "healthy", block, rpc }, cofhe, oracle, spin, frontend };
  if (wallet) components.wallet = wallet;

  const statuses = Object.values(components).map((c) => c.status);
  const overall = statuses.includes("error")
    ? "error"
    : statuses.includes("warning")
      ? "warning"
      : "healthy";

  return { timestamp: new Date().toISOString(), network: networkName, overall, components, config: cfg };
}

module.exports = {
  runLiveHealthCheck,
  checkCofheEndpoints,
  checkOracleFeeds,
  checkSpinProcesses,
  checkFrontend,
};

/**
 * feederDaemon.js — Automated price feeder (CoinGecko + Binance → encrypt → submitPrice)
 *
 * Pulls ETH/USD and BTC/USD from two public APIs, averages per asset, encrypts with CoFHE
 * (or plain uint256 on local Hardhat), submits on an interval with jitter.
 *
 * Env:
 *   PRIVATE_KEY, FHE_ORACLE_BRIDGE (required on-chain)
 *   ARBITRUM_SEPOLIA_RPC / BASE_SEPOLIA_RPC as in hardhat.config
 *   FEEDER_INTERVAL_MS   — base loop delay (default 60000)
 *   FEEDER_JITTER_MS     — extra random delay 0..N ms (default 20000)
 *   FEED_ETH_ID / FEED_BTC_ID — feed IDs (default 1 / 2, matching deploy.js)
 *   FEEDER_SIGNER_INDEX — which Hardhat signer feeds (0, 1, …). Set FEEDER2_PRIVATE_KEY in .env
 *                         so index 0 and 1 are different keys; run two processes for quorum.
 *   FEEDER_LOG_JSON=1    — one JSON object per log line (for log drains)
 *   FEEDER_SUBMIT_GAP_MS — pause between ETH and BTC submit (default 5000) to ease CoFHE ZK / RPC bursts
 *   FEEDER_SUBMIT_RETRIES — retries per feed on ETIMEDOUT / ZK_VERIFY_FAILED (default 4)
 *
 * Deploy as a persistent process (Railway, Render, Fly, VPS):
 *   Build: npm ci
 *   Start: npx hardhat run scripts/feederDaemon.js --network arbitrumSepolia
 *   Set PRIVATE_KEY to a registered feeder with stake; set FHE_ORACLE_BRIDGE.
 */

const { ethers, network } = require("hardhat");
const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
const { chains } = require("@cofhe/sdk/chains");
const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
const { Encryptable } = require("@cofhe/sdk");
require("dotenv").config();

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_JITTER_MS = 20_000;

function getSubmissionMode(networkName) {
  const isLocal = networkName === "hardhat" || networkName === "localhost";
  const isNativeFhenix = networkName === "helium";
  const isCofhe =
    networkName === "sepolia" ||
    networkName === "arbitrumSepolia" ||
    networkName === "baseSepolia";
  return {
    mode: isLocal ? "local" : isNativeFhenix ? "fhenix" : isCofhe ? "cofhe" : "unknown",
    oracle: isLocal
      ? "FHEOracleBridge"
      : isNativeFhenix
        ? "FHEOracleBridgeFhenix"
        : isCofhe
          ? "FHEOracleBridgeCofhe"
          : "FHEOracleBridge",
  };
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function logJson(obj) {
  if (process.env.FEEDER_LOG_JSON === "1") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
  }
}

function logHuman(msg, extra = {}) {
  if (process.env.FEEDER_LOG_JSON === "1") {
    logJson({ level: "info", msg, ...extra });
  } else {
    console.log(`[${new Date().toISOString()}] ${msg}`, Object.keys(extra).length ? extra : "");
  }
}

function logError(msg, err, extra = {}) {
  const errObj =
    err && typeof err === "object"
      ? { message: err.message, code: err.code, reason: err.reason, shortMessage: err.shortMessage }
      : { message: String(err) };
  if (process.env.FEEDER_LOG_JSON === "1") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg, err: errObj, ...extra }));
  } else {
    console.error(`[${new Date().toISOString()}] ERROR: ${msg}`, errObj, extra);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const FETCH_UA = { "User-Agent": "fhe-oracle-bridge-feeder/1.0 (public spot; contact repo owner)" };

/** Abort after ms (Node 18+ fetch). */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { ...FETCH_UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonRetry(url, opts = {}, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, opts, 22000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
  }
  throw last;
}

function isTransientSubmitError(err) {
  const walk = (e, depth) => {
    if (!e || typeof e !== "object" || depth > 4) return false;
    const code = e.code;
    const msg = `${e.message || ""} ${e.shortMessage || ""}`.toLowerCase();
    if (code === "ETIMEDOUT" || code === "TIMEOUT" || code === "ECONNRESET" || code === "ENETUNREACH") return true;
    if (code === "ZK_VERIFY_FAILED") return true;
    if (code === "SERVER_ERROR" || code === "NETWORK_ERROR") return true;
    if (msg.includes("fetch failed") || msg.includes("timeout") || msg.includes("network")) return true;
    return walk(e.cause, depth + 1);
  };
  return walk(err, 0);
}

/** After ethers tx.wait TIMEOUT, tx may still be mined — poll before treating as failure. */
async function waitTxReceiptWithFallback(tx, waitTimeoutMs = 180_000, pollTotalMs = 120_000) {
  try {
    return await tx.wait(1, waitTimeoutMs);
  } catch (e) {
    if (e?.code !== "TIMEOUT" && e?.code !== "ETIMEDOUT") throw e;
    const pollStart = Date.now();
    while (Date.now() - pollStart < pollTotalMs) {
      await sleep(3000);
      const r = await ethers.provider.getTransactionReceipt(tx.hash);
      if (r) {
        if (Number(r.status) !== 1) {
          throw new Error(`transaction reverted (hash ${tx.hash})`);
        }
        return r;
      }
    }
    throw e;
  }
}

function jitterDelay(baseMs, jitterMs) {
  const j = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
  return baseMs + j;
}

/** USD number → uint with 8 decimals (oracle convention) */
function usdToUint8Decimals(usd) {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Invalid USD: ${usd}`);
  const scaled = Math.round(usd * 1e8);
  if (scaled > Number.MAX_SAFE_INTEGER) throw new Error("Price too large for safe integer rounding");
  return BigInt(scaled);
}

async function fetchCoingeckoEthBtc() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd";
  const data = await fetchJsonRetry(url, { headers: { accept: "application/json" } });
  const eth = data?.ethereum?.usd;
  const btc = data?.bitcoin?.usd;
  if (typeof eth !== "number" || typeof btc !== "number") {
    throw new Error("CoinGecko: missing ethereum/bitcoin usd");
  }
  return { eth, btc, source: "coingecko" };
}

async function fetchBinanceEthBtc() {
  const base = "https://api.binance.com/api/v3/ticker/price";
  const [ethJ, btcJ] = await Promise.all([
    fetchJsonRetry(`${base}?symbol=ETHUSDT`, { headers: { accept: "application/json" } }),
    fetchJsonRetry(`${base}?symbol=BTCUSDT`, { headers: { accept: "application/json" } }),
  ]);
  const eth = Number.parseFloat(ethJ.price);
  const btc = Number.parseFloat(btcJ.price);
  if (!Number.isFinite(eth) || !Number.isFinite(btc)) {
    throw new Error("Binance: invalid price");
  }
  return { eth, btc, source: "binance" };
}

/**
 * Average ETH and BTC across sources; if one source fails after retry, use the other with warning.
 */
async function fetchAveragedPrices() {
  const results = await Promise.allSettled([fetchCoingeckoEthBtc(), fetchBinanceEthBtc()]);
  const ok = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") ok.push(r.value);
    else logHuman("Price source failed (first attempt)", { attempt: 1, index: i, reason: String(r.reason) });
  }
  if (ok.length === 0) {
    await sleep(1500);
    const retry = await Promise.allSettled([fetchCoingeckoEthBtc(), fetchBinanceEthBtc()]);
    for (let i = 0; i < retry.length; i++) {
      const r = retry[i];
      if (r.status === "fulfilled") ok.push(r.value);
      else logHuman("Price source failed (retry)", { index: i, reason: String(r.reason) });
    }
  }
  if (ok.length === 0) throw new Error("All price sources failed");
  let sumEth = 0;
  let sumBtc = 0;
  for (const o of ok) {
    sumEth += o.eth;
    sumBtc += o.btc;
  }
  const avgEth = sumEth / ok.length;
  const avgBtc = sumBtc / ok.length;
  const sources = ok.map((o) => o.source);
  if (ok.length < 2) {
    logHuman("WARNING: using single price source this cycle (manipulation resistance reduced)", {
      sources,
    });
  }
  return {
    ethUsd: avgEth,
    btcUsd: avgBtc,
    sources,
    raw: ok,
  };
}

async function initCofhe(feeder) {
  const chain =
    network.name === "arbitrumSepolia"
      ? chains.arbSepolia
      : network.name === "sepolia"
        ? chains.sepolia
        : network.name === "baseSepolia"
          ? chains.baseSepolia
          : null;
  if (!chain) {
    throw new Error(`CoFHE not configured for network: ${network.name}`);
  }
  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [chain] }));
  const { publicClient, walletClient } = await Ethers6Adapter(ethers.provider, feeder);
  await cofhe.connect(publicClient, walletClient);
  return cofhe;
}

function formatGwei(wei) {
  try {
    return ethers.formatUnits(wei, "gwei");
  } catch {
    return String(wei);
  }
}

function logQuorumEvents(oracle, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = oracle.interface.parseLog(log);
      if (parsed.name === "QuorumPending") {
        const [feedId, roundId, submissionCount, minFeeders] = parsed.args;
        logJson({
          event: "QuorumPending",
          feedId: feedId.toString(),
          roundId: roundId.toString(),
          submissionCount,
          minFeeders,
        });
        logHuman(
          `Quorum pending: feed ${feedId} round ${roundId} — ${submissionCount}/${minFeeders} feeders (aggregate unchanged until quorum)`
        );
      }
      if (parsed.name === "FeedUpdated") {
        const [feedId, roundId, feederCount] = parsed.args;
        logJson({
          event: "FeedUpdated",
          feedId: feedId.toString(),
          roundId: roundId.toString(),
          feederCount: feederCount.toString(),
        });
        logHuman(
          `Round finalized: feed ${feedId} round ${roundId} — ${feederCount} feeder(s), encrypted median applied`
        );
      }
    } catch {
      /* not an oracle event */
    }
  }
}

async function submitOneWithRetries(args) {
  const max = envInt("FEEDER_SUBMIT_RETRIES", 4);
  const backoffs = [2000, 5000, 10000, 15000];
  let lastErr;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await submitOne(args);
    } catch (e) {
      lastErr = e;
      if (!isTransientSubmitError(e) || attempt === max - 1) throw e;
      const wait = backoffs[Math.min(attempt, backoffs.length - 1)];
      logHuman(`Submit transient error (${args.label}), retry ${attempt + 2}/${max} after ${wait}ms`, {
        code: e?.code,
        message: e?.message,
      });
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function submitOne({ oracle, feeder, mode, cofhe, feedId, label, priceUint }) {
  const t0 = Date.now();
  let resolvedPayload;
  if (mode === "local") {
    resolvedPayload = priceUint;
  } else if (mode === "cofhe") {
    const [enc] = await cofhe.encryptInputs([Encryptable.uint128(priceUint)]).execute();
    resolvedPayload = {
      ctHash: enc.ctHash,
      securityZone: enc.securityZone,
      utype: enc.utype,
      signature: enc.signature,
    };
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }
  const encMs = Date.now() - t0;

  const feeData = await ethers.provider.getFeeData();
  const tx = await oracle.connect(feeder).submitPrice(feedId, resolvedPayload);
  const receipt = await waitTxReceiptWithFallback(tx, 180_000, 120_000);
  logQuorumEvents(oracle, receipt);
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? feeData.gasPrice ?? 0n;
  const feeWei = gasUsed * gasPrice;

  return {
    feedId: feedId.toString(),
    label,
    priceUint: priceUint.toString(),
    encMs,
    txHash: tx.hash,
    gasUsed: gasUsed.toString(),
    gasPriceGwei: formatGwei(gasPrice),
    feeEth: ethers.formatEther(feeWei),
  };
}

async function main() {
  const signers = await ethers.getSigners();
  const idx = envInt("FEEDER_SIGNER_INDEX", 0);
  const feeder = signers[idx];
  if (!feeder) {
    console.error(
      `FEEDER_SIGNER_INDEX=${idx} but only ${signers.length} signer(s). Add FEEDER2_PRIVATE_KEY (and FEEDER3_PRIVATE_KEY) in .env for quorum.`
    );
    process.exit(1);
  }
  const { mode, oracle: oracleName } = getSubmissionMode(network.name);

  if (mode === "unknown") {
    console.error(
      `Network ${network.name} is not supported by the feeder (use hardhat, localhost, or a CoFHE testnet).`
    );
    process.exit(1);
  }
  if (mode === "fhenix") {
    console.error(
      "Native Fhenix (helium) encryption is not wired in this daemon; use Arbitrum/Base/Sepolia CoFHE or local hardhat."
    );
    process.exit(1);
  }

  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!oracleAddr) {
    console.error("Set FHE_ORACLE_BRIDGE in .env");
    process.exit(1);
  }

  const intervalMs = envInt("FEEDER_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  const jitterMs = envInt("FEEDER_JITTER_MS", DEFAULT_JITTER_MS);
  const feedEthId = BigInt(envInt("FEED_ETH_ID", 1));
  const feedBtcId = BigInt(envInt("FEED_BTC_ID", 2));

  const oracle = await ethers.getContractAt(oracleName, oracleAddr);

  let cofhe;
  if (mode === "cofhe") {
    cofhe = await initCofhe(feeder);
  }

  const stats = { successTxs: 0, failedTxs: 0, cyclesFailed: 0, lastError: null, lastSuccessAt: null };

  logHuman("Feeder daemon started", {
    network: network.name,
    mode,
    oracle: oracleAddr,
    feeder: feeder.address,
    intervalMs,
    jitterMs,
    feeds: { eth: feedEthId.toString(), btc: feedBtcId.toString() },
  });

  let shuttingDown = false;
  const shutdown = () => {
    shuttingDown = true;
    logHuman("Shutdown signal received, finishing current cycle if any…");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!shuttingDown) {
    const wait = jitterDelay(intervalMs, jitterMs);
    try {
      const snap = await fetchAveragedPrices();
      const ethUint = usdToUint8Decimals(snap.ethUsd);
      const btcUint = usdToUint8Decimals(snap.btcUsd);

      logJson({
        event: "prices",
        ethUsd: snap.ethUsd,
        btcUsd: snap.btcUsd,
        sources: snap.sources,
      });
      logHuman("Averaged spot", {
        ethUsd: snap.ethUsd,
        btcUsd: snap.btcUsd,
        sources: snap.sources,
      });

      const submitGap = envInt("FEEDER_SUBMIT_GAP_MS", 5000);
      let cycleHadError = false;
      const feeds = [
        { feedId: feedEthId, label: "ETH/USD", priceUint: ethUint },
        { feedId: feedBtcId, label: "BTC/USD", priceUint: btcUint },
      ];
      for (let fi = 0; fi < feeds.length; fi++) {
        const { feedId, label, priceUint } = feeds[fi];
        if (fi > 0 && submitGap > 0) await sleep(submitGap);
        try {
          const out = await submitOneWithRetries({
            oracle,
            feeder,
            mode,
            cofhe,
            feedId,
            label,
            priceUint,
          });
          stats.successTxs++;
          stats.lastSuccessAt = new Date().toISOString();
          stats.lastError = null;
          logJson({ event: "submit_ok", ...out });
          logHuman(`Submitted ${label} tx=${out.txHash} gas=${out.gasUsed} feeEth=${out.feeEth}`, out);
        } catch (subErr) {
          cycleHadError = true;
          stats.failedTxs++;
          stats.lastError = subErr instanceof Error ? subErr.message : String(subErr);
          logError(`Submit failed (${label})`, subErr, { feedId: feedId.toString(), stats });
        }
      }
      if (cycleHadError) stats.cyclesFailed++;
    } catch (e) {
      stats.cyclesFailed++;
      stats.lastError = e instanceof Error ? e.message : String(e);
      logError("Cycle failed (price fetch or setup)", e, { stats });
    }

    logJson({ event: "health", ...stats });
    logHuman("Health", { ...stats, nextSleepMs: wait });

    if (shuttingDown) break;
    await sleep(wait);
  }

  logHuman("Feeder daemon stopped", stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * thresholdAlertKeeper.js — CoFHE decrypt loop for PrivateThresholdAlertsCofhe
 *
 * Watches `ThresholdCheckPrepared`, runs `decryptForTx(ctHash).withoutPermit()`, then `completeThresholdAlert`.
 * The keeper (and chain) only surface the final boolean; encrypted spot and threshold stay hidden.
 *
 * Env: PRIVATE_THRESHOLD_ALERTS, PRIVATE_KEY, RPC; optional KEEPER_POLL_MS, KEEPER_FROM_BLOCK, KEEPER_LOG_JSON=1
 */

const { ethers, network } = require("hardhat");
const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
const { chains } = require("@cofhe/sdk/chains");
const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
require("dotenv").config();

function chainForNetwork() {
  if (network.name === "arbitrumSepolia") return chains.arbSepolia;
  if (network.name === "sepolia") return chains.sepolia;
  if (network.name === "baseSepolia") return chains.baseSepolia;
  return null;
}

function logJson(obj) {
  if (process.env.KEEPER_LOG_JSON === "1") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
  }
}

function logHuman(msg, extra = {}) {
  if (process.env.KEEPER_LOG_JSON === "1") {
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
  if (process.env.KEEPER_LOG_JSON === "1") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg, err: errObj, ...extra }));
  } else {
    console.error(`[${new Date().toISOString()}] ERROR: ${msg}`, errObj, extra);
  }
}

async function main() {
  const chain = chainForNetwork();
  if (!chain) {
    console.error("thresholdAlertKeeper: use --network arbitrumSepolia | sepolia | baseSepolia");
    process.exit(1);
  }

  const alertsAddr = process.env.PRIVATE_THRESHOLD_ALERTS;
  if (!alertsAddr) {
    console.error("Set PRIVATE_THRESHOLD_ALERTS in .env (PrivateThresholdAlertsCofhe address)");
    process.exit(1);
  }

  const signers = await ethers.getSigners();
  const keeper = signers[0];

  const alerts = await ethers.getContractAt("PrivateThresholdAlertsCofhe", alertsAddr);
  const filter = alerts.filters.ThresholdCheckPrepared();

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [chain] }));
  const { publicClient, walletClient } = await Ethers6Adapter(ethers.provider, keeper);
  await cofhe.connect(publicClient, walletClient);

  let fromBlock = Number.parseInt(process.env.KEEPER_FROM_BLOCK || "0", 10);
  if (!Number.isFinite(fromBlock) || fromBlock < 0) fromBlock = 0;
  if (fromBlock === 0) {
    const head = await ethers.provider.getBlockNumber();
    fromBlock = Math.max(0, head - 2000);
  }

  const pollMs = Number.parseInt(process.env.KEEPER_POLL_MS || "8000", 10);
  const poll = Number.isFinite(pollMs) && pollMs >= 1000 ? pollMs : 8000;

  const seen = new Set();
  let shuttingDown = false;

  logHuman("Threshold alert keeper started", {
    network: network.name,
    alerts: alertsAddr,
    keeper: keeper.address,
    fromBlock,
    pollMs: poll,
  });

  async function handleEvent(ev) {
    const key = `${ev.transactionHash}-${ev.index}`;
    if (seen.has(key)) return;
    seen.add(key);

    const subId = ev.args.subId;
    const ctHash = ev.args.ctHash;

    logHuman("ThresholdCheckPrepared", { subId: subId.toString(), ctHash: ctHash.toString() });

    try {
      const { decryptedValue, signature } = await cofhe.decryptForTx(ctHash).withoutPermit().execute();
      const triggered = decryptedValue !== 0n;

      logHuman("Decrypt done (boolean only — not price or threshold level)", {
        subId: subId.toString(),
        triggered,
      });

      const tx = await alerts.connect(keeper).completeThresholdAlert(subId, triggered, signature);
      const receipt = await tx.wait();
      logHuman(`completeThresholdAlert tx=${tx.hash} gas=${receipt.gasUsed} triggered=${triggered}`);
    } catch (e) {
      logError("threshold keeper step failed", e, { subId: subId.toString() });
    }
  }

  async function pollOnce() {
    const toBlock = await ethers.provider.getBlockNumber();
    if (toBlock <= fromBlock) return;

    try {
      const events = await alerts.queryFilter(filter, fromBlock + 1, toBlock);
      for (const ev of events) {
        await handleEvent(ev);
        if (shuttingDown) return;
      }
      fromBlock = toBlock;
    } catch (e) {
      logError("queryFilter failed", e, { fromBlock, toBlock });
    }
  }

  const shutdown = () => {
    shuttingDown = true;
    logHuman("Shutdown signal received");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await pollOnce();
  while (!shuttingDown) {
    await new Promise((r) => setTimeout(r, poll));
    if (shuttingDown) break;
    await pollOnce();
  }

  logHuman("Threshold alert keeper stopped");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

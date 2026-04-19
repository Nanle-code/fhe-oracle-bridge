/**
 * liquidationKeeper.js — CoFHE async decrypt loop for PrivateLiquidatorCofhe
 *
 * Flow:
 *   1. Something on-chain calls `requestLiquidationCheck(positionId)` (anyone can trigger it).
 *   2. Contract emits `LiquidationCheckPrepared(positionId, ctHash, requestedBy)` with the encrypted
 *      predicate (liqPrice > spot). Spot and threshold stay ciphertexts; only this ebool is revealed later.
 *   3. This keeper polls logs, runs `decryptForTx(ctHash).withoutPermit().execute()` against the threshold
 *      network — it learns only the boolean `isLiquidatable`, not any price.
 *   4. Keeper sends `completeLiquidation(positionId, isLiquidatable, signature)` to publish the result
 *      and pay the liquidator if true.
 *
 * Env:
 *   PRIVATE_KEY, PRIVATE_LIQUIDATOR (deployed PrivateLiquidatorCofhe — must include new ABI after upgrade)
 *   RPC vars per hardhat network
 *   KEEPER_POLL_MS (default 8000) — HTTP polling interval (no websocket required)
 *   KEEPER_FROM_BLOCK — optional; default: latest block - 2000
 *   KEEPER_LOG_JSON=1 — JSON lines for log drains
 *
 * Requires redeploying PrivateLiquidatorCofhe after adding request/complete liquidations.
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
    console.error("liquidationKeeper: use --network arbitrumSepolia | sepolia | baseSepolia");
    process.exit(1);
  }

  const liquidatorAddr = process.env.PRIVATE_LIQUIDATOR;
  if (!liquidatorAddr) {
    console.error("Set PRIVATE_LIQUIDATOR in .env to PrivateLiquidatorCofhe address");
    process.exit(1);
  }

  const signers = await ethers.getSigners();
  const keeper = signers[0];

  const liquidator = await ethers.getContractAt("PrivateLiquidatorCofhe", liquidatorAddr);
  const filter = liquidator.filters.LiquidationCheckPrepared();

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

  logHuman("Liquidation keeper started", {
    network: network.name,
    liquidator: liquidatorAddr,
    keeper: keeper.address,
    fromBlock,
    pollMs: poll,
  });

  async function handleEvent(ev) {
    const key = `${ev.transactionHash}-${ev.index}`;
    if (seen.has(key)) return;
    seen.add(key);

    const positionId = ev.args.positionId;
    const ctHash = ev.args.ctHash;
    const requestedBy = ev.args.requestedBy;

    logJson({
      event: "LiquidationCheckPrepared",
      positionId: positionId.toString(),
      ctHash: ctHash.toString(),
      requestedBy,
      txHash: ev.transactionHash,
    });
    logHuman("Saw LiquidationCheckPrepared", {
      positionId: positionId.toString(),
      ctHash: ctHash.toString(),
      requestedBy,
    });

    try {
      const { decryptedValue, signature } = await cofhe.decryptForTx(ctHash).withoutPermit().execute();
      const isLiquidatable = decryptedValue !== 0n;

      logHuman("Threshold decrypt done (predicate only — no spot price)", {
        positionId: positionId.toString(),
        isLiquidatable,
      });
      logJson({
        event: "decrypt_ok",
        positionId: positionId.toString(),
        isLiquidatable,
      });

      const tx = await liquidator.connect(keeper).completeLiquidation(positionId, isLiquidatable, signature);
      const receipt = await tx.wait();
      logJson({
        event: "completeLiquidation_ok",
        positionId: positionId.toString(),
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
      });
      logHuman(`completeLiquidation tx=${tx.hash} gas=${receipt.gasUsed}`);
    } catch (e) {
      logError("Keeper step failed (decrypt or completeLiquidation)", e, {
        positionId: positionId.toString(),
        ctHash: ctHash.toString(),
      });
    }
  }

  async function pollOnce() {
    const toBlock = await ethers.provider.getBlockNumber();
    if (toBlock <= fromBlock) return;

    try {
      const events = await liquidator.queryFilter(filter, fromBlock + 1, toBlock);
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

  logHuman("Liquidation keeper stopped");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

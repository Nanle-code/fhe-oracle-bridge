/**
 * completeLiquidationOnce.js — One-shot CoFHE decrypt + completeLiquidation (Wave 4 keeper step).
 *
 * Processes the latest LiquidationCheckPrepared for POSITION_ID, or the newest event if unset.
 *
 *   POSITION_ID=1 npx hardhat run scripts/completeLiquidationOnce.js --network arbitrumSepolia
 */

const { ethers, network } = require("hardhat");
const { chainForNetwork, connectCofhe, decryptPredicate } = require("./lib/cofheNetwork");
require("dotenv").config();

async function main() {
  const chain = chainForNetwork(network.name);
  if (!chain) {
    console.error("Use arbitrumSepolia, sepolia, or baseSepolia");
    process.exit(1);
  }

  const liquidatorAddr = process.env.PRIVATE_LIQUIDATOR;
  if (!liquidatorAddr) {
    console.error("Set PRIVATE_LIQUIDATOR in .env");
    process.exit(1);
  }

  const positionFilter = process.env.POSITION_ID;

  const signers = await ethers.getSigners();
  const keeper = signers[0];
  const liquidator = await ethers.getContractAt("PrivateLiquidatorCofhe", liquidatorAddr);
  const filter = liquidator.filters.LiquidationCheckPrepared();

  let fromBlock = Number.parseInt(process.env.KEEPER_FROM_BLOCK || "0", 10);
  if (!Number.isFinite(fromBlock) || fromBlock < 0) fromBlock = 0;
  const head = await ethers.provider.getBlockNumber();
  if (fromBlock === 0) fromBlock = Math.max(0, head - 50_000);

  const events = await liquidator.queryFilter(filter, fromBlock, head);
  if (events.length === 0) {
    console.error("No LiquidationCheckPrepared events found. Run requestLiquidationCheck first.");
    process.exit(1);
  }

  let ev = events[events.length - 1];
  if (positionFilter) {
    const match = events.filter((e) => e.args.positionId.toString() === positionFilter);
    if (match.length === 0) {
      console.error(`No event for POSITION_ID=${positionFilter}`);
      process.exit(1);
    }
    ev = match[match.length - 1];
  }

  const positionId = ev.args.positionId;
  const ctHash = ev.args.ctHash;

  console.log(`Processing positionId=${positionId} ctHash=${ctHash} tx=${ev.transactionHash}`);

  const cofhe = await connectCofhe(ethers.provider, keeper, network.name);
  const { decryptedValue, signature } = await decryptPredicate(cofhe, ctHash);
  const isLiquidatable = decryptedValue !== 0n;

  console.log(`Threshold decrypt: isLiquidatable=${isLiquidatable} (predicate only — no spot price)`);

  let tx;
  let receipt;
  const backoffs = [0, 3000, 8000, 15000];
  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i] > 0) await new Promise((r) => setTimeout(r, backoffs[i]));
    try {
      tx = await liquidator.connect(keeper).completeLiquidation(positionId, isLiquidatable, signature);
      receipt = await tx.wait(1, 180_000);
      break;
    } catch (e) {
      const msg = `${e?.message || e}`.toLowerCase();
      const retryable =
        e?.code === "ETIMEDOUT" ||
        e?.code === "TIMEOUT" ||
        e?.code === "NETWORK_ERROR" ||
        msg.includes("timeout") ||
        msg.includes("fetch failed");
      if (!retryable || i === backoffs.length - 1) throw e;
      console.warn(`completeLiquidation RPC retry ${i + 2}/${backoffs.length}: ${e.message}`);
    }
  }

  console.log(JSON.stringify({
    event: "completeLiquidation",
    positionId: positionId.toString(),
    isLiquidatable,
    txHash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

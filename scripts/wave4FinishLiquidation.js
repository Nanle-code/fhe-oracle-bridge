/**
 * wave4FinishLiquidation.js — Crash price + requestLiquidationCheck + keeper complete.
 *
 *   POSITION_ID=1 npx hardhat run scripts/wave4FinishLiquidation.js --network arbitrumSepolia
 */

const { ethers, network } = require("hardhat");
const { fetchAveragedPrices, usdToUint8Decimals } = require("./lib/livePrices");
const { connectCofhe, decryptPredicate, chainForNetwork } = require("./lib/cofheNetwork");
const { submitLivePrice } = require("./lib/submitLivePrice");
require("dotenv").config();

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  if (!chainForNetwork(network.name)) {
    console.error("Use arbitrumSepolia, sepolia, or baseSepolia");
    process.exit(1);
  }

  const positionId = process.env.POSITION_ID;
  if (!positionId) {
    console.error("Set POSITION_ID");
    process.exit(1);
  }

  const liquidatorAddr = process.env.PRIVATE_LIQUIDATOR;
  if (!liquidatorAddr) {
    console.error("Set PRIVATE_LIQUIDATOR");
    process.exit(1);
  }

  const feedId = BigInt(envInt("FEED_ID", 1));
  const crashBps = envInt("CRASH_BPS", 1500);
  const [keeper] = await ethers.getSigners();
  const liquidator = await ethers.getContractAt("PrivateLiquidatorCofhe", liquidatorAddr);
  const cofhe = await connectCofhe(ethers.provider, keeper, network.name);

  const snap = await fetchAveragedPrices();
  const spotUsd = feedId === 2n ? snap.btcUsd : snap.ethUsd;
  const crashUsd = spotUsd * (1 - crashBps / 10000);
  const crashUint = usdToUint8Decimals(crashUsd);

  console.log(`Crash submit: $${crashUsd.toFixed(2)} (${crashBps} bps below live $${spotUsd.toFixed(2)})`);

  const crashSub = await submitLivePrice({
    networkName: network.name,
    feedId,
    priceUint: crashUint,
    label: "crash",
    feederSigner: keeper,
    cofhe,
  });
  console.log("Crash submitted", crashSub);

  const reqTx = await liquidator.connect(keeper).requestLiquidationCheck(positionId);
  const reqRc = await reqTx.wait();
  console.log(`requestLiquidationCheck tx=${reqTx.hash}`);

  const prepared = reqRc.logs
    .map((l) => {
      try {
        return liquidator.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "LiquidationCheckPrepared");

  if (!prepared) throw new Error("LiquidationCheckPrepared not in receipt");
  const ctHash = prepared.args.ctHash;

  const { decryptedValue, signature } = await decryptPredicate(cofhe, ctHash);
  const isLiquidatable = decryptedValue !== 0n;
  console.log(`isLiquidatable=${isLiquidatable}`);

  const tx = await liquidator.connect(keeper).completeLiquidation(positionId, isLiquidatable, signature);
  const receipt = await tx.wait();

  console.log(JSON.stringify({
    success: isLiquidatable,
    positionId,
    completeTx: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));

  if (!isLiquidatable) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

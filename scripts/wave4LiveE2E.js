/**
 * wave4LiveE2E.js — Full Wave 4 on live CoFHE testnet (real spot APIs, no dummy prices).
 *
 * 1. Submit live ETH/USD to oracle
 * 2. Open position with threshold above spot (healthy)
 * 3. Submit live spot at CRASH_BPS below market (liquidatable)
 * 4. requestLiquidationCheck → CoFHE decrypt → completeLiquidation
 *
 *   npx hardhat run scripts/wave4LiveE2E.js --network arbitrumSepolia
 *
 * Env: .env with PRIVATE_KEY, FHE_ORACLE_BRIDGE, PRIVATE_LIQUIDATOR (feeder must be registered + staked).
 * Optional: LIQ_PREMIUM_BPS=500 CRASH_BPS=1200 COLLATERAL_ETH=0.005 SKIP_INITIAL_SUBMIT=1
 */

const { ethers, network } = require("hardhat");
const { fetchAveragedPrices, usdToUint8Decimals } = require("./lib/livePrices");
const { connectCofhe, encryptUint128, decryptPredicate, chainForNetwork } = require("./lib/cofheNetwork");
const { submitLivePrice } = require("./lib/submitLivePrice");
require("dotenv").config();

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function log(step, msg, extra) {
  console.log(`\n[${step}] ${msg}`);
  if (extra) console.log(JSON.stringify(extra, null, 2));
}

async function completeFromReceipt(liquidator, receipt, keeper, cofhe) {
  const prepared = receipt.logs
    .map((l) => {
      try {
        return liquidator.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "LiquidationCheckPrepared");

  if (!prepared) throw new Error("LiquidationCheckPrepared not found in receipt");

  const positionId = prepared.args.positionId;
  const ctHash = prepared.args.ctHash;

  const { decryptedValue, signature } = await decryptPredicate(cofhe, ctHash);
  const isLiquidatable = decryptedValue !== 0n;
  log("5", `Decrypt predicate only → isLiquidatable=${isLiquidatable}`);

  const tx = await liquidator.connect(keeper).completeLiquidation(positionId, isLiquidatable, signature);
  const done = await tx.wait();
  return { positionId: positionId.toString(), isLiquidatable, completeTx: tx.hash, gasUsed: done.gasUsed.toString() };
}

async function main() {
  if (!chainForNetwork(network.name)) {
    console.error("Use arbitrumSepolia, sepolia, or baseSepolia");
    process.exit(1);
  }

  const liquidatorAddr = process.env.PRIVATE_LIQUIDATOR;
  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!liquidatorAddr || !oracleAddr) {
    console.error("Set PRIVATE_LIQUIDATOR and FHE_ORACLE_BRIDGE in .env");
    process.exit(1);
  }

  const feedId = BigInt(envInt("FEED_ID", 1));
  const premiumBps = envInt("LIQ_PREMIUM_BPS", 500);
  const crashBps = envInt("CRASH_BPS", 1500);
  const collateralEth = process.env.COLLATERAL_ETH || "0.005";
  const collateral = ethers.parseEther(collateralEth);
  const skipInitial = process.env.SKIP_INITIAL_SUBMIT === "1";

  const [keeper] = await ethers.getSigners();
  const liquidator = await ethers.getContractAt("PrivateLiquidatorCofhe", liquidatorAddr);
  const cofhe = await connectCofhe(ethers.provider, keeper, network.name);

  const snap = await fetchAveragedPrices();
  const spotUsd = feedId === 2n ? snap.btcUsd : snap.ethUsd;
  const spotUint = feedId === 2n ? snap.btcUint : snap.ethUint;
  const liqUsd = spotUsd * (1 + premiumBps / 10000);
  const liqUint = usdToUint8Decimals(liqUsd);
  const crashUsd = spotUsd * (1 - crashBps / 10000);
  const crashUint = usdToUint8Decimals(crashUsd);

  log("0", "Live market snapshot", {
    network: network.name,
    sources: snap.sources,
    spotUsd,
    liqThresholdUsd: liqUsd,
    crashSubmitUsd: crashUsd,
    premiumBps,
    crashBps,
    keeper: keeper.address,
  });

  if (!skipInitial) {
    log("1", "Submit live spot to oracle");
    const sub = await submitLivePrice({
      networkName: network.name,
      feedId,
      priceUint: spotUint,
      label: feedId === 2n ? "BTC/USD" : "ETH/USD",
      feederSigner: keeper,
      cofhe,
    });
    log("1", "Submitted", sub);
  } else {
    log("1", "SKIP_INITIAL_SUBMIT=1 — using existing oracle round");
  }

  log("2", "Open position (encrypted threshold above spot)");
  const encLiq = await encryptUint128(cofhe, liqUint);
  const openTx = await liquidator.connect(keeper).openPosition(feedId, encLiq, { value: collateral });
  const openRc = await openTx.wait();
  const opened = openRc.logs
    .map((l) => {
      try {
        return liquidator.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "PositionOpened");
  const positionId = opened
    ? opened.args.positionId
    : await liquidator.positionCount();
  log("2", `Position ${positionId} opened`, { txHash: openTx.hash, collateralEth });

  log("3", `Submit crash price (${crashBps} bps below spot) — should make position liquidatable`);
  const crashSub = await submitLivePrice({
    networkName: network.name,
    feedId,
    priceUint: crashUint,
    label: "crash",
    feederSigner: keeper,
    cofhe,
  });
  log("3", "Crash price submitted", crashSub);

  log("4", "requestLiquidationCheck");
  const reqTx = await liquidator.connect(keeper).requestLiquidationCheck(positionId);
  const reqRc = await reqTx.wait();
  log("4", "Check requested", { txHash: reqTx.hash });

  log("5", "Keeper: decrypt boolean + completeLiquidation");
  const result = await completeFromReceipt(liquidator, reqRc, keeper, cofhe);

  console.log("\n=== Wave 4 live E2E complete ===");
  console.log(JSON.stringify({
    success: result.isLiquidatable,
    positionId: result.positionId,
    completeTx: result.completeTx,
    spotUsd,
    liqThresholdUsd: liqUsd,
    crashUsd,
    priceSources: snap.sources,
  }, null, 2));

  if (!result.isLiquidatable) {
    console.error(
      "\nPosition was NOT liquidatable. Increase CRASH_BPS or LIQ_PREMIUM_BPS and retry, or ensure oracle round updated."
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

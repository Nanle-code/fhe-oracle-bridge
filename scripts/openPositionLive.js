/**
 * openPositionLive.js — Open a liquidation position with a live-market encrypted threshold (CoFHE testnets).
 *
 *   LIQ_PREMIUM_BPS=500 COLLATERAL_ETH=0.005 FEED_ID=1 \\
 *     npx hardhat run scripts/openPositionLive.js --network arbitrumSepolia
 *
 * LIQ_PREMIUM_BPS: liquidation threshold = live spot * (1 + bps/10000). Default 500 = 5% above spot (healthy).
 */

const { ethers, network } = require("hardhat");
const { fetchAveragedPrices, usdToUint8Decimals } = require("./lib/livePrices");
const { connectCofhe, encryptUint128, chainForNetwork } = require("./lib/cofheNetwork");
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

  const liquidatorAddr = process.env.PRIVATE_LIQUIDATOR;
  if (!liquidatorAddr) {
    console.error("Set PRIVATE_LIQUIDATOR in .env");
    process.exit(1);
  }

  const feedId = BigInt(envInt("FEED_ID", 1));
  const premiumBps = envInt("LIQ_PREMIUM_BPS", 500);
  const collateralEth = process.env.COLLATERAL_ETH || "0.005";
  const collateral = ethers.parseEther(collateralEth);

  const [trader] = await ethers.getSigners();
  const snap = await fetchAveragedPrices();
  const spotUsd = feedId === 2n ? snap.btcUsd : snap.ethUsd;
  const spotUint = feedId === 2n ? snap.btcUint : snap.ethUint;
  const liqUsd = spotUsd * (1 + premiumBps / 10000);
  const liqUint = usdToUint8Decimals(liqUsd);

  const cofhe = await connectCofhe(ethers.provider, trader, network.name);
  const encLiq = await encryptUint128(cofhe, liqUint);

  const liquidator = await ethers.getContractAt("PrivateLiquidatorCofhe", liquidatorAddr);
  const tx = await liquidator.connect(trader).openPosition(feedId, encLiq, { value: collateral });
  const receipt = await tx.wait();

  const opened = receipt.logs
    .map((l) => {
      try {
        return liquidator.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "PositionOpened");

  const positionId = opened ? opened.args.positionId.toString() : (await liquidator.positionCount()).toString();

  console.log(JSON.stringify({
    event: "PositionOpened",
    positionId,
    feedId: feedId.toString(),
    trader: trader.address,
    collateralEth,
    spotUsd,
    spotUint: spotUint.toString(),
    liqThresholdUsd: liqUsd,
    liqThresholdUint: liqUint.toString(),
    liqPremiumBps: premiumBps,
    priceSources: snap.sources,
    txHash: tx.hash,
  }, null, 2));
  console.log(
    `\nPosition ${positionId} opened. Threshold ~$${liqUsd.toFixed(2)} (${premiumBps} bps above live spot $${spotUsd.toFixed(2)}).`
  );
  console.log(`Next: npm run wave4:trigger -- POSITION_ID=${positionId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

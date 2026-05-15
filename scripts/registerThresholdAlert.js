/**
 * registerThresholdAlert.js — Subscribe with an encrypted threshold (CoFHE demo helper)
 *
 * Usage:
 *   FEED_ID=1 MODE=Below THRESHOLD_USD=2500 npx hardhat run scripts/registerThresholdAlert.js --network arbitrumSepolia
 *
 * MODE: Below | Above (Below = alert when spot < X, same8-decimal convention as oracle)
 */

const { ethers, network } = require("hardhat");
const { fetchAveragedPrices, usdToUint8Decimals } = require("./lib/livePrices");
const { connectCofhe, encryptUint128, chainForNetwork } = require("./lib/cofheNetwork");
require("dotenv").config();

async function main() {
  const chain = chainForNetwork(network.name);
  if (!chain) {
    console.error("Use arbitrumSepolia, sepolia, or baseSepolia");
    process.exit(1);
  }

  const alertsAddr = process.env.PRIVATE_THRESHOLD_ALERTS;
  if (!alertsAddr) {
    console.error("Set PRIVATE_THRESHOLD_ALERTS in .env");
    process.exit(1);
  }

  const feedId = BigInt(process.env.FEED_ID || "1");
  const modeStr = (process.env.MODE || "Below").toLowerCase();
  const mode = modeStr === "above" ? 1 : 0;
  let thresholdUsd = process.env.THRESHOLD_USD;
  if (!thresholdUsd) {
    const snap = await fetchAveragedPrices();
    const spot = feedId === 2n ? snap.btcUsd : snap.ethUsd;
    const bps = Number.parseInt(process.env.THRESHOLD_PREMIUM_BPS || "500", 10);
    thresholdUsd = String(spot * (1 + bps / 10000));
    console.log(`THRESHOLD_USD from live spot: $${Number(thresholdUsd).toFixed(2)}`);
  }
  const priceUint = usdToUint8Decimals(thresholdUsd);

  const signers = await ethers.getSigners();
  const subscriber = signers[0];

  const alerts = await ethers.getContractAt("PrivateThresholdAlertsCofhe", alertsAddr);

  const cofhe = await connectCofhe(ethers.provider, subscriber, network.name);
  const payload = await encryptUint128(cofhe, priceUint);

  const tx = await alerts.connect(subscriber).subscribe(feedId, payload, mode);
  const receipt = await tx.wait();

  const ev = receipt.logs
    .map((l) => {
      try {
        return alerts.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "SubscriptionCreated");

  const subId = ev ? ev.args.subId.toString() : "?";

  console.log(`Subscribed subId=${subId} feedId=${feedId} mode=${modeStr} (threshold encrypted on-chain)`);
  console.log(`Next: call prepareThresholdCheck(${subId}) then run thresholdAlertKeeper`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

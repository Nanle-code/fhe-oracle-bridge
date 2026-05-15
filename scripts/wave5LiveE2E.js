/**
 * wave5LiveE2E.js — Live threshold alert on CoFHE testnet (real spot for threshold math).
 *
 * 1. Ensure oracle has fresh price (optional submit)
 * 2. Subscribe with encrypted threshold derived from live spot
 * 3. Submit price that triggers alert
 * 4. prepareThresholdCheck → keeper decrypt → completeThresholdAlert
 *
 *   npx hardhat run scripts/wave5LiveE2E.js --network arbitrumSepolia
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

async function main() {
  if (!chainForNetwork(network.name)) {
    console.error("Use arbitrumSepolia or baseSepolia");
    process.exit(1);
  }

  const alertsAddr = process.env.PRIVATE_THRESHOLD_ALERTS;
  if (!alertsAddr) {
    console.error("Set PRIVATE_THRESHOLD_ALERTS in .env");
    process.exit(1);
  }

  const feedId = BigInt(envInt("FEED_ID", 1));
  const modeStr = (process.env.MODE || "Below").toLowerCase();
  const mode = modeStr === "above" ? 1 : 0;
  const triggerBps = envInt("TRIGGER_BPS", 1500);

  const [keeper] = await ethers.getSigners();
  const alerts = await ethers.getContractAt("PrivateThresholdAlertsCofhe", alertsAddr);
  const cofhe = await connectCofhe(ethers.provider, keeper, network.name);

  const snap = await fetchAveragedPrices();
  const spotUsd = feedId === 2n ? snap.btcUsd : snap.ethUsd;
  const spotUint = feedId === 2n ? snap.btcUint : snap.ethUint;

  let thresholdUsd;
  let triggerUsd;
  // Below: alert when spot < threshold → set threshold above spot, then submit lower price.
  // Above: alert when spot > threshold → set threshold below spot, then submit higher price.
  if (modeStr === "below") {
    thresholdUsd = spotUsd * (1 + triggerBps / 10000);
    triggerUsd = spotUsd * (1 - triggerBps / 10000);
  } else {
    thresholdUsd = spotUsd * (1 - triggerBps / 10000);
    triggerUsd = spotUsd * (1 + triggerBps / 10000);
  }

  const thresholdUint = usdToUint8Decimals(thresholdUsd);
  const triggerUint = usdToUint8Decimals(triggerUsd);

  console.log("Live snapshot", { spotUsd, thresholdUsd, triggerUsd, mode: modeStr, sources: snap.sources });

  if (process.env.SKIP_INITIAL_SUBMIT !== "1") {
    await submitLivePrice({
      networkName: network.name,
      feedId,
      priceUint: spotUint,
      label: "spot",
      feederSigner: keeper,
      cofhe,
    });
  }

  const enc = await encryptUint128(cofhe, thresholdUint);
  const subTx = await alerts.connect(keeper).subscribe(feedId, enc, mode);
  const subRc = await subTx.wait();
  const created = subRc.logs
    .map((l) => {
      try {
        return alerts.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "SubscriptionCreated");
  const subId = created ? created.args.subId : await alerts.subscriptionCount();

  console.log(`Subscribed subId=${subId}`);

  await submitLivePrice({
    networkName: network.name,
    feedId,
    priceUint: triggerUint,
    label: "trigger",
    feederSigner: keeper,
    cofhe,
  });

  const prepTx = await alerts.connect(keeper).prepareThresholdCheck(subId);
  const prepRc = await prepTx.wait();
  const prepared = prepRc.logs
    .map((l) => {
      try {
        return alerts.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "ThresholdCheckPrepared");

  if (!prepared) throw new Error("ThresholdCheckPrepared not found");
  const ctHash = prepared.args.ctHash;

  const { decryptedValue, signature } = await decryptPredicate(cofhe, ctHash);
  const triggered = decryptedValue !== 0n;
  console.log(`Decrypt: triggered=${triggered}`);

  const doneTx = await alerts.connect(keeper).completeThresholdAlert(subId, triggered, signature);
  const doneRc = await doneTx.wait();

  const fired = doneRc.logs
    .map((l) => {
      try {
        return alerts.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "ThresholdAlert");

  console.log(JSON.stringify({
    success: triggered && !!fired,
    subId: subId.toString(),
    triggered,
    prepareTx: prepTx.hash,
    completeTx: doneTx.hash,
  }, null, 2));

  if (!triggered) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

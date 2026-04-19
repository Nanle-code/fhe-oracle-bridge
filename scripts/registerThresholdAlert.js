/**
 * registerThresholdAlert.js — Subscribe with an encrypted threshold (CoFHE demo helper)
 *
 * Usage:
 *   FEED_ID=1 MODE=Below THRESHOLD_USD=2500 npx hardhat run scripts/registerThresholdAlert.js --network arbitrumSepolia
 *
 * MODE: Below | Above (Below = alert when spot < X, same8-decimal convention as oracle)
 */

const { ethers, network } = require("hardhat");
const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
const { chains } = require("@cofhe/sdk/chains");
const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
const { Encryptable } = require("@cofhe/sdk");
require("dotenv").config();

function chainForNetwork() {
  if (network.name === "arbitrumSepolia") return chains.arbSepolia;
  if (network.name === "sepolia") return chains.sepolia;
  if (network.name === "baseSepolia") return chains.baseSepolia;
  return null;
}

function usdToUint8Decimals(usd) {
  const scaled = Math.round(Number(usd) * 1e8);
  if (!Number.isFinite(scaled)) throw new Error("Invalid THRESHOLD_USD");
  return BigInt(scaled);
}

async function main() {
  const chain = chainForNetwork();
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
  const thresholdUsd = process.env.THRESHOLD_USD || "2000";
  const priceUint = usdToUint8Decimals(thresholdUsd);

  const signers = await ethers.getSigners();
  const subscriber = signers[0];

  const alerts = await ethers.getContractAt("PrivateThresholdAlertsCofhe", alertsAddr);

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [chain] }));
  const { publicClient, walletClient } = await Ethers6Adapter(ethers.provider, subscriber);
  await cofhe.connect(publicClient, walletClient);

  const [enc] = await cofhe.encryptInputs([Encryptable.uint128(priceUint)]).execute();
  const payload = {
    ctHash: enc.ctHash,
    securityZone: enc.securityZone,
    utype: enc.utype,
    signature: enc.signature,
  };

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

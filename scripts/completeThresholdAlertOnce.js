/**
 * completeThresholdAlertOnce.js — One-shot decrypt + completeThresholdAlert.
 *
 *   SUB_ID=1 npx hardhat run scripts/completeThresholdAlertOnce.js --network arbitrumSepolia
 */

const { ethers, network } = require("hardhat");
const { chainForNetwork, connectCofhe, decryptPredicate } = require("./lib/cofheNetwork");
require("dotenv").config();

async function main() {
  if (!chainForNetwork(network.name)) {
    console.error("Use arbitrumSepolia or baseSepolia");
    process.exit(1);
  }

  const alertsAddr = process.env.PRIVATE_THRESHOLD_ALERTS;
  const subId = process.env.SUB_ID;
  if (!alertsAddr || !subId) {
    console.error("Set PRIVATE_THRESHOLD_ALERTS and SUB_ID");
    process.exit(1);
  }

  const [keeper] = await ethers.getSigners();
  const alerts = await ethers.getContractAt("PrivateThresholdAlertsCofhe", alertsAddr);
  const filter = alerts.filters.ThresholdCheckPrepared(null, null, null);

  let fromBlock = Number.parseInt(process.env.KEEPER_FROM_BLOCK || "0", 10);
  const head = await ethers.provider.getBlockNumber();
  if (!fromBlock) fromBlock = Math.max(0, head - 50_000);

  const events = await alerts.queryFilter(filter, fromBlock, head);
  const match = events.filter((e) => e.args.subId.toString() === subId);
  if (!match.length) {
    console.error("No ThresholdCheckPrepared for SUB_ID");
    process.exit(1);
  }
  const ev = match[match.length - 1];
  const ctHash = ev.args.ctHash;

  const cofhe = await connectCofhe(ethers.provider, keeper, network.name);
  const { decryptedValue, signature } = await decryptPredicate(cofhe, ctHash);
  const triggered = decryptedValue !== 0n;

  const tx = await alerts.connect(keeper).completeThresholdAlert(subId, triggered, signature);
  const receipt = await tx.wait();

  console.log(JSON.stringify({
    subId,
    triggered,
    txHash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

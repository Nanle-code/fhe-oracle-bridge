/**
 * prepareThresholdCheck.js — On-chain encrypted compare; emits ThresholdCheckPrepared for the keeper.
 *
 *   SUB_ID=1 npx hardhat run scripts/prepareThresholdCheck.js --network arbitrumSepolia
 */

const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const alertsAddr = process.env.PRIVATE_THRESHOLD_ALERTS;
  if (!alertsAddr) {
    console.error("Set PRIVATE_THRESHOLD_ALERTS");
    process.exit(1);
  }
  const subId = process.env.SUB_ID || "1";

  const [caller] = await ethers.getSigners();
  const alerts = await ethers.getContractAt("PrivateThresholdAlertsCofhe", alertsAddr);
  const tx = await alerts.connect(caller).prepareThresholdCheck(subId);
  const receipt = await tx.wait();
  console.log(`prepareThresholdCheck subId=${subId} tx=${tx.hash} gas=${receipt.gasUsed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * requestLiquidationCheck.js — On-chain FHE compare; emits LiquidationCheckPrepared for the keeper.
 *
 *   POSITION_ID=1 npx hardhat run scripts/requestLiquidationCheck.js --network arbitrumSepolia
 */

const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const liquidatorAddr = process.env.PRIVATE_LIQUIDATOR;
  if (!liquidatorAddr) {
    console.error("Set PRIVATE_LIQUIDATOR in .env");
    process.exit(1);
  }
  const positionId = process.env.POSITION_ID;
  if (!positionId) {
    console.error("Set POSITION_ID");
    process.exit(1);
  }

  const [caller] = await ethers.getSigners();
  const liquidator = await ethers.getContractAt("PrivateLiquidatorCofhe", liquidatorAddr);
  const tx = await liquidator.connect(caller).requestLiquidationCheck(positionId);
  const receipt = await tx.wait();

  const prepared = receipt.logs
    .map((l) => {
      try {
        return liquidator.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "LiquidationCheckPrepared");

  const ctHash = prepared ? prepared.args.ctHash.toString() : "?";

  console.log(JSON.stringify({
    event: "LiquidationCheckPrepared",
    positionId,
    ctHash,
    txHash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));
  console.log(`\nRun keeper: POSITION_ID=${positionId} npm run wave4:complete`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

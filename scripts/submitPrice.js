/**
 * submitPrice.js — Manual price submission script
 *
 * Simulates a feeder pushing an encrypted price to the oracle.
 * On Fhenix testnet, replace the raw uint256 with CoFHE SDK encryption:
 *
 *   import { FhenixClient } from "@fhenixprotocol/sdk";
 *   const client = new FhenixClient({ provider });
 *   const encPrice = await client.encrypt_uint256(price);
 *   await oracle.submitPrice(feedId, encPrice);
 *
 * Usage:
 *   npx hardhat run scripts/submitPrice.js --network hardhat
 */

const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [, feeder] = await ethers.getSigners();

  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!oracleAddr) {
    console.error("Set FHE_ORACLE_BRIDGE in .env first (run deploy.js)");
    process.exit(1);
  }

  const oracle = await ethers.getContractAt("FHEOracleBridge", oracleAddr);

  // Prices with 8 decimals (Chainlink convention)
  const prices = [
    { feedId: 1n, price: 3500_00000000n, label: "ETH/USD = $3,500" },
    { feedId: 2n, price: 67000_00000000n, label: "BTC/USD = $67,000" },
  ];

  console.log("\n=== Submitting encrypted prices ===\n");

  for (const { feedId, price, label } of prices) {
    console.log(`Submitting ${label}...`);
    const tx = await oracle.connect(feeder).submitPrice(feedId, price);
    const receipt = await tx.wait();
    console.log(`  Tx:       ${tx.hash}`);
    console.log(`  Gas used: ${receipt.gasUsed}\n`);
  }

  console.log("Done. Prices stored as euint256 — unreadable on-chain.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * setupSecondFeeder.js — Register FEEDER2_PRIVATE_KEY on the oracle and stake (owner + feeder2).
 *
 *   npx hardhat run scripts/setupSecondFeeder.js --network arbitrumSepolia
 */

const { ethers, network } = require("hardhat");
require("dotenv").config();

async function main() {
  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!oracleAddr) {
    console.error("Set FHE_ORACLE_BRIDGE");
    process.exit(1);
  }
  if (!process.env.FEEDER2_PRIVATE_KEY) {
    console.error("Set FEEDER2_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const signers = await ethers.getSigners();
  const owner = signers[0];
  const feeder2 = signers[1];
  if (!feeder2) {
    console.error("FEEDER2_PRIVATE_KEY must be in hardhat accounts (second key in .env)");
    process.exit(1);
  }

  const oracle = await ethers.getContractAt("FHEOracleBridgeCofhe", oracleAddr);
  const isFeeder = await oracle.feeders(feeder2.address);
  if (!isFeeder) {
    const tx = await oracle.connect(owner).addFeeder(feeder2.address);
    await tx.wait();
    console.log(`Registered feeder ${feeder2.address}`);
  } else {
    console.log(`Feeder already registered: ${feeder2.address}`);
  }

  const stake = await oracle.feederStake(feeder2.address);
  const min = ethers.parseEther("0.01");
  if (stake < min) {
    const tx = await oracle.connect(feeder2).stake({ value: min - stake });
    await tx.wait();
    console.log(`Staked feeder2 to min 0.01 ETH`);
  } else {
    console.log(`Feeder2 stake OK: ${ethers.formatEther(stake)} ETH`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

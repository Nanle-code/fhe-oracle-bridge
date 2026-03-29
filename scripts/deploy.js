/**
 * deploy.js — FHE Oracle Bridge deployment script
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network hardhat
 *   npx hardhat run scripts/deploy.js --network helium
 *   npx hardhat run scripts/deploy.js --network arbitrumSepolia
 *
 * After deployment, copy the contract addresses into your .env:
 *   ACCESS_REGISTRY=0x...
 *   FHE_ORACLE_BRIDGE=0x...
 *   MOCK_CONSUMER=0x...
 *   PRIVATE_LIQUIDATOR=0x...
 */

const { ethers } = require("hardhat");

async function main() {
  const [deployer, feeder1, feeder2] = await ethers.getSigners();

  console.log("\n=== FHE Oracle Bridge Deployment ===");
  console.log(`Network:  ${(await ethers.provider.getNetwork()).name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ── 1. Deploy AccessRegistry ──────────────────────────────────────────────
  console.log("1. Deploying AccessRegistry...");
  const Registry = await ethers.getContractFactory("AccessRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`   AccessRegistry:    ${registryAddr}`);

  // ── 2. Deploy FHEOracleBridge ─────────────────────────────────────────────
  console.log("2. Deploying FHEOracleBridge...");
  const Oracle = await ethers.getContractFactory("FHEOracleBridge");
  const oracle = await Oracle.deploy(registryAddr);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`   FHEOracleBridge:   ${oracleAddr}`);

  // ── 3. Deploy MockConsumer ────────────────────────────────────────────────
  console.log("3. Deploying MockConsumer...");
  const Consumer = await ethers.getContractFactory("MockConsumer");
  const consumer = await Consumer.deploy(oracleAddr);
  await consumer.waitForDeployment();
  const consumerAddr = await consumer.getAddress();
  console.log(`   MockConsumer:      ${consumerAddr}`);

  // ── 4. Deploy PrivateLiquidator ───────────────────────────────────────────
  console.log("4. Deploying PrivateLiquidator...");
  const Liquidator = await ethers.getContractFactory("PrivateLiquidator");
  const liquidator = await Liquidator.deploy(oracleAddr);
  await liquidator.waitForDeployment();
  const liquidatorAddr = await liquidator.getAddress();
  console.log(`   PrivateLiquidator: ${liquidatorAddr}`);

  // ── 5. Configure feeds ────────────────────────────────────────────────────
  console.log("\n5. Creating price feeds...");
  await (await oracle.createFeed("ETH / USD", 3600, 1)).wait();
  console.log("   Feed 1: ETH / USD (TTL: 1h, minFeeders: 1)");
  await (await oracle.createFeed("BTC / USD", 3600, 1)).wait();
  console.log("   Feed 2: BTC / USD (TTL: 1h, minFeeders: 1)");

  // ── 6. Register feeders ───────────────────────────────────────────────────
  console.log("\n6. Registering feeders...");
  await (await oracle.addFeeder(feeder1.address)).wait();
  console.log(`   Feeder 1: ${feeder1.address}`);

  if (feeder2) {
    await (await oracle.addFeeder(feeder2.address)).wait();
    console.log(`   Feeder 2: ${feeder2.address}`);
  }

  // ── 7. Whitelist consumers ────────────────────────────────────────────────
  console.log("\n7. Whitelisting consumers...");
  await (await registry.whitelist(consumerAddr, "MockConsumer v1")).wait();
  console.log(`   Whitelisted: MockConsumer`);
  await (await registry.whitelist(liquidatorAddr, "PrivateLiquidator v1")).wait();
  console.log(`   Whitelisted: PrivateLiquidator`);

  // ── 8. Feeder stakes ETH ──────────────────────────────────────────────────
  console.log("\n8. Feeder staking...");
  const stakeAmount = ethers.parseEther("0.01");
  try {
    await (await oracle.connect(feeder1).stake({ value: stakeAmount })).wait();
    console.log(`   Feeder 1 staked ${ethers.formatEther(stakeAmount)} ETH`);
  } catch (e) {
    console.log("   (Skipping stake — feeder has no ETH on this network)");
  }

  // ── 9. Summary ────────────────────────────────────────────────────────────
  console.log("\n=== Deployment Complete ===");
  console.log(`
ACCESS_REGISTRY=${registryAddr}
FHE_ORACLE_BRIDGE=${oracleAddr}
MOCK_CONSUMER=${consumerAddr}
PRIVATE_LIQUIDATOR=${liquidatorAddr}
  `);

  console.log("Next steps:");
  console.log("  1. Copy the addresses above into your .env");
  console.log("  2. Run: npx hardhat run scripts/submitPrice.js --network <network>");
  console.log("  3. Run: npx hardhat run scripts/demoFlow.js --network <network>\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

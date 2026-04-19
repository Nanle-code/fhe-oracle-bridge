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
 *   PRIVATE_THRESHOLD_ALERTS=0x...  (CoFHE networks only)
 */

const { ethers, network } = require("hardhat");

function getDeploymentContractNames(networkName) {
  const isLocal = networkName === "hardhat" || networkName === "localhost";
  const isNativeFhenix = networkName === "helium";
  const isCofhe = networkName === "sepolia" || networkName === "arbitrumSepolia" || networkName === "baseSepolia";
  return {
    mode: isLocal ? "local" : isNativeFhenix ? "fhenix" : isCofhe ? "cofhe" : "unknown",
    oracle: isLocal ? "FHEOracleBridge" : isNativeFhenix ? "FHEOracleBridgeFhenix" : isCofhe ? "FHEOracleBridgeCofhe" : "FHEOracleBridge",
    consumer: isLocal ? "MockConsumer" : isNativeFhenix ? "MockConsumerFhenix" : isCofhe ? "MockConsumerCofhe" : "MockConsumer",
    liquidator: isLocal ? "PrivateLiquidator" : isNativeFhenix ? "PrivateLiquidatorFhenix" : isCofhe ? "PrivateLiquidatorCofhe" : "PrivateLiquidator",
  };
}

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, feeder1, feeder2] = signers;
  const names = getDeploymentContractNames(network.name);
  const actualFeeder1 = feeder1 || deployer;

  /** CoFHE: every funded key in hardhat `accounts` is a feeder; quorum = min(3, #keys) when 2+ keys. */
  const cofheMultiFeeder = names.mode === "cofhe" && signers.length >= 2;
  const quorumMinFeeders = cofheMultiFeeder ? Math.min(3, signers.length) : 1;
  const cofheFeederSigners = names.mode === "cofhe" ? signers : null;

  console.log("\n=== FHE Oracle Bridge Deployment ===");
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);
  console.log(`Mode:     ${names.mode}`);
  if (names.mode === "cofhe") {
    console.log(`Signers:  ${signers.length} (set FEEDER2_PRIVATE_KEY / FEEDER3_PRIVATE_KEY for quorum)`);
    console.log(`Quorum:   minFeeders=${quorumMinFeeders}${cofheMultiFeeder ? " (round finalizes only after this many distinct feeder txs)" : " (single-feeder dev)"}\n`);
  } else {
    console.log("");
  }

  // ── 1. Deploy AccessRegistry ──────────────────────────────────────────────
  console.log("1. Deploying AccessRegistry...");
  const Registry = await ethers.getContractFactory("AccessRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`   AccessRegistry:    ${registryAddr}`);

  // ── 2. Deploy FHEOracleBridge ─────────────────────────────────────────────
  console.log("2. Deploying FHEOracleBridge...");
  const Oracle = await ethers.getContractFactory(names.oracle);
  const oracle = await Oracle.deploy(registryAddr);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`   FHEOracleBridge:   ${oracleAddr}`);

  // ── 3. Deploy MockConsumer ────────────────────────────────────────────────
  console.log("3. Deploying MockConsumer...");
  const Consumer = await ethers.getContractFactory(names.consumer);
  const consumer = await Consumer.deploy(oracleAddr);
  await consumer.waitForDeployment();
  const consumerAddr = await consumer.getAddress();
  console.log(`   MockConsumer:      ${consumerAddr}`);

  // ── 4. Deploy PrivateLiquidator ───────────────────────────────────────────
  console.log("4. Deploying PrivateLiquidator...");
  const Liquidator = await ethers.getContractFactory(names.liquidator);
  const liquidator = await Liquidator.deploy(oracleAddr);
  await liquidator.waitForDeployment();
  const liquidatorAddr = await liquidator.getAddress();
  console.log(`   PrivateLiquidator: ${liquidatorAddr}`);

  let thresholdAlertsAddr = "";
  if (names.mode === "cofhe") {
    console.log("4b. Deploying PrivateThresholdAlertsCofhe...");
    const Alerts = await ethers.getContractFactory("PrivateThresholdAlertsCofhe");
    const alerts = await Alerts.deploy(oracleAddr);
    await alerts.waitForDeployment();
    thresholdAlertsAddr = await alerts.getAddress();
    console.log(`   PrivateThresholdAlerts: ${thresholdAlertsAddr}`);
  }

  // ── 5. Configure feeds ────────────────────────────────────────────────────
  console.log("\n5. Creating price feeds...");
  await (await oracle.createFeed("ETH / USD", 3600, quorumMinFeeders)).wait();
  console.log(`   Feed 1: ETH / USD (TTL: 1h, minFeeders: ${quorumMinFeeders})`);
  await (await oracle.createFeed("BTC / USD", 3600, quorumMinFeeders)).wait();
  console.log(`   Feed 2: BTC / USD (TTL: 1h, minFeeders: ${quorumMinFeeders})`);

  // ── 6. Register feeders ───────────────────────────────────────────────────
  console.log("\n6. Registering feeders...");
  if (cofheFeederSigners) {
    for (let i = 0; i < cofheFeederSigners.length; i++) {
      const f = cofheFeederSigners[i];
      await (await oracle.addFeeder(f.address)).wait();
      console.log(`   Feeder ${i + 1}: ${f.address}`);
    }
  } else {
    await (await oracle.addFeeder(actualFeeder1.address)).wait();
    console.log(`   Feeder 1: ${actualFeeder1.address}`);

    if (feeder2) {
      await (await oracle.addFeeder(feeder2.address)).wait();
      console.log(`   Feeder 2: ${feeder2.address}`);
    }
  }

  // ── 7. Whitelist consumers ────────────────────────────────────────────────
  console.log("\n7. Whitelisting consumers...");
  await (await registry.whitelist(consumerAddr, "MockConsumer v1")).wait();
  console.log(`   Whitelisted: MockConsumer`);
  await (await registry.whitelist(liquidatorAddr, "PrivateLiquidator v1")).wait();
  console.log(`   Whitelisted: PrivateLiquidator`);
  if (thresholdAlertsAddr) {
    await (await registry.whitelist(thresholdAlertsAddr, "PrivateThresholdAlerts v1")).wait();
    console.log(`   Whitelisted: PrivateThresholdAlerts`);
  }

  // ── 8. Feeder stakes ETH ──────────────────────────────────────────────────
  console.log("\n8. Feeder staking...");
  const stakeAmount = ethers.parseEther("0.01");
  const stakeList = cofheFeederSigners || [actualFeeder1, feeder2].filter(Boolean);
  for (let i = 0; i < stakeList.length; i++) {
    const f = stakeList[i];
    try {
      await (await oracle.connect(f).stake({ value: stakeAmount })).wait();
      console.log(`   ${f.address} staked ${ethers.formatEther(stakeAmount)} ETH`);
    } catch (e) {
      console.log(`   (Skipping stake for ${f.address} — insufficient ETH?)`);
    }
  }

  // ── 9. Summary ────────────────────────────────────────────────────────────
  console.log("\n=== Deployment Complete ===");
  console.log(`
ACCESS_REGISTRY=${registryAddr}
FHE_ORACLE_BRIDGE=${oracleAddr}
MOCK_CONSUMER=${consumerAddr}
PRIVATE_LIQUIDATOR=${liquidatorAddr}${thresholdAlertsAddr ? `\nPRIVATE_THRESHOLD_ALERTS=${thresholdAlertsAddr}` : ""}
  `);

  console.log("Next steps:");
  console.log("  1. Copy the addresses above into your .env");
  if (cofheMultiFeeder) {
    console.log("  2. Run two feeder daemons: FEEDER_SIGNER_INDEX=0 npm run feeder:arbitrum-sepolia  AND  FEEDER_SIGNER_INDEX=1 ...");
    console.log("     First submit emits QuorumPending; aggregate updates after the 2nd (or 3rd) feeder submits.");
  } else {
    console.log("  2. Run: npx hardhat run scripts/submitPrice.js --network <network>");
  }
  console.log("  3. Run: npx hardhat run scripts/demoFlow.js --network <network>\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

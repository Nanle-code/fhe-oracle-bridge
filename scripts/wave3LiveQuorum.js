/**
 * wave3LiveQuorum.js — Two feeders submit live prices; round finalizes after quorum (minFeeders).
 *
 * Requires:
 *   - FEEDER2_PRIVATE_KEY in .env (feeder 2 registered + staked — run setupSecondFeeder.js)
 *   - Feeds with minFeeders >= 2 (run createQuorumFeeds.js or deploy with quorum)
 *
 *   FEED_ETH_ID=3 FEED_BTC_ID=4 npx hardhat run scripts/wave3LiveQuorum.js --network arbitrumSepolia
 */

const { ethers, network } = require("hardhat");
const { fetchAveragedPrices } = require("./lib/livePrices");
const { connectCofhe, chainForNetwork } = require("./lib/cofheNetwork");
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
  if (!process.env.FEEDER2_PRIVATE_KEY) {
    console.error("Set FEEDER2_PRIVATE_KEY and run setupSecondFeeder.js first");
    process.exit(1);
  }

  const feedEthId = BigInt(envInt("FEED_ETH_ID", 1));
  const feedBtcId = BigInt(envInt("FEED_BTC_ID", 2));
  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  const oracle = await ethers.getContractAt("FHEOracleBridgeCofhe", oracleAddr);

  const info = await oracle.getFeedInfo(feedEthId);
  const minFeeders = Number(info[4]);
  if (minFeeders < 2) {
    console.warn(
      `WARN: feed ${feedEthId} minFeeders=${minFeeders}. Run createQuorumFeeds.js and set FEED_ETH_ID / FEED_BTC_ID.`
    );
  }

  const signers = await ethers.getSigners();
  const feeder1 = signers[0];
  const feeder2 = signers[1];
  const snap = await fetchAveragedPrices();
  console.log("Live spot", { ethUsd: snap.ethUsd, btcUsd: snap.btcUsd, sources: snap.sources });

  const cofhe1 = await connectCofhe(ethers.provider, feeder1, network.name);
  const cofhe2 = await connectCofhe(ethers.provider, feeder2, network.name);

  const roundBefore = await oracle.getFeedInfo(feedEthId);
  const roundIdBefore = roundBefore[2];

  console.log("\n--- Feeder 1: ETH submit (expect QuorumPending if minFeeders=2) ---");
  const sub1 = await submitLivePrice({
    networkName: network.name,
    feedId: feedEthId,
    priceUint: snap.ethUint,
    label: "ETH feeder1",
    feederSigner: feeder1,
    cofhe: cofhe1,
  });
  console.log(sub1);

  let infoMid = await oracle.getFeedInfo(feedEthId);
  console.log(`After feeder1: roundId=${infoMid[2]} (was ${roundIdBefore})`);

  console.log("\n--- Feeder 2: ETH submit (expect FeedUpdated / median) ---");
  const sub2 = await submitLivePrice({
    networkName: network.name,
    feedId: feedEthId,
    priceUint: snap.ethUint,
    label: "ETH feeder2",
    feederSigner: feeder2,
    cofhe: cofhe2,
  });
  console.log(sub2);

  const infoAfter = await oracle.getFeedInfo(feedEthId);
  console.log(`After feeder2: roundId=${infoAfter[2]} lastUpdated=${infoAfter[1]}`);

  if (infoAfter[2] <= roundIdBefore && minFeeders >= 2) {
    console.error("Round did not advance — quorum may have failed");
    process.exit(1);
  }

  console.log("\n--- BTC: both feeders ---");
  await submitLivePrice({
    networkName: network.name,
    feedId: feedBtcId,
    priceUint: snap.btcUint,
    label: "BTC f1",
    feederSigner: feeder1,
    cofhe: cofhe1,
  });
  await submitLivePrice({
    networkName: network.name,
    feedId: feedBtcId,
    priceUint: snap.btcUint,
    label: "BTC f2",
    feederSigner: feeder2,
    cofhe: cofhe2,
  });

  console.log("\nWave 3 quorum demo complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

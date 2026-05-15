/**
 * createQuorumFeeds.js — Add ETH/BTC feeds with minFeeders=2 (does not replace feed 1/2).
 *
 * New feed IDs are returned for use in wave3LiveQuorum.js (FEED_ETH_ID / FEED_BTC_ID).
 *
 *   npx hardhat run scripts/createQuorumFeeds.js --network arbitrumSepolia
 */

const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!oracleAddr) {
    console.error("Set FHE_ORACLE_BRIDGE");
    process.exit(1);
  }

  const [owner] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("FHEOracleBridgeCofhe", oracleAddr);
  const before = await oracle.feedCount();

  const tx1 = await oracle.connect(owner).createFeed("ETH / USD (quorum)", 3600, 2);
  await tx1.wait();
  const tx2 = await oracle.connect(owner).createFeed("BTC / USD (quorum)", 3600, 2);
  await tx2.wait();

  const after = await oracle.feedCount();
  const ethId = Number(before) + 1;
  const btcId = Number(before) + 2;

  console.log(JSON.stringify({
    event: "QuorumFeedsCreated",
    ethFeedId: ethId,
    btcFeedId: btcId,
    minFeeders: 2,
    ttlSeconds: 3600,
    note: "Set FEED_ETH_ID and FEED_BTC_ID for wave3:quorum",
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

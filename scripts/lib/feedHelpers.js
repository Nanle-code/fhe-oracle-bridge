const { ethers } = require("hardhat");

const ORACLE_FEED_ABI = [
  "function getFeedInfo(uint256) view returns (string description, uint256 lastUpdated, uint256 roundId, uint256 ttl, uint8 minFeeders, bool active, bool isStale)",
  "function pendingSubmissions(uint256) view returns (uint256)",
  "function feeders(address) view returns (bool)",
  "function feederStake(address) view returns (uint256)",
];

/**
 * Ensure the signer can submit prices (registered feeder with MIN_STAKE).
 */
async function assertFeederReady(oracle, feederAddress, minStakeWei = ethers.parseEther("0.01")) {
  const isFeeder = await oracle.feeders(feederAddress);
  if (!isFeeder) {
    throw new Error(
      `Wallet ${feederAddress} is not a registered feeder. Re-run deploy or call oracle.addFeeder + stake.`
    );
  }
  const stake = await oracle.feederStake(feederAddress);
  if (stake < minStakeWei) {
    throw new Error(
      `Feeder ${feederAddress} stake ${ethers.formatEther(stake)} ETH < minimum. Call oracle.stake({ value: "0.01 ether" }).`
    );
  }
}

/**
 * Read feed metadata for a feedId.
 */
async function readFeedInfo(oracle, feedId) {
  const [description, lastUpdated, roundId, ttl, minFeeders, active, isStale] =
    await oracle.getFeedInfo(feedId);
  return {
    description,
    lastUpdated: Number(lastUpdated),
    roundId: Number(roundId),
    ttl: Number(ttl),
    minFeeders: Number(minFeeders),
    active,
    isStale,
  };
}

/**
 * After submitPrice, confirm the round finalized (or explain quorum pending).
 */
async function assertFeedRoundUpdated(oracle, feedId, beforeInfo) {
  const after = await readFeedInfo(oracle, feedId);
  const roundAdvanced = after.roundId > beforeInfo.roundId;
  const timeAdvanced = after.lastUpdated > beforeInfo.lastUpdated;

  if (roundAdvanced || timeAdvanced) {
    return after;
  }

  const pending = Number(await oracle.pendingSubmissions(feedId));
  if (pending > 0 && pending < after.minFeeders) {
    throw new Error(
      `Quorum pending on feed ${feedId}: ${pending}/${after.minFeeders} feeder(s) submitted this round. ` +
        `Run a second feeder (FEEDER2_PRIVATE_KEY + FEEDER_SIGNER_INDEX=1) or lower minFeeders on-chain.`
    );
  }

  throw new Error(
    `Feed ${feedId} did not update after submitPrice (round ${beforeInfo.roundId} → ${after.roundId}). ` +
      `Check feeder registration, stake, and that the feed is active.`
  );
}

module.exports = {
  ORACLE_FEED_ABI,
  assertFeederReady,
  readFeedInfo,
  assertFeedRoundUpdated,
};

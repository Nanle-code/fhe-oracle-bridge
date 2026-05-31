const { ethers } = require("hardhat");
const { getSubmissionMode, connectCofhe, encryptUint128 } = require("./cofheNetwork");
const { assertFeederReady, readFeedInfo, assertFeedRoundUpdated } = require("./feedHelpers");

async function submitLivePrice({ networkName, feedId, priceUint, label, feederSigner, cofhe, verifyUpdate = true }) {
  const { mode, oracle: oracleName } = getSubmissionMode(networkName);
  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!oracleAddr) throw new Error("Set FHE_ORACLE_BRIDGE in .env");

  const oracle = await ethers.getContractAt(oracleName, oracleAddr);
  const feeder = feederSigner ?? (await ethers.getSigners())[0];

  if (mode === "cofhe") {
    await assertFeederReady(oracle, feeder.address);
  }

  const beforeInfo = verifyUpdate ? await readFeedInfo(oracle, feedId) : null;

  let payload;
  if (mode === "local") {
    payload = priceUint;
  } else if (mode === "cofhe") {
    const client = cofhe ?? (await connectCofhe(ethers.provider, feeder, networkName));
    payload = await encryptUint128(client, priceUint);
  } else {
    throw new Error(`submitLivePrice: unsupported network mode ${mode}`);
  }

  const tx = await oracle.connect(feeder).submitPrice(feedId, payload);
  const receipt = await tx.wait();

  let feedInfo = beforeInfo;
  if (verifyUpdate && beforeInfo) {
    feedInfo = await assertFeedRoundUpdated(oracle, feedId, beforeInfo);
  }

  return {
    txHash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
    label,
    feedId: feedId.toString(),
    roundId: feedInfo?.roundId,
  };
}

module.exports = { submitLivePrice };

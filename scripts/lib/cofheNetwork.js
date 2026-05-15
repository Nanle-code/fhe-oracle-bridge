const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
const { chains } = require("@cofhe/sdk/chains");
const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
const { Encryptable } = require("@cofhe/sdk");

function chainForNetwork(networkName) {
  if (networkName === "arbitrumSepolia") return chains.arbSepolia;
  if (networkName === "sepolia") return chains.sepolia;
  if (networkName === "baseSepolia") return chains.baseSepolia;
  return null;
}

function getSubmissionMode(networkName) {
  const isLocal = networkName === "hardhat" || networkName === "localhost";
  const isNativeFhenix = networkName === "helium";
  const isCofhe =
    networkName === "sepolia" || networkName === "arbitrumSepolia" || networkName === "baseSepolia";
  return {
    mode: isLocal ? "local" : isNativeFhenix ? "fhenix" : isCofhe ? "cofhe" : "unknown",
    oracle: isLocal
      ? "FHEOracleBridge"
      : isNativeFhenix
        ? "FHEOracleBridgeFhenix"
        : isCofhe
          ? "FHEOracleBridgeCofhe"
          : "FHEOracleBridge",
  };
}

function isTransientCofheError(err) {
  const walk = (e, depth) => {
    if (!e || typeof e !== "object" || depth > 6) return false;
    const code = e.code;
    const msg = `${e.message || ""} ${e.shortMessage || ""}`.toLowerCase();
    if (
      code === "ZK_VERIFY_FAILED" ||
      code === "ETIMEDOUT" ||
      code === "TIMEOUT" ||
      code === "ENETUNREACH" ||
      code === "EAI_AGAIN" ||
      code === "ECONNREFUSED" ||
      code === "ECONNRESET"
    ) {
      return true;
    }
    if (code === "SERVER_ERROR" || code === "NETWORK_ERROR") return true;
    if (msg.includes("fetch failed") || msg.includes("timeout") || msg.includes("connect timeout")) {
      return true;
    }
    if (Array.isArray(e.errors)) {
      return e.errors.some((sub) => walk(sub, depth + 1));
    }
    return walk(e.cause, depth + 1);
  };
  return walk(err, 0);
}

async function withCofheRetries(label, fn, maxAttempts = 10) {
  const backoffs = [2000, 5000, 10000, 15000, 20000, 30000, 45000, 60000, 60000, 90000];
  let last;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientCofheError(e) || i === maxAttempts - 1) throw e;
      const wait = backoffs[Math.min(i, backoffs.length - 1)];
      console.warn(`[cofhe] ${label} transient error, retry ${i + 2}/${maxAttempts} in ${wait}ms: ${e.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

async function connectCofhe(ethersProvider, signer, networkName) {
  return withCofheRetries("connectCofhe", async () => {
    const chain = chainForNetwork(networkName);
    if (!chain) throw new Error(`CoFHE not configured for network: ${networkName}`);
    const cofhe = createCofheClient(createCofheConfig({ supportedChains: [chain] }));
    const { publicClient, walletClient } = await Ethers6Adapter(ethersProvider, signer);
    await cofhe.connect(publicClient, walletClient);
    return cofhe;
  }, 8);
}

async function encryptUint128(cofhe, priceUint) {
  return withCofheRetries("encryptUint128", async () => {
    const [enc] = await cofhe.encryptInputs([Encryptable.uint128(priceUint)]).execute();
    return {
      ctHash: enc.ctHash,
      securityZone: enc.securityZone,
      utype: enc.utype,
      signature: enc.signature,
    };
  });
}

async function decryptPredicate(cofhe, ctHash) {
  return withCofheRetries("decryptForTx", () => cofhe.decryptForTx(ctHash).withoutPermit().execute());
}

module.exports = {
  chainForNetwork,
  getSubmissionMode,
  connectCofhe,
  encryptUint128,
  decryptPredicate,
  withCofheRetries,
};

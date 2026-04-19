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

const { ethers, network } = require("hardhat");
const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
const { chains } = require("@cofhe/sdk/chains");
const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
const { Encryptable } = require("@cofhe/sdk");
require("dotenv").config();

function getSubmissionMode(networkName) {
  const isLocal = networkName === "hardhat" || networkName === "localhost";
  const isNativeFhenix = networkName === "helium";
  const isCofhe = networkName === "sepolia" || networkName === "arbitrumSepolia" || networkName === "baseSepolia";
  return {
    mode: isLocal ? "local" : isNativeFhenix ? "fhenix" : isCofhe ? "cofhe" : "unknown",
    oracle: isLocal ? "FHEOracleBridge" : isNativeFhenix ? "FHEOracleBridgeFhenix" : isCofhe ? "FHEOracleBridgeCofhe" : "FHEOracleBridge",
  };
}

async function main() {
  const signers = await ethers.getSigners();
  const idx = Number.parseInt(process.env.FEEDER_SIGNER_INDEX || "0", 10);
  const feeder = signers[idx];
  if (!feeder) {
    console.error(
      `FEEDER_SIGNER_INDEX=${idx} but only ${signers.length} signer(s). Set FEEDER2_PRIVATE_KEY in .env for a second feeder.`
    );
    process.exit(1);
  }
  const mode = getSubmissionMode(network.name);

  const oracleAddr = process.env.FHE_ORACLE_BRIDGE;
  if (!oracleAddr) {
    console.error("Set FHE_ORACLE_BRIDGE in .env first (run deploy.js)");
    process.exit(1);
  }

  const oracle = await ethers.getContractAt(mode.oracle, oracleAddr);

  // Prices with 8 decimals (Chainlink convention)
  const prices = [
    { feedId: 1n, price: 3500_00000000n, label: "ETH/USD = $3,500" },
    { feedId: 2n, price: 67000_00000000n, label: "BTC/USD = $67,000" },
  ];

  console.log(`\n=== Submitting prices (${mode.mode}) ===\n`);

  let cofhe;
  if (mode.mode === "cofhe") {
    const chain =
      network.name === "arbitrumSepolia" ? chains.arbSepolia :
      network.name === "sepolia" ? chains.sepolia :
      network.name === "baseSepolia" ? chains.baseSepolia :
      null;

    if (!chain) {
      throw new Error(
        `Unsupported network for CoFHE encryption: ${network.name}. ` +
        `Use one of: sepolia, arbitrumSepolia, baseSepolia (or hardhat for local).`
      );
    }

    cofhe = createCofheClient(createCofheConfig({ supportedChains: [chain] }));
    const { publicClient, walletClient } = await Ethers6Adapter(ethers.provider, feeder);
    await cofhe.connect(publicClient, walletClient);
  }

  for (const { feedId, price, label } of prices) {
    console.log(`Submitting ${label}...`);
    let resolvedPayload;
    if (mode.mode === "local") {
      resolvedPayload = price;
    } else if (mode.mode === "cofhe") {
      const [enc] = await cofhe.encryptInputs([Encryptable.uint128(price)]).execute();
      // CoFHE contracts accept InEuint128 { ctHash, securityZone, utype, signature }
      resolvedPayload = {
        ctHash: enc.ctHash,
        securityZone: enc.securityZone,
        utype: enc.utype,
        signature: enc.signature,
      };
    } else {
      throw new Error(`Unsupported mode for submitPrice on network ${network.name}`);
    }

    const tx = await oracle.connect(feeder).submitPrice(feedId, resolvedPayload);
    const receipt = await tx.wait();
    console.log(`  Tx:       ${tx.hash}`);
    console.log(`  Gas used: ${receipt.gasUsed}\n`);
  }

  console.log(`Done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

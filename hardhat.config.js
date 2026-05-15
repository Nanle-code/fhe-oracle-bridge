require("@nomicfoundation/hardhat-toolbox");
require("@cofhe/hardhat-plugin");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");
require("dotenv").config();

/** Wave-4 / testnet path does not deploy ProductionOracle; skip to avoid OZ dependency. */
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) => {
  const paths = await runSuper();
  return paths.filter((p) => !p.replace(/\\/g, "/").includes("/production/"));
});

/** Ordered keys: [deployer, optional feeder2, optional feeder3] for quorum demos on CoFHE. */
function cofheAccounts() {
  const keys = [];
  if (process.env.PRIVATE_KEY) keys.push(process.env.PRIVATE_KEY);
  if (process.env.FEEDER2_PRIVATE_KEY) keys.push(process.env.FEEDER2_PRIVATE_KEY);
  if (process.env.FEEDER3_PRIVATE_KEY) keys.push(process.env.FEEDER3_PRIVATE_KEY);
  return keys;
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // Fhenix Helium testnet
    helium: {
      url: "https://api.helium.fhenix.zone",
      chainId: 8008135,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // Arbitrum Sepolia (CoFHE)
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: cofheAccounts(),
    },
    // Base Sepolia (CoFHE)
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts: cofheAccounts(),
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

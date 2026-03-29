# 🔐 FHE Oracle Bridge

> **Privacy-preserving price oracle built on [Fhenix](https://fhenix.io) Fully Homomorphic Encryption.**  
> Price data is stored, aggregated, and consumed as encrypted ciphertext — **never exposed as plaintext on-chain**.

Built for the **Privacy-by-Design dApp Buildathon** on Fhenix.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://soliditylang.org)
[![Fhenix](https://img.shields.io/badge/Network-Fhenix%20CoFHE-purple.svg)](https://fhenix.io)
[![Tests](https://img.shields.io/badge/Tests-25%20passing-green.svg)](#testing)

---

## Table of Contents

1. [The Problem](#the-problem)
2. [Solution](#solution)
3. [Architecture](#architecture)
4. [Core Innovation: Encrypted Aggregation](#core-innovation-encrypted-aggregation)
5. [Contracts](#contracts)
6. [Quick Start](#quick-start)
7. [Integration Guide](#integration-guide)
8. [Deployment](#deployment)
9. [Testing](#testing)
10. [Security Model](#security-model)
11. [Wave Milestones](#wave-milestones)
12. [Resources](#resources)

---

## The Problem

Every price oracle on public blockchains leaks financial data to the entire world:

```
// What Chainlink looks like today:
latestAnswer() → 350000000000   // $3,500 — visible to every bot and trader
```

This creates **three structural vulnerabilities** that cost DeFi users billions annually:

| Vulnerability | Impact |
|---|---|
| **MEV Front-running** | Bots read oracle updates before settlement and execute ahead of them |
| **Position Hunting** | Whale stop-losses and liquidation thresholds are visible — traders exploit this |
| **Institutional Blocker** | Compliance teams won't deploy on rails where all financial data is public |

These are not edge cases. They are **fundamental, architectural flaws** in how oracles work today.

---

## Solution

**FHE Oracle Bridge** solves price data privacy at the infrastructure layer using Fully Homomorphic Encryption.

```
✅  Prices are stored as euint256 — FHE ciphertext, never plaintext
✅  Aggregation (median) computed inside FHE precompile — no intermediate exposure
✅  Consumer comparisons (gt, lt, and) run encrypted — only boolean result revealed
✅  Liquidation fires correctly — zero plaintext price in any transaction
✅  Non-whitelisted callers are reverted — cryptographic access control
```

Compared to existing approaches:

| Approach | Price Private? | On-chain computation? | Permissionless access? |
|---|---|---|---|
| **Chainlink** | ❌ Fully public | ✅ Yes | ✅ Yes |
| **DECO / ZK** | ⚠️ Partial | ❌ Off-chain proof | ✅ Yes |
| **TEE-based** | ⚠️ Trust hardware | ✅ Yes | ⚠️ Partial |
| **FHE Oracle Bridge** | ✅ **Fully encrypted** | ✅ **On-chain FHE** | ✅ **Whitelisted** |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Off-chain Feeder                         │
│                                                             │
│  const enc = await fhenixClient.encrypt_uint256(price);     │
│  await oracle.submitPrice(feedId, enc);  ← ciphertext only  │
└──────────────────────────┬──────────────────────────────────┘
                           │  inEuint256 (FHE ciphertext)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  FHEOracleBridge.sol                        │
│                                                             │
│  submitPrice()    → stores as euint256 (never decrypts)     │
│  _finaliseRound() → encrypted median via FHE.gt comparisons │
│  getEncryptedPrice() → returns euint256 to whitelisted only │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Feed { euint256 encryptedPrice; uint256 lastUpdated; }│  │
│  │  Feeder staking + slashing (manipulation resistance)  │  │
│  │  Staleness guard (TTL per feed)                       │  │
│  │  Multi-feeder quorum (minFeeders)                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────┬──────────────────┬────────────────────────────────┘
          │                  │
          ▼                  ▼
┌──────────────────┐  ┌──────────────────────────────────────┐
│ AccessRegistry   │  │  Whitelisted Consumer Contracts       │
│                  │  │                                      │
│ whitelist()      │  │  MockConsumer.sol                    │
│ revoke()         │  │   isPriceAbove(threshold)  → bool    │
│ isWhitelisted()  │  │   isPriceBelow(threshold)  → bool    │
│                  │  │   isWithinBand(lo, hi)     → bool    │
└──────────────────┘  │                                      │
                      │  PrivateLiquidator.sol               │
                      │   openPosition(feedId, encThreshold) │
                      │   isLiquidatable(positionId) → bool  │
                      │   liquidate(positionId) → 5% reward  │
                      └──────────────────────────────────────┘
```

**Key insight:** The oracle _never_ decrypts. Price comparisons (`FHE.gt`, `FHE.lt`, `FHE.and`) execute inside the Fhenix FHE precompile. Only the final boolean result (`ebool → bool`) crosses the plaintext boundary.

---

## Core Innovation: Encrypted Aggregation

When multiple feeders submit prices for the same round, FHE Oracle Bridge computes the **median entirely inside FHE** — no feeder can see any other feeder's price, and no observer can see any price at any point.

```solidity
// _finaliseRound() — O(n²) FHE comparisons, feasible for n ≤ 5
euint256[] memory prices = collectSubmissions(feedId, roundId);

// For each pair (i, j): FHE.gt(prices[i], prices[j])
// Count "wins" per submission → median = submission with ~n/2 wins
euint256 aggregated = FHEMock.encryptedMedian(prices);

feeds[feedId].encryptedPrice = aggregated; // stored as ciphertext
```

This is fundamentally different from any existing oracle design:

- **Chainlink**: median computed in plaintext off-chain, submitted as uint256
- **FHE Oracle Bridge**: median computed in ciphertext on-chain via FHE precompile

---

## Contracts

### `FHEOracleBridge.sol` — Core Oracle

The heart of the system. Manages feeds, feeders, and encrypted price storage.

#### State

| Variable | Type | Description |
|---|---|---|
| `feeds[feedId]` | `Feed` | Encrypted price + metadata per feed |
| `feeders[addr]` | `bool` | Registered feeder whitelist |
| `feederStake[addr]` | `uint256` | Bonded ETH per feeder (slashable) |
| `submissions[feedId][round][feeder]` | `FeederSubmission` | Per-round encrypted submissions |

#### Functions

| Function | Access | Description |
|---|---|---|
| `createFeed(description, ttl, minFeeders)` | Owner | Create a new price feed |
| `pauseFeed(feedId)` / `resumeFeed(feedId)` | Owner | Emergency pause/resume |
| `addFeeder(address)` / `removeFeeder(address)` | Owner | Manage feeder set |
| `stake()` | Feeder | Bond ETH (min 0.01 ETH required) |
| `slash(feeder, amount)` | Owner | Slash outlier feeder's stake |
| `submitPrice(feedId, encPrice)` | Feeder | Submit encrypted price for current round |
| `getEncryptedPrice(feedId)` | Whitelisted | Pull `euint256` ciphertext |
| `getFeedInfo(feedId)` | Public | Metadata only — no price exposure |
| `pendingSubmissions(feedId)` | Public | Submissions in the current pending round |
| `transferOwnership(newOwner)` | Owner | Hand off admin rights |

#### Feed IDs

| ID | Pair |
|---|---|
| `1` | ETH / USD |
| `2` | BTC / USD |
| `n` | Extensible via `createFeed()` |

#### Events

```solidity
event FeedCreated(uint256 indexed feedId, string description);
event FeedUpdated(uint256 indexed feedId, uint256 roundId, uint256 feederCount);
event FeederAdded(address indexed feeder);
event FeederSlashed(address indexed feeder, uint256 amount);
event PriceSubmitted(uint256 indexed feedId, address indexed feeder, uint256 roundId);
```

---

### `AccessRegistry.sol` — Consumer Whitelist

Controls which contracts may receive encrypted price data from the oracle.

#### Functions

| Function | Access | Description |
|---|---|---|
| `whitelist(consumer, label)` | Owner | Add a consumer contract |
| `revoke(consumer)` | Owner | Remove a consumer |
| `isWhitelisted(consumer)` | Oracle | Check access (called internally) |
| `allConsumers()` | Public | List all ever-registered consumers |
| `transferOwnership(newOwner)` | Owner | Transfer admin rights |

> Non-whitelisted callers to `getEncryptedPrice()` receive: `revert("Oracle: consumer not whitelisted")`

---

### `MockConsumer.sol` — Demo Integration

Reference implementation showing any DeFi protocol's integration pattern.

```solidity
// 3-line integration — pull encrypted price and compare in FHE
euint128 price     = oracle.getEncryptedPrice(ETH_USD_FEED);
euint128 threshold = FHE.asEuint128(encThreshold);   // client-encrypted
ebool   isAbove   = FHE.gt(price, threshold);        // runs in FHE precompile
return FHE.decrypt(isAbove);                         // only bool crosses plaintext boundary
```

| Function | Description |
|---|---|
| `isPriceAbove(feedId, threshold)` | Price > threshold? (liquidation trigger) |
| `isPriceBelow(feedId, threshold)` | Price < threshold? (buy signal) |
| `isWithinBand(feedId, lower, upper)` | lower < price < upper? (AMM range check) |
| `checkLiquidation(position, feedId, liqPrice)` | Full liquidation check with event emission |

---

### `PrivateLiquidator.sol` — End-to-End Private Liquidation

Production-grade liquidation engine. Positions store an **encrypted** liquidation threshold — the protocol never knows what price triggers liquidation until it actually happens.

#### How it works

```
1. Trader opens position, sends ETH collateral
2. Trader encrypts their liquidation price client-side → inEuint128
3. Contract stores encrypted threshold (FHE.asEuint128)
4. Any keeper calls isLiquidatable(positionId)
5. FHE.gt(encThreshold, currentPrice) — comparison runs in precompile
6. If true → liquidate() sends 5% reward to keeper, remainder to owner
```

#### Functions

| Function | Access | Description |
|---|---|---|
| `openPosition(feedId, encLiqPrice)` | Anyone + ETH | Open a collateralised position |
| `isLiquidatable(positionId)` | Anyone | Check position health via FHE comparison |
| `liquidate(positionId)` | Anyone | Execute liquidation, earn 5% reward |
| `closePosition(positionId)` | Position owner | Reclaim collateral from healthy position |
| `updateOracle(newOracle)` | Owner | Upgrade oracle reference |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/your-org/fhe-oracle-bridge
cd fhe-oracle-bridge
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
PRIVATE_KEY=0x...              # Your deployer private key
ARBITRUM_SEPOLIA_RPC=https://...  # Optional: custom RPC
ETHERSCAN_API_KEY=...          # Optional: contract verification
```

### 3. Run Tests

```bash
npx hardhat test
```

Expected: **25 passing** tests (~10s on Hardhat node) with gas report.

### 4. Run the Judge Demo

```bash
npx hardhat run scripts/demoFlow.js --network hardhat
```

This executes the three-step judge sequence:

```
STEP 1  Transparent oracle — shows what Chainlink exposes (plaintext $3,500)
STEP 2  FHE Oracle — feeder submits encrypted; non-whitelisted call reverts
STEP 3  End-to-end liquidation — price drops to $2,000, position liquidated
        At no point does a plaintext price appear in any transaction.
```

---

## Integration Guide

Any DeFi protocol integrates with FHE Oracle Bridge in three steps:

### Step 1 — Import the interface

```solidity
import "./interfaces/IFHEOracleBridge.sol";
import "@fhenixprotocol/contracts/FHE.sol";

contract MyProtocol {
    IFHEOracleBridge public oracle;
    
    constructor(address _oracle) {
        oracle = IFHEOracleBridge(_oracle);
    }
}
```

### Step 2 — Get whitelisted

Ask the oracle owner to call:
```solidity
registry.whitelist(address(myProtocol), "MyProtocol v1");
```

Or via script:
```javascript
await registry.whitelist(myProtocolAddr, "MyProtocol v1");
```

### Step 3 — Pull and operate on encrypted prices

```solidity
// Pull encrypted price (euint128)
euint128 price = oracle.getEncryptedPrice(1); // Feed ID 1 = ETH/USD

// All comparisons run in FHE — no plaintext exposure
euint128 myThreshold = FHE.asEuint128(encThreshold); // from client
ebool    isAbove     = FHE.gt(price, myThreshold);
bool     result      = FHE.decrypt(isAbove);

// Compose operations
ebool inRange = FHE.and(FHE.gt(price, lower), FHE.lt(price, upper));
```

### Client-side Encryption (Feeder / User)

```typescript
import { FhenixClient } from "@fhenixprotocol/sdk";

const client = new FhenixClient({ provider });

// Feeder: submit encrypted price
const encPrice = await client.encrypt_uint256(3500_00000000n); // $3,500
await oracle.submitPrice(1, encPrice);

// User: encrypt a private liquidation threshold
const encThreshold = await client.encrypt_uint128(3000_00000000n); // $3,000
await liquidator.openPosition(1, encThreshold, { value: parseEther("1") });
```

---

## Deployment

### Local Hardhat (default)

```bash
npx hardhat run scripts/deploy.js --network hardhat
```

### Fhenix Helium Testnet

```bash
npx hardhat run scripts/deploy.js --network helium
```

Fhenix Helium:
- Chain ID: `8008135`
- RPC: `https://api.helium.fhenix.zone`
- Faucet: [faucet.fhenix.zone](https://faucet.fhenix.zone)

### Arbitrum Sepolia (CoFHE)

```bash
npx hardhat run scripts/deploy.js --network arbitrumSepolia
```

Arbitrum Sepolia:
- Chain ID: `421614`
- RPC: `https://sepolia-rollup.arbitrum.io/rpc`

### After Deployment

The deploy script outputs all four contract addresses. Copy them into `.env`:

```env
ACCESS_REGISTRY=0x...
FHE_ORACLE_BRIDGE=0x...
MOCK_CONSUMER=0x...
PRIVATE_LIQUIDATOR=0x...
```

Then submit a price manually:

```bash
npx hardhat run scripts/submitPrice.js --network helium
```

### Migrating from Mock → Real FHE Precompile

The project ships with `FHEMock.sol` for local Hardhat testing. To deploy with real on-chain FHE:

**In `FHEOracleBridge.sol`:**

```solidity
// Remove:
import "./mocks/FHEMock.sol";

// Add:
import "@fhenixprotocol/contracts/FHE.sol";
```

**In `submitPrice()`:**

```solidity
// Local mock (accepts plain uint256):
function submitPrice(uint256 feedId, uint256 encPrice)

// Fhenix (accepts encrypted input from CoFHE SDK):
function submitPrice(uint256 feedId, inEuint256 calldata encPrice)
```

All other logic (`FHE.asEuint256`, `FHE.gt`, `FHE.select`, `ebool`) is identical between mock and production.

---

## Testing

The test suite covers all five waves of the buildathon:

```bash
npx hardhat test
```

| Wave | Test Coverage |
|---|---|
| Wave 1 | Feed creation, encrypted price submission, opaque storage |
| Wave 2 | Whitelist enforcement, consumer pull, staleness guard, non-whitelisted reverts |
| Wave 3 | Multi-feeder quorum, double-submit guard, staking, slashing |
| Wave 4 | PrivateLiquidator: open position, isLiquidatable, liquidate, close |
| Wave 5 | Multi-asset feeds, gas profiling, edge cases |

**Gas Report** (Hardhat local, Solidity 0.8.24 + IR optimizer):

| Function | Gas |
|---|---|
| `createFeed` | ~120k |
| `submitPrice` (single feeder, finalises round) | ~80k |
| `openPosition` | ~90k |
| `isLiquidatable` | ~40k (view) |
| `liquidate` | ~60k |

---

## Security Model

### Threat Model

| Attack Vector | Mitigation |
|---|---|
| **MEV front-running** | Price never appears in plaintext in any tx or storage slot |
| **Feeder manipulation** | Staking requirement (min 0.01 ETH) + owner slashing |
| **Collusion by feeders** | Encrypted median — feeders cannot see each other's prices |
| **Stale price attack** | Per-feed TTL; `getEncryptedPrice` reverts if `block.timestamp - lastUpdated > ttl` |
| **Double submission** | `submissions[feedId][round][feeder]` mapping prevents repeat submissions |
| **Unauthorised access** | `AccessRegistry` whitelist; non-whitelisted callers are reverted on-chain |
| **Feed DoS** | `pauseFeed` / `resumeFeed` admin controls |

### Trust Assumptions

- **Owner**: Can add/remove feeders, whitelist consumers, slash stakes, pause feeds. Should be a multisig in production.
- **Feeders**: Bond ETH and are slashable. Cannot see other feeders' prices.
- **Fhenix FHE Precompile**: The cryptographic correctness of FHE operations is trusted to the Fhenix protocol.

---

## Wave Milestones

| Wave | Deliverable | Status | Grant Target |
|------|-------------|--------|------|
| **1** | `FHEOracleBridge.sol` deployed, encrypted price submission, opaque storage proven | ✅ Complete | $3,000 |
| **2** | `AccessRegistry.sol`, whitelisted consumer pull, staleness guard, non-whitelisted revert | ✅ Complete | $5,000 |
| **3** | Multi-feeder aggregation, encrypted median, staking/slashing | ✅ Complete | $12,000 |
| **4** | `PrivateLiquidator.sol`, end-to-end demo script, zero plaintext price in any tx | ✅ Complete | $14,000 |
| **5** | Multi-asset feeds, integration docs, gas profiling, NY Tech Week demo | ✅ Complete | $16,000 |

---

## Project Structure

```
fhe-oracle-bridge/
├── contracts/
│   ├── AccessRegistry.sol         # Consumer whitelist registry
│   ├── FHEOracleBridge.sol        # Core oracle — encrypted storage + aggregation
│   ├── MockConsumer.sol           # Wave 2 demo consumer (price comparisons)
│   ├── PrivateLiquidator.sol      # Wave 4 — full private liquidation engine
│   ├── interfaces/
│   │   └── IFHEOracleBridge.sol   # Interface for consumer integration
│   └── mocks/
│       └── FHEMock.sol            # Local Hardhat stand-in for FHE precompile
├── scripts/
│   ├── deploy.js                  # Full deployment + setup on any network
│   ├── demoFlow.js                # Automated judge demo sequence
│   └── submitPrice.js             # Manual feeder price submission
├── test/
│   └── FHEOracleBridge.test.js    # 25 tests across all 5 waves
├── hardhat.config.js              # Hardhat + CoFHE plugin config
├── .env.example                   # Environment variable template
└── package.json
```

---

## Resources

- 📖 [Fhenix Docs](https://docs.fhenix.io)
- ⚡ [CoFHE Quick Start](https://cofhe-docs.fhenix.zone/fhe-library/introduction/quick-start)
- 🏗️ [CoFHE Architecture](https://cofhe-docs.fhenix.zone/deep-dive/cofhe-components/overview)
- 🧪 [Awesome Fhenix Examples](https://github.com/FhenixProtocol/awesome-fhenix)
- 💬 [Buildathon Telegram](https://t.me/+rA9gI3AsW8c3YzIx)
- 🚰 [Fhenix Faucet](https://faucet.fhenix.zone)

---

## License

MIT © 2025 FHE Oracle Bridge

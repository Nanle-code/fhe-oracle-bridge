# FHE Oracle Bridge

> **Privacy-preserving price oracle on [Fhenix](https://fhenix.io) CoFHE.**  
> Prices are stored, aggregated, and consumed as **encrypted ciphertext** — never as plaintext on-chain.

Built for the **Privacy-by-Design dApp Buildathon** on Fhenix.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://soliditylang.org)
[![Fhenix](https://img.shields.io/badge/Network-Fhenix%20CoFHE-purple.svg)](https://fhenix.io)
[![Tests](https://img.shields.io/badge/Tests-36%20passing-green.svg)](#testing)

| | |
|---|---|
| **Live dashboard** | https://fhe-oracle-bridge-demo.surge.sh/ |
| **Repository** | https://github.com/Nanle-code/fhe-oracle-bridge |
| **Network** | Arbitrum Sepolia (`421614`) |

---

## Table of contents

1. [Overview](#overview)
2. [The problem](#the-problem)
3. [Solution & privacy boundary](#solution--privacy-boundary)
4. [Architecture](#architecture)
5. [Core innovation: encrypted median](#core-innovation-encrypted-median)
6. [Live deployment](#live-deployment-arbitrum-sepolia)
7. [Buildathon judging criteria](#buildathon-judging-criteria)
8. [Contracts](#contracts)
9. [CoFHE liquidation flow](#cofhe-liquidation-flow)
10. [Quick start](#quick-start)
11. [Live testnet demo](#live-testnet-demo)
12. [Integration guide](#integration-guide)
13. [Keeper & feeder operations](#keeper--feeder-operations)
14. [Deployment](#deployment)
15. [npm scripts](#npm-scripts)
16. [Testing](#testing)
17. [Security model](#security-model)
18. [Wave milestones](#wave-milestones)
19. [Project structure](#project-structure)
20. [Troubleshooting](#troubleshooting)
21. [Resources](#resources)

---

## Overview

**FHE Oracle Bridge** is infrastructure for a **privacy-preserving price oracle**: market prices are encrypted off-chain, written on-chain as FHE handles, optionally aggregated (**encrypted median** across feeders), and consumed by **whitelisted** DeFi contracts that act on prices **without a public plaintext tick**.

| Capability | Description |
|------------|-------------|
| **Private ingest** | Feeders encrypt locally; only ciphertext lands on-chain |
| **Private aggregation** | Multi-feeder **encrypted median** via FHE comparisons |
| **Encrypted predicates** | Consumers ask “is spot above my threshold?” with thresholds as ciphertext |
| **Boolean-only reveal** | CoFHE liquidation/alerts reveal **one bool**, not USD |
| **Access control** | `AccessRegistry` whitelist + per-feed TTL staleness |

**Non-goals (v1):** general arbitrary-data oracle; large decentralized feeder set; tokenized fee marketplace.

**Repository includes:** Solidity contracts (local mock + CoFHE + Fhenix variants), feeder/keeper automation, static dashboard (`frontend/`), **36 Hardhat tests**, demo scripts.

---

## The problem

```solidity
// Traditional oracle (Chainlink-style):
latestAnswer() → 350000000000   // $3,500 — visible to every bot
```

| Vulnerability | Impact |
|---------------|--------|
| **MEV front-running** | Bots read oracle updates before settlement |
| **Position hunting** | Visible liquidation thresholds get exploited |
| **Institutional blocker** | Compliance blocks fully public financial rails |

---

## Solution & privacy boundary

```
✅  Prices stored as euint128/euint256 — FHE ciphertext on-chain
✅  Median computed inside FHE precompile
✅  Comparisons (gt, lt, and) run encrypted
✅  Liquidations/alerts: only boolean crosses plaintext (CoFHE)
✅  Non-whitelisted callers revert on getEncryptedPrice
```

| Approach | Price private? | On-chain FHE? | Access |
|----------|----------------|---------------|--------|
| Chainlink | No | N/A | Public |
| DECO / ZK | Partial | Off-chain proof | Public |
| TEE-based | Trust hardware | Yes | Partial |
| **FHE Oracle Bridge** | **Yes** | **Yes** | **Whitelisted** |

**Privacy boundary (one sentence for judges):**  
Spot and user thresholds stay **FHE ciphertext on-chain**; the keeper and chain learn only **`isLiquidatable`** (or alert bool) after CoFHE threshold decryption — **not** a public USD oracle tick.

**Trust notes:** Feeders see spot before encrypting off-chain; on-chain observers cannot read another feeder’s submission as plaintext. Keeper learns the **predicate boolean only**, not threshold or spot USD.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Off-chain feeder (CoFHE SDK encrypt)                       │
│  submitPrice(feedId, inEuint128) → ciphertext only         │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  FHEOracleBridge* — feeds, quorum, encrypted median          │
│  getEncryptedPrice() → whitelisted consumers only            │
└─────────┬───────────────────────────────┬───────────────────┘
          ▼                               ▼
┌──────────────────┐    ┌─────────────────────────────────────┐
│ AccessRegistry   │    │ MockConsumer*, PrivateLiquidator*,  │
│ whitelist/revoke │    │ PrivateThresholdAlerts* (CoFHE)     │
└──────────────────┘    └─────────────────────────────────────┘
                                      │
                          Keeper: decrypt bool → completeLiquidation
```

**Contract variants:**

| Network | Oracle | Liquidator |
|---------|--------|------------|
| Hardhat local | `FHEOracleBridge` | `PrivateLiquidator` |
| Arbitrum/Base Sepolia (CoFHE) | `FHEOracleBridgeCofhe` | `PrivateLiquidatorCofhe` |
| Fhenix Helium | `FHEOracleBridgeFhenix` | `PrivateLiquidatorFhenix` |

---

## Core innovation: encrypted median

When multiple feeders submit for a round, the oracle finalizes an **encrypted median** in `MedianLibCofhe` — no feeder sees another’s price on-chain; no observer sees plaintext at any step.

```solidity
// MedianLibCofhe — pairwise FHE.gt + FHE.select sort, return middle
euint128 aggregated = MedianLibCofhe.encryptedMedian(prices);
feeds[feedId].encryptedPrice = aggregated;
```

- **Chainlink:** median off-chain in plaintext → `uint256` on-chain  
- **FHE Oracle Bridge:** median on-chain in ciphertext via FHE precompile  

With `minFeeders >= 2`, first submit emits `QuorumPending` until quorum, then `FeedUpdated`.

---

## Live deployment (Arbitrum Sepolia)

Canonical addresses in [`frontend/config.json`](./frontend/config.json):

| Contract | Address |
|----------|---------|
| AccessRegistry | `0x3b01F41557C08587c83c1EcA40ef93bb6829D223` |
| FHEOracleBridge (CoFHE) | `0x4c1A39704D65992464C4BE356c1A0BA001526dC3` |
| MockConsumer | `0x2B826A58AB77E474c2A3a6C9B8cc521F33AA3d8c` |
| PrivateLiquidator | `0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff` |
| PrivateThresholdAlerts | `0x80886CCF7253337E1ABe911CD36f1F7BAAdB1932` |

| Feed ID | Pair |
|---------|------|
| `1` | ETH / USD |
| `2` | BTC / USD |

After redeploy: update `frontend/config.json`, `.env`, and republish dashboard (`npm run deploy:frontend:surge`).

---

## Buildathon judging criteria

| Criterion | Evidence in this repo |
|-----------|-------------------------|
| **Privacy architecture** | `euint128` storage, `AccessRegistry`, encrypted median, bool-only CoFHE liquidation |
| **Innovation & originality** | On-chain FHE median; predicate oracle rail vs public index feeds |
| **User experience** | [Live dashboard](https://fhe-oracle-bridge-demo.surge.sh/), `demoFlow.js`, wallet + feed freshness UI |
| **Technical execution** | 36 tests, deployed CoFHE contracts, spin/keepers/smoke CI |
| **Market potential** | MEV / whale hunting / institutional privacy; lending & perps as integrators |

**5-minute judge path:**

1. Open live dashboard → connect wallet → refresh feeds (metadata only, no plaintext price).
2. Arbiscan → oracle contract → no public `latestAnswer`-style field.
3. Local: `npx hardhat run scripts/demoFlow.js --network hardhat`
4. Live: `npm run wave4:live` → `PositionOpened` → `LiquidationCheckPrepared` → `PositionLiquidated`

**Pitch:** *FHE Oracle Bridge lets DeFi act on markets without broadcasting every tick to MEV bots — encrypted ingest, encrypted median, boolean-only liquidations on CoFHE.*

---

## Contracts

### `FHEOracleBridge*` — core oracle

| Function | Access | Description |
|----------|--------|-------------|
| `createFeed(description, ttl, minFeeders)` | Owner | New feed |
| `submitPrice(feedId, encPrice)` | Feeder | Encrypted submission |
| `getEncryptedPrice(feedId)` | Whitelisted | Returns ciphertext |
| `getFeedInfo(feedId)` | Public | Metadata only |
| `addFeeder` / `slash` / `pauseFeed` | Owner | Ops |

### `AccessRegistry.sol`

| Function | Description |
|----------|-------------|
| `whitelist(consumer, label)` | Allow consumer |
| `revoke(consumer)` | Remove access |

Non-whitelisted `getEncryptedPrice` → `revert("Oracle: consumer not whitelisted")`.

### `MockConsumer*` — reference integration

`isPriceAbove`, `isPriceBelow`, `isWithinBand` — encrypted comparisons; local mock uses sync `FHE.decrypt`; CoFHE uses async patterns.

### `PrivateLiquidator*` — private liquidation

Positions store **encrypted** liquidation thresholds. On CoFHE: `requestLiquidationCheck` → keeper `completeLiquidation` (see below).

---

## CoFHE liquidation flow

On **Arbitrum Sepolia / Base Sepolia** (`PrivateLiquidatorCofhe`):

```
1. openPosition(feedId, inEuint128 encLiqPrice) + collateral
2. requestLiquidationCheck(positionId)
   → emits LiquidationCheckPrepared(positionId, ctHash, ...)
3. Keeper: cofhe.decryptForTx(ctHash) → learns ONLY isLiquidatable
4. completeLiquidation(positionId, bool, proof) → payout if true
```

Comparison: `FHE.gt(encLiquidationPrice, encryptedSpot)` — both stay ciphertext until step 3–4 reveal **bool only**.

---

## Quick start

```bash
git clone https://github.com/Nanle-code/fhe-oracle-bridge
cd fhe-oracle-bridge
npm install
cp .env.example .env   # add PRIVATE_KEY, contract addresses after deploy
```

```bash
npx hardhat test                                    # 36 passing
npx hardhat run scripts/demoFlow.js --network hardhat   # judge narrative (local)
npm run frontend                                    # local dashboard
```

---

## Live testnet demo

### Prerequisites

`.env` must include `PRIVATE_KEY`, `FHE_ORACLE_BRIDGE`, `PRIVATE_LIQUIDATOR` (match `frontend/config.json`). Wallet needs Arbitrum Sepolia ETH (~0.02+).

### Health check

```bash
npm run demo:preflight
npm run testnet:health
npm run testnet:smoke
```

If CoFHE is flaky:

```bash
npm run cofhe:wait
npm run wave4:live:wait    # wait for CoFHE, then full E2E
```

### Full Wave 4 E2E (liquidation)

```bash
npm run wave4:live
# optional: CRASH_BPS=1500 LIQ_PREMIUM_BPS=500 COLLATERAL_ETH=0.005
```

Success: `success: true` and `completeTx` hash. Arbiscan: `PositionOpened` → `LiquidationCheckPrepared` → `PositionLiquidated`.

### Split steps

```bash
npm run submit:live:arbitrum-sepolia
npm run wave4:open
POSITION_ID=1 npm run wave4:finish
```

### Always-on stack (demo day)

```bash
npm run spin          # feeder + liquidation keeper + threshold keeper + frontend
npm run spin:logs
npm run spin:stop
```

Optional: `npm run wave3:quorum` (needs `FEEDER2_PRIVATE_KEY`), `npm run wave5:live` (alerts).

### Dashboard (for judges)

**Live URL:** https://fhe-oracle-bridge-demo.surge.sh/

1. Open the link (no install required).
2. **Connect wallet** on Arbitrum Sepolia (MetaMask or similar).
3. Click **refresh** — feeds show round/age only (no plaintext price by design).
4. Use sidebar: **Price feeds**, **Event log**, **Consumers**.
5. Compare **privacy proof** panel (Chainlink vs FHE).

Republish after frontend changes: `npm run deploy:frontend:surge`

- **Local:** `npm run frontend` → http://127.0.0.1:8765/
- **GitHub Pages (backup):** push to `master` with Pages enabled, or run workflow [deploy-frontend-pages.yml](./.github/workflows/deploy-frontend-pages.yml)

### Recorded demo transactions

| Step | Tx hash | Notes |
|------|---------|-------|
| Wave 4 E2E | _(paste after `npm run wave4:live`)_ | `completeTx` |

---

## Integration guide

### Step 1 — Import

```solidity
import "./interfaces/IFHEOracleBridgeCofhe.sol";
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
```

### Step 2 — Whitelist

```solidity
registry.whitelist(address(myProtocol), "MyProtocol v1");
```

### Step 3 — CoFHE (production testnet)

Use **async** liquidation pattern (not sync `FHE.decrypt` in one tx):

```solidity
liquidator.openPosition(feedId, encLiqPrice, { value: collateral });
liquidator.requestLiquidationCheck(positionId);
// Off-chain keeper: decryptForTx(ctHash) → completeLiquidation(...)
```

### Step 3 — Hardhat local (mock)

```solidity
euint128 price = oracle.getEncryptedPrice(1);
euint128 threshold = FHE.asEuint128(encThreshold);
ebool isAbove = FHE.gt(price, threshold);
bool result = FHE.decrypt(isAbove);  // mock only
```

### Client encryption (CoFHE)

```typescript
import { createCofheClient } from "@cofhe/sdk/node";
// encrypt_uint128 → submitPrice / openPosition with inEuint128 payload
```

Prices use **8 decimals** (Chainlink-style): `$3,500.00` → `350000000000n`.

### ABI note

```solidity
// Local mock:
function submitPrice(uint256 feedId, uint256 encPrice);
// CoFHE:
function submitPrice(uint256 feedId, inEuint128 calldata encPrice);
```

---

## Keeper & feeder operations

### Liquidation keeper

Watches `LiquidationCheckPrepared`, runs `decryptForTx(ctHash).withoutPermit()`, calls `completeLiquidation`.

```bash
npm run keeper:arbitrum-sepolia
# env: PRIVATE_LIQUIDATOR, KEEPER_POLL_MS=8000, KEEPER_FROM_BLOCK
```

### Threshold alert keeper

Same pattern for `PrivateThresholdAlertsCofhe` → `ThresholdCheckPrepared`.

```bash
npm run keeper:threshold:arbitrum-sepolia
# env: PRIVATE_THRESHOLD_ALERTS
```

### Feeder daemon

Fetches CoinGecko + Binance spot, encrypts, `submitPrice` on interval.

```bash
npm run feeder:arbitrum-sepolia
# optional: FEEDER2_PRIVATE_KEY for quorum (run npm run setup:feeder2 first)
```

### Multi-feeder quorum

```bash
npm run setup:feeder2
npm run feeds:quorum      # create feeds with minFeeders >= 2
npm run wave3:quorum
```

---

## Deployment

```bash
npx hardhat run scripts/deploy.js --network hardhat
npx hardhat run scripts/deploy.js --network arbitrumSepolia
npx hardhat run scripts/deploy.js --network baseSepolia
npx hardhat run scripts/deploy.js --network helium   # Fhenix native
```

| Network | Chain ID | RPC |
|---------|----------|-----|
| Arbitrum Sepolia | `421614` | `https://sepolia-rollup.arbitrum.io/rpc` |
| Base Sepolia | `84532` | `https://sepolia.base.org` |
| Fhenix Helium | `8008135` | `https://api.helium.fhenix.zone` |

Copy deploy output into `.env`:

```env
ACCESS_REGISTRY=0x...
FHE_ORACLE_BRIDGE=0x...
MOCK_CONSUMER=0x...
PRIVATE_LIQUIDATOR=0x...
PRIVATE_THRESHOLD_ALERTS=0x...
```

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Hardhat test suite (36 tests) |
| `npm run demo:preflight` | Pre-demo health (RPC, feeds, CoFHE) |
| `npm run wave4:live` | Full live liquidation E2E |
| `npm run wave4:live:wait` | Wait for CoFHE, then wave4 |
| `npm run wave3:quorum` | Two-feeder live median |
| `npm run wave5:live` | Threshold alert E2E |
| `npm run spin` | Feeder + keepers + frontend |
| `npm run testnet:smoke` | CI-style live validation |
| `npm run deploy:arbitrum-sepolia` | Deploy full stack |
| `npm run feeder:arbitrum-sepolia` | Price feeder daemon |
| `npm run keeper:arbitrum-sepolia` | Liquidation keeper |
| `npm run frontend` | Local dashboard |
| `npm run deploy:frontend:surge` | Publish Surge demo |

See `package.json` for the full list.

---

## Testing

```bash
npx hardhat test
```

| Wave | Coverage |
|------|----------|
| 1 | Encrypted submit, feeds, opaque storage |
| 2 | Whitelist, staleness, consumer pull |
| 3 | Multi-feeder quorum, median, staking |
| 4 | Liquidator open / liquidate / close |
| 5 | Multi-asset, gas profiling |

**Gas (local, indicative):** `submitPrice` ~80–190k · `liquidate` ~60–68k

---

## Security model

| Threat | Mitigation |
|--------|------------|
| MEV on oracle tick | No plaintext price in storage or public field |
| Feeder manipulation | Stake (min 0.01 ETH) + owner slash |
| Feeder collusion | Encrypted median; submissions opaque on-chain |
| Stale prices | Per-feed TTL revert |
| Unauthorized read | `AccessRegistry` whitelist |
| Feed DoS | `pauseFeed` / `resumeFeed` |

**Trust:** owner (use multisig in production); bonded feeders; Fhenix/CoFHE cryptographic correctness.

**Production hardening (future):** multisig owner, pending-check timeouts, verified contracts, supervised keepers with alerting — not all deployed in testnet v1.

---

## Wave milestones

| Wave | Focus | Code & tests | Live testnet |
|------|--------|--------------|--------------|
| **1** | Encrypted ingest, feeds | ✅ | ✅ Feeder |
| **2** | Access registry, consumers, UI | ✅ | ✅ Dashboard |
| **3** | Multi-feeder encrypted median | ✅ | 🔄 `wave3:quorum` |
| **4** | Private liquidation + keeper | ✅ | 🔄 `wave4:live` (record txs) |
| **5** | Threshold alerts | ✅ | 🔄 `wave5:live` optional |

---

## Project structure

```
fhe-oracle-bridge/
├── contracts/
│   ├── FHEOracleBridge.sol / FHEOracleBridgeCofhe.sol / FHEOracleBridgeFhenix.sol
│   ├── AccessRegistry.sol
│   ├── MockConsumer*.sol
│   ├── PrivateLiquidator*.sol
│   ├── PrivateThresholdAlertsCofhe.sol
│   └── libraries/MedianLib*.sol
├── scripts/
│   ├── deploy.js, demoFlow.js, feederDaemon.js
│   ├── liquidationKeeper.js, thresholdAlertKeeper.js
│   ├── wave3LiveQuorum.js, wave4LiveE2E.js, wave5LiveE2E.js
│   ├── spin.sh, testnetSmoke.js, lib/
│   └── monitoring/
├── frontend/
│   ├── index.html
│   └── config.json
├── test/FHEOracleBridge.test.js
├── hardhat.config.js
└── package.json
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ZK_VERIFY_FAILED` / CoFHE timeout | `npm run cofhe:wait` then retry |
| `Set POSITION_ID` | `POSITION_ID=N npm run wave4:finish` |
| `consumer not whitelisted` | Re-run deploy whitelisting or `registry.whitelist` |
| Stale feeds | `npm run spin` or `npm run submit:live:arbitrum-sepolia` |
| Low ETH | [Arbitrum Sepolia faucet](https://www.alchemy.com/faucets/arbitrum-sepolia) |
| Wrong dashboard contracts | Sync `frontend/config.json` with `.env` |

---

## Resources

- [Fhenix Docs](https://docs.fhenix.io)
- [CoFHE Quick Start](https://cofhe-docs.fhenix.zone/fhe-library/introduction/quick-start)
- [CoFHE Architecture](https://cofhe-docs.fhenix.zone/deep-dive/cofhe-components/overview)
- [Awesome Fhenix](https://github.com/FhenixProtocol/awesome-fhenix)
- [Buildathon Telegram](https://t.me/+rA9gI3AsW8c3YzIx)
- [Fhenix Faucet](https://faucet.fhenix.zone)

---

## License

MIT © 2025 FHE Oracle Bridge

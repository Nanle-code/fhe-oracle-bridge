# FHE Oracle Bridge

> **Privacy-preserving price oracle on [Fhenix](https://fhenix.io) CoFHE.**  
> Prices are stored, aggregated, and consumed as **encrypted ciphertext** — never as plaintext on-chain.

Built for the **Privacy-by-Design dApp Buildathon** on Fhenix.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://soliditylang.org)
[![Fhenix](https://img.shields.io/badge/Network-Fhenix%20CoFHE-purple.svg)](https://fhenix.io)
[![Tests](https://img.shields.io/badge/Tests-36%20passing-green.svg)](#testing)
[![Wave 4](https://img.shields.io/badge/Wave%204-Private%20liquidation-9d98fa.svg)](#wave-4--private-liquidation)

| | |
|---|---|
| **Live dashboard (judges)** | https://fhe-oracle-bridge-demo.surge.sh/ |
| **Wave 4 liquidator (CoFHE)** | [`0x5d9D…f3ff`](#live-deployment-arbitrum-sepolia) · [Arbiscan](https://sepolia.arbiscan.io/address/0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff) |
| **Repository** | https://github.com/Nanle-code/fhe-oracle-bridge |
| **Network** | Arbitrum Sepolia (`421614`) |

---

## Table of contents

1. [Overview](#overview)
2. [Wave 4 — Private liquidation](#wave-4--private-liquidation) ← **current milestone**
3. [The problem](#the-problem)
4. [Solution & privacy boundary](#solution--privacy-boundary)
5. [Architecture](#architecture)
6. [Core innovation: encrypted median](#core-innovation-encrypted-median)
7. [Live deployment](#live-deployment-arbitrum-sepolia)
8. [Buildathon judging criteria](#buildathon-judging-criteria)
9. [Contracts](#contracts)
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

## Wave 4 — Private liquidation

> **What Wave 4 proves:** *Full liquidation cycle — encrypted check, boolean result, keeper action — price drives everything, nobody sees it.*

> **In one line:** *Encrypted threshold, boolean result, keeper action — the triggering price was never seen by anyone.*

Wave 4 is the **private liquidation** milestone: the protocol asks **“is this position liquidatable?”** inside FHE — not **“what is the spot price?”** — and only a **single boolean** may cross the CoFHE threshold boundary before collateral moves.

### Wave 4 deliverables

| # | Deliverable | Status | Where |
|---|-------------|--------|--------|
| 1 | **Private liquidation contracts** | ✅ | [`PrivateLiquidator.sol`](./contracts/PrivateLiquidator.sol) (local) · [`PrivateLiquidatorCofhe.sol`](./contracts/PrivateLiquidatorCofhe.sol) (live) |
| 2 | **Keeper** — watch event, decrypt bool, complete liquidation | ✅ | [`scripts/liquidationKeeper.js`](./scripts/liquidationKeeper.js) |
| 3 | **Demo** — full cycle, no plaintext price in any step | ✅ local · 🔄 testnet txs | [`scripts/demoFlow.js`](./scripts/demoFlow.js) · [`scripts/wave4LiveE2E.js`](./scripts/wave4LiveE2E.js) |
| 4 | **Hosted dashboard for judges** | ✅ | https://fhe-oracle-bridge-demo.surge.sh/ |
| 5 | **Reproducible testnet runbook** | ✅ | [Live testnet demo](#live-testnet-demo) below |

### Wave 4 flow (CoFHE — Arbitrum Sepolia)

```
openPosition(encThreshold)     →  threshold stored as euint128
requestLiquidationCheck(id)    →  FHE.gt(threshold, encryptedSpot) → LiquidationCheckPrepared(ctHash)
keeper: decryptForTx(ctHash)   →  learns ONLY isLiquidatable (not USD)
completeLiquidation(id, bool)  →  if true: PositionLiquidated + collateral to keeper
```

**Contracts (live):** `PrivateLiquidator` → `0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff` ([Arbiscan](https://sepolia.arbiscan.io/address/0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff))

### Review Wave 4 in 5 minutes (judges)

| Step | Action |
|------|--------|
| 1 | Open **https://fhe-oracle-bridge-demo.surge.sh/** — on-page **“For judges”** walkthrough |
| 2 | Connect wallet on **Arbitrum Sepolia** → click **refresh** (feeds show round/age, not plaintext USD) |
| 3 | Read **privacy proof** (Chainlink leak vs FHE handles) · sidebar **Event log** |
| 4 | Arbiscan: [liquidator](https://sepolia.arbiscan.io/address/0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff) · [oracle](https://sepolia.arbiscan.io/address/0x4c1A39704D65992464C4BE356c1A0BA001526dC3) — no public price field |
| 5 | Optional local proof: `npx hardhat run scripts/demoFlow.js --network hardhat` |

### Run Wave 4 yourself (operators)

```bash
npm run demo:preflight          # RPC + CoFHE + feed health
npm run wave4:live              # full E2E: spot → open → crash → liquidate
# or: npm run wave4:live:wait   # wait for CoFHE, then E2E
```

Split steps: [`wave4:open`](#npm-scripts) → `POSITION_ID=N npm run wave4:finish` · Always-on: `npm run spin` (feeder + **liquidation keeper** + frontend).

**Recorded Wave 4 txs** (paste after a successful live run):

| Event | Tx hash |
|-------|---------|
| `PositionOpened` | _(optional)_ |
| `LiquidationCheckPrepared` | _(optional)_ |
| `PositionLiquidated` / `completeTx` | _(paste from `npm run wave4:live`)_ |

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

**5-minute judge path:** see [Wave 4 — Review in 5 minutes](#review-wave-4-in-5-minutes-judges).

**Pitch:** *FHE Oracle Bridge lets DeFi act on markets without broadcasting every tick to MEV bots — encrypted ingest, encrypted median, boolean-only liquidations on CoFHE ([Wave 4](#wave-4--private-liquidation)).*

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

### `PrivateLiquidator*` — private liquidation (Wave 4)

Positions store **encrypted** liquidation thresholds. CoFHE path: `requestLiquidationCheck` → keeper `completeLiquidation`. Full flow: [Wave 4 — Private liquidation](#wave-4--private-liquidation).

---

## Quick start

```bash
git clone https://github.com/Nanle-code/fhe-oracle-bridge
cd fhe-oracle-bridge
npm install
cp .env.example .env   # add PRIVATE_KEY, contract addresses after deploy
```

```bash
npx hardhat test                                        # 36 passing
npx hardhat run scripts/demoFlow.js --network hardhat   # Wave 4 judge demo (local)
npm run wave4:live                                      # Wave 4 E2E on Arbitrum Sepolia
npm run frontend                                        # local dashboard
```

---

## Live testnet demo

> **Wave 4 operators:** start with [Wave 4 — Run yourself](#run-wave-4-yourself-operators). Judges: [Wave 4 — Review in 5 minutes](#review-wave-4-in-5-minutes-judges).

### Prerequisites

`.env`: `PRIVATE_KEY`, `FHE_ORACLE_BRIDGE`, `PRIVATE_LIQUIDATOR` (must match [`frontend/config.json`](./frontend/config.json)). Arbitrum Sepolia ETH (~0.02+).

### Health & Wave 4 E2E

```bash
npm run demo:preflight       # RPC, feeds, CoFHE endpoints
npm run cofhe:wait           # if ZK_VERIFY_FAILED / timeout
npm run wave4:live           # full liquidation cycle on testnet
npm run wave4:live:wait      # wait for CoFHE, then wave4:live
```

Optional env: `CRASH_BPS=1500` `LIQ_PREMIUM_BPS=500` `COLLATERAL_ETH=0.005` `SKIP_INITIAL_SUBMIT=1`

**Success:** `success: true` + `completeTx`. On Arbiscan: `PositionOpened` → `LiquidationCheckPrepared` → `PositionLiquidated`.

### Wave 4 split steps

```bash
npm run submit:live:arbitrum-sepolia
npm run wave4:open
POSITION_ID=1 npm run wave4:finish
```

### Always-on stack (feeds + Wave 4 keeper)

```bash
npm run spin          # feeder + liquidation-keeper + frontend
npm run spin:logs
npm run spin:stop
```

### Dashboard & frontend deploy

| | |
|---|---|
| **Judges** | https://fhe-oracle-bridge-demo.surge.sh/ |
| **Republish** | `npm run deploy:frontend:surge` |
| **Local** | `npm run frontend` → http://127.0.0.1:8765/ |

Record txs in [Wave 4 — Recorded txs](#recorded-wave-4-txs-paste-after-a-successful-live-run).

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

### Step 3 — CoFHE (production testnet / Wave 4)

Use the **async** Wave 4 pattern ([flow](#wave-4-flow-cofhe--arbitrum-sepolia)) — not sync `FHE.decrypt` in one tx:

```solidity
liquidator.openPosition(feedId, encLiqPrice, { value: collateral });
liquidator.requestLiquidationCheck(positionId);
// Keeper: decryptForTx(ctHash) → completeLiquidation(positionId, isLiquidatable, proof)
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

### Liquidation keeper (Wave 4)

Watches `LiquidationCheckPrepared`, runs `decryptForTx(ctHash).withoutPermit()`, calls `completeLiquidation`. See [Wave 4 deliverables](#wave-4-deliverables).

```bash
npm run keeper:arbitrum-sepolia
# env: PRIVATE_LIQUIDATOR=0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff, KEEPER_POLL_MS=8000
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
| **Wave 4** | |
| `npm run demo:preflight` | Pre-demo health (RPC, feeds, CoFHE) |
| `npm run wave4:live` | **Wave 4** — full live liquidation E2E |
| `npm run wave4:live:wait` | Wait for CoFHE, then Wave 4 E2E |
| `npm run wave4:open` | Open position only |
| `npm run wave4:finish` | Crash price + request + complete (`POSITION_ID=N`) |
| `npm run demoFlow` (via hardhat) | Wave 4 narrative on local mock |
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
| 4 | **Wave 4:** `PrivateLiquidator` open / `isLiquidatable` / liquidate / keeper flow |
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
| **2** | Access registry, consumers, UI | ✅ | ✅ [Dashboard](https://fhe-oracle-bridge-demo.surge.sh/) |
| **3** | Multi-feeder encrypted median | ✅ | 🔄 `npm run wave3:quorum` |
| **[4](#wave-4--private-liquidation)** | **Private liquidation + keeper** | ✅ | 🔄 `npm run wave4:live` · record txs |
| **5** | Threshold alerts | ✅ | 🔄 `npm run wave5:live` optional |

**Wave 4 summary:** encrypted predicate → boolean via CoFHE → keeper completes liquidation. Nothing for MEV bots to front-run on a public price tick. Details: [Wave 4 section](#wave-4--private-liquidation).

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
│   ├── wave4LiveE2E.js, wave4FinishLiquidation.js, openPositionLive.js  # Wave 4
│   ├── wave3LiveQuorum.js, wave5LiveE2E.js
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

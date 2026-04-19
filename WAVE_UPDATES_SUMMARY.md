# Wave Updates Summary — FHE Oracle Bridge

## Product north star

**One sentence:** Allow DeFi protocols to act on price data **without ever exposing that price as plaintext on-chain** — answers surface as **authorized booleans** and downstream actions (liquidations, alerts), not as a public oracle tick.

**Current release position:** **Wave 2** (access control + consumer integration on the path to continuous live-testnet operation).

---

## Wave status at a glance

| Wave | Focus | Status |
|------|--------|--------|
| **1** | Core oracle: encrypted ingest, feeds, opaque storage | ✅ Complete |
| **2** | Access registry, whitelisted consumers, staleness, “yes/no” consumer patterns | 🔄 **Current** |
| **3** | Multi-feeder ops, encrypted median as a **live** quorum story | 📋 Planned |
| **4** | End-to-end **private liquidation** driven by booleans + keepers on testnet | 📋 Planned |
| **5** | Threshold alerts, multi-asset **runbooks**, continuous operation | 📋 Planned |

---

## Wave 1: Core Oracle Infrastructure — ✅ Complete

**Delivered (in tree):**

- Oracle contracts with **ciphertext price handles** (local `FHEOracleBridge` + mocks; CoFHE / native Fhenix variants: `FHEOracleBridgeCofhe`, `FHEOracleBridgeFhenix`).
- Feeder authorization, feed lifecycle (create / pause / resume), TTL and rounds.
- Off-chain **encrypt → `submitPrice`** path wired for CoFHE testnets (`scripts/submitPrice.js`, `scripts/feederDaemon.js`).

**Proven locally:** Hardhat tests and compile/deploy scripts treat Wave-1 behavior as baseline.

**Out of scope for this wave (by design):** General-purpose non-price oracles, decentralized validator sets, fee markets — not goals of this milestone.

---

## Wave 2: Access Control & Consumer Integration — 🔄 Current

This is the **active milestone**: protocols must be able to **ask encrypted questions** and receive **guarded access** to ciphertext, with **staleness** and **whitelist** enforcement.

**Already implemented (code + tests):**

- `AccessRegistry.sol` — whitelist consumers; non-whitelisted pulls revert.
- `MockConsumer.sol` (+ CoFHE / Fhenix counterparts) — reference **comparison** patterns against encrypted aggregate.
- `IFHEOracleBridge*.sol` — integration surface for DeFi consumers.
- Staleness guard (TTL) and revert paths covered in the test suite.
- `frontend/index.html` — dashboard, RPC/oracle/registry config, wallet connect to avoid brittle public-RPC + browser CORS setups.

**Still to close Wave 2 against the product spec:**

- **Single canonical live-testnet demo**: deployed CoFHE addresses in docs / default frontend config, reproducible “connect → refresh → see feeds” for judges and integrators.
- **Narrative lock:** document explicitly what crosses the boundary (e.g. completion bits on CoFHE) vs what never appears (plaintext price in storage or as a public oracle field).
- **Integration polish:** one documented path for a third-party consumer to get whitelisted and call `getEncryptedPrice` on Arbitrum Sepolia or Base Sepolia without hunting env vars.

**Validation target:** existing tests for Wave-1/2 behaviors continue to pass; add or tighten **integration checks** as Wave-2 exit criteria when live addresses are fixed.

---

## Wave 3: Multi-Feeder Aggregation — 📋 Planned

**Intent:** Multiple feeders submit **without any individual submission being readable on-chain**; **encrypted median** finalizes the round.

**Already in repository (ahead of roadmap closure):**

- Median libraries (`MedianLib`, `MedianLibCofhe`, `MedianLibFhenix`) and quorum / min-feeders logic in oracle variants.
- Test coverage for multi-feeder and median behavior on Hardhat.

**Not yet “product done” for Wave 3:**

- **Continuous** multi-feeder operation on a **live** CoFHE testnet (not only CI / local).
- Operational tooling: monitoring feeder liveness, missed rounds, and RPC health for `feederDaemon` under multiple keys (`FEEDER2_PRIVATE_KEY`, `FEEDER3_PRIVATE_KEY`).
- Economic layer in production posture: staking/slashing runbooks and owner multisig assumptions documented for mainnet-minded reviewers.

---

## Wave 4: Private Liquidation & Keeper Loop — 📋 Planned

**Intent:** **“Is liquidatable?” → boolean → keeper → `liquidate`** with no plaintext price in oracle storage; whales are not trivially hunted via on-chain price ticks.

**Already in repository:**

- `PrivateLiquidator.sol` (local) and `PrivateLiquidatorCofhe.sol` with prepare / complete patterns.
- `scripts/liquidationKeeper.js` — watches `LiquidationCheckPrepared`, CoFHE decrypt, `completeLiquidation`.
- `scripts/demoFlow.js` — judge narrative on Hardhat.

**Not yet “product done” for Wave 4:**

- **Always-on keeper** on testnet with funded bot key, stable RPC, and incident logging.
- End-to-end **video / written runbook**: open position → price moves → prepare → keeper completes → liquidation event, all on **Arbitrum Sepolia or Base Sepolia**.
- Hardening: gas limits, retry policy, and `KEEPER_FROM_BLOCK` strategy for long-running processes.

---

## Wave 5: Threshold Alerts & Production Readiness — 📋 Planned

**Intent:** Same boolean-driven story for **alerts**; multi-asset feeds are a **first-class ops** story, not only a contract feature flag.

**Already in repository:**

- `PrivateThresholdAlertsCofhe.sol`, `scripts/thresholdAlertKeeper.js`, `scripts/registerThresholdAlert.js`, `scripts/prepareThresholdCheck.js`.
- Multi-feed support in deployment and UI concepts (e.g. ETH/BTC feeds).

**Not yet “product done” for Wave 5:**

- **Threshold alert E2E** on live testnet: register → prepare → keeper completes → `ThresholdAlert` fired reliably.
- **Runbooks**: deployment checklist, env template alignment, and “what we do not ship yet” (no generic data oracle, no 100-node decentralized feeder set, no tokenized fee marketplace — unless explicitly scoped later).
- Optional: hosted frontend or CI badge tied to **live** contract set rather than localhost-only demos.

---

## Tests and local validation

```bash
npm install
npx hardhat test
npx hardhat run scripts/demoFlow.js --network hardhat
```

The suite still maps **conceptually** to waves 1–5 (see README **Testing** table). **Roadmap position** is Wave **2** for **product / testnet continuity**; later waves close the gap between **“code exists”** and **“always-on live lifecycle.”**

---

## Repository map (high level)

| Area | Role |
|------|------|
| `contracts/FHEOracleBridge*.sol` | Oracle core per network mode |
| `contracts/AccessRegistry.sol` | Wave-2 access control |
| `contracts/MockConsumer*.sol` | Wave-2 consumer patterns |
| `contracts/PrivateLiquidator*.sol` | Wave-4 liquidation |
| `contracts/PrivateThresholdAlertsCofhe.sol` | Wave-5 alerts (CoFHE) |
| `scripts/feederDaemon.js`, `submitPrice.js` | Private ingest / updates |
| `scripts/liquidationKeeper.js`, `thresholdAlertKeeper.js` | Boolean completion loops |
| `frontend/index.html` | Dashboard and config |
| `README.md` | Full architecture and integration guide |

---

## How to run (quick)

```bash
npm install
npx hardhat test
npm run frontend   # prints URL; default 8765, auto-increments if port busy
```

**Hosted demo:** contract addresses and RPCs for the dashboard live in **`frontend/config.json`**. After redeploying, update that file, then publish via **GitHub Actions → GitHub Pages** (see README **Quick Start → §5**). Optional: set `publicDemoUrl` in `config.json` to your Pages URL.

CoFHE testnet deploy examples live in `README.md` and `package.json` scripts (`deploy:arbitrum-sepolia`, `deploy:base-sepolia`, `feeder:*`, `keeper:*`).

---

## Summary

**Wave 1** is **done**: encrypted ingest and oracle core are in place. **Wave 2** is **current**: registry + consumer + staleness + UI exist; **finish** means a **clear, repeatable live-testnet story** for integrators. **Waves 3–5** are **planned**: much of the code is already present, but **exit criteria** are **continuous multi-feeder median**, **keeper-driven liquidation**, and **keeper-driven threshold alerts** on a **live** Fhenix CoFHE testnet, with runbooks — matching the full lifecycle described in the product brief.

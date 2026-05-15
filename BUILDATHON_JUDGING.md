# Buildathon Judging Alignment — FHE Oracle Bridge

Quick map from **judging criteria** → **evidence** → **how to verify**.  
Full demo steps: [`DEMO.md`](./DEMO.md).

## Submission links

| Item | URL |
|------|-----|
| **Live dashboard** | https://fhe-oracle-bridge-demo.surge.sh/ |
| **Repository** | https://github.com/Nanle-code/fhe-oracle-bridge |
| **Network** | Arbitrum Sepolia (`421614`) |
| **Demo video** | _(add link before final submit)_ |
| **Wave 4 E2E tx** | _(paste `completeTx` from `npm run wave4:live` into DEMO.md)_ |

### Deployed contracts (Arbitrum Sepolia)

| Contract | Address |
|----------|---------|
| AccessRegistry | `0x3b01F41557C08587c83c1EcA40ef93bb6829D223` |
| FHEOracleBridge (CoFHE) | `0x4c1A39704D65992464C4BE356c1A0BA001526dC3` |
| MockConsumer | `0x2B826A58AB77E474c2A3a6C9B8cc521F33AA3d8c` |
| PrivateLiquidator | `0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff` |
| PrivateThresholdAlerts | `0x80886CCF7253337E1ABe911CD36f1F7BAAdB1932` |

---

## 1. Privacy Architecture

**Thesis:** Price data and user thresholds stay **FHE ciphertext on-chain**; only **authorized booleans** (e.g. `isLiquidatable`) cross the plaintext boundary via CoFHE threshold decryption — not a public USD oracle tick.

| Evidence | Where |
|----------|--------|
| Encrypted storage (`euint128`) | `contracts/FHEOracleBridgeCofhe.sol` |
| Whitelist gate | `contracts/AccessRegistry.sol` → `getEncryptedPrice` reverts |
| Encrypted median | `contracts/libraries/MedianLibCofhe.sol` |
| Encrypted liquidation threshold | `contracts/PrivateLiquidatorCofhe.sol` |
| Bool-only reveal path | `requestLiquidationCheck` → `LiquidationCheckPrepared` → keeper `completeLiquidation` |
| UI shows metadata only | `frontend/index.html` — “privacy proof” panel |

**Verify (5 min):**

1. Open live dashboard → connect wallet → refresh feeds (round/age, no plaintext price).
2. Arbiscan → oracle contract → storage: no public `latestAnswer`-style field.
3. Run `npx hardhat run scripts/demoFlow.js --network hardhat` OR live `npm run wave4:live` (see DEMO.md).

**Trust boundary (say this to judges):** Feeders see spot before encrypting off-chain; on-chain observers never read another feeder’s submission or the aggregate as plaintext. Keeper learns **only** the liquidation predicate boolean.

---

## 2. Innovation & Originality

| Differentiator | vs incumbents |
|----------------|---------------|
| **On-chain encrypted median** | Chainlink: median off-chain in plaintext |
| **Predicate oracle rail** | Not a public index — private comparisons for DeFi actions |
| **CoFHE on Arbitrum Sepolia** | FHE precompile usage on familiar L2 testnet |
| **Full pipeline** | Ingest → quorum/median → consumer → keeper → liquidation/alert |

**Verify:** README “Core Innovation” + `scripts/demoMultiFeeder.js` (local median) + optional `npm run wave3:quorum` (live).

---

## 3. User Experience

| Surface | Audience |
|---------|----------|
| **Surge dashboard** | Judges — wallet, feeds, privacy compare, events |
| **`demoFlow.js`** | Local 3-step narrative (no gas) |
| **`DEMO.md`** | Operator runbook for testnet |
| **Video** | _(recommended — CLI wave4 is not judge-friendly)_ |

**Verify:** https://fhe-oracle-bridge-demo.surge.sh/ → Dashboard → Privacy proof panel → Event log after feeder runs.

**Gap to close:** Record 2–3 min video + paste liquidation tx hashes into DEMO.md.

---

## 4. Technical Execution

| Evidence | Status |
|----------|--------|
| Hardhat tests | `npx hardhat test` — **36 passing** |
| Deploy scripts | `scripts/deploy.js`, `npm run deploy:arbitrum-sepolia` |
| Live deployment | Addresses in `frontend/config.json` |
| Automation | `npm run spin`, keepers, `npm run testnet:smoke` |
| CI | `.github/workflows/hardhat-test.yml`, `testnet-smoke.yml` |

**Verify:**

```bash
npm install && npx hardhat test
npm run demo:preflight
npm run wave4:live:wait   # when CoFHE testnet is up
```

**Honest scope:** Waves 3–5 are **implemented in code** and proven on Hardhat; **live testnet** continuously proves feeder + dashboard; full live liquidation/alert E2E should be recorded before judging (see DEMO.md).

---

## 5. Market Potential

**Problem:** MEV on oracle updates, whale liquidation hunting, institutional reluctance to fully public financial rails.

**Customers:** Lending / perps / structured products that need **private trigger prices** without publishing bands on-chain.

**Positioning:** **B2B privacy infrastructure** (whitelisted consumers) — complements public oracles; does not replace Chainlink for open index feeds.

**Use cases in repo:** Private liquidator, threshold alerts, MockConsumer comparison patterns (bands, above/below).

---

## Pre-submit checklist

- [ ] `npm run demo:preflight` passes
- [ ] `npm run wave4:live` success → tx hashes in DEMO.md
- [ ] Demo video uploaded; link in this file + BUILDATHON_SUBMISSION.md
- [ ] Surge dashboard refreshed (`npm run deploy:frontend:surge`)
- [ ] BUILDATHON_SUBMISSION.md team/contact filled in
- [ ] One consistent wave status (see WAVE_UPDATES_SUMMARY.md)

---

## One-line pitch

**FHE Oracle Bridge is privacy-preserving price infrastructure for DeFi: encrypted ingest, encrypted median, and boolean-only liquidations on CoFHE — so protocols act on markets without broadcasting every tick to MEV bots.**

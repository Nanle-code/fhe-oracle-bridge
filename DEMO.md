# FHE Oracle Bridge — Live Testnet Demo

**Network:** Arbitrum Sepolia (chain `421614`)  
**Dashboard:** [https://fhe-oracle-bridge-demo.surge.sh/](https://fhe-oracle-bridge-demo.surge.sh/)  
**Explorer:** [Arbiscan Sepolia](https://sepolia.arbiscan.io)

## Deployed contracts

| Contract | Address |
|----------|---------|
| AccessRegistry | `0x3b01F41557C08587c83c1EcA40ef93bb6829D223` |
| FHEOracleBridge (CoFHE) | `0x4c1A39704D65992464C4BE356c1A0BA001526dC3` |
| MockConsumer | `0x2B826A58AB77E474c2A3a6C9B8cc521F33AA3d8c` |
| PrivateLiquidator | `0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff` |
| PrivateThresholdAlerts | `0x80886CCF7253337E1ABe911CD36f1F7BAAdB1932` |

Canonical copy: [`frontend/config.json`](./frontend/config.json)

## What to show judges (5 minutes)

1. **Problem** — Traditional oracles expose plaintext price; open `demoFlow.js` locally or use the dashboard “Chainlink vs FHE” panel.
2. **Encrypted ingest** — On dashboard: connect wallet → refresh feeds → feeds show round/age with **no plaintext price field** on Arbiscan storage.
3. **Private liquidation** — Run Wave 4 live E2E (below); only `isLiquidatable` bool is revealed via CoFHE, not spot or threshold USD.
4. **Access control** — `getEncryptedPrice` from a non-whitelisted address reverts (`Oracle: consumer not whitelisted`).

## Prerequisites

```bash
cp .env.example .env
# Fill: PRIVATE_KEY, FHE_ORACLE_BRIDGE, PRIVATE_LIQUIDATOR (addresses above)
# Deployer/feeder wallet needs Arbitrum Sepolia ETH (~0.02+ for one demo)
```

```bash
npm install
```

## Pre-demo health check

```bash
npm run demo:preflight
npm run testnet:health
npm run testnet:smoke
```

All CoFHE endpoints should be reachable. If `ZK_VERIFY_FAILED` or `ETIMEDOUT` appears, wait and retry:

```bash
npm run cofhe:wait          # blocks until CoFHE responds
npm run wave4:live:wait     # wait for CoFHE, then full E2E
```

## Option A — Full Wave 4 E2E (one command)

Submits live spot (CoinGecko + Binance), opens position, crashes price, requests liquidation, decrypts predicate, completes liquidation:

```bash
npm run wave4:live
```

Optional tuning:

```bash
CRASH_BPS=1500 LIQ_PREMIUM_BPS=500 COLLATERAL_ETH=0.005 npm run wave4:live
```

**Success:** script prints `success: true` and `completeTx` hash. On Arbiscan, look for `PositionOpened` → `LiquidationCheckPrepared` → `PositionLiquidated`.

## Option B — Split steps (if E2E times out)

```bash
npm run submit:live:arbitrum-sepolia
npm run wave4:open
# Note positionId from output, then:
POSITION_ID=1 npm run wave4:finish
```

## Option C — Always-on stack (demo day)

```bash
npm run spin          # feeder + liquidation keeper + frontend
npm run spin:logs     # tail logs
npm run spin:stop     # shutdown
```

Requires `.env`: `PRIVATE_KEY`, `FHE_ORACLE_BRIDGE`, `PRIVATE_LIQUIDATOR`, optional `FEEDER2_PRIVATE_KEY`, `PRIVATE_THRESHOLD_ALERTS`.

## Local judge narrative (no testnet gas)

```bash
npx hardhat test
npx hardhat run scripts/demoFlow.js --network hardhat
```

## Wave 3 — Multi-feeder quorum (optional)

```bash
npm run setup:feeder2
npm run wave3:quorum
```

## Wave 5 — Threshold alert (optional)

```bash
npm run wave5:live
```

## Recorded demo transactions

_Update this section after each successful live run._

| Step | Tx hash | Notes |
|------|---------|-------|
| Wave 4 E2E | _(paste from `npm run wave4:live` output)_ | `completeTx` |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Set POSITION_ID` | Use `POSITION_ID=N npm run wave4:finish` |
| `ZK_VERIFY_FAILED` | Retry; check CoFHE status via `npm run testnet:health` |
| `consumer not whitelisted` | Redeploy path: run `deploy.js` whitelisting step |
| Stale feeds | `npm run spin` or `npm run submit:live:arbitrum-sepolia` |
| Low ETH | Fund keeper/feeder on [Arbitrum Sepolia faucet](https://www.alchemy.com/faucets/arbitrum-sepolia) |

## Privacy boundary (one sentence for judges)

**Spot and liquidation thresholds stay as FHE ciphertext on-chain; the keeper and chain only learn a single boolean `isLiquidatable` after CoFHE threshold decryption — never a public USD oracle tick.**

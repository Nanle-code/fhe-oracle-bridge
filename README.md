# FHE Oracle Bridge

A privacy-preserving price oracle built on [Fhenix](https://fhenix.io) using Fully Homomorphic Encryption (FHE). Prices are stored and operated on as encrypted `euint256` values — never exposed as plaintext on-chain.

Built for the **Privacy-by-Design dApp Buildathon** on Fhenix.

---

## The Problem

On every public blockchain today, price oracle data is fully transparent:

```
latestAnswer() → 350000000000  // $3,500 — visible to everyone
```

This creates three critical vulnerabilities:

1. **MEV front-running** — bots read oracle updates before they're processed and execute ahead of them
2. **Position hunting** — whale stop-losses and liquidation thresholds are visible; traders are targeted
3. **Institutional blocker** — compliance teams won't deploy on rails where all financial data is public

FHE Oracle Bridge solves this at the infrastructure layer.

---

## How It Works

```
Feeder (off-chain)
  │
  │  encrypt_uint256(3500_00000000)  ← CoFHE SDK, client-side
  │
  ▼
FHEOracleBridge.sol
  │  submitPrice(feedId, encPrice)
  │  → stores as euint256 (FHE ciphertext)
  │  → never decrypts on-chain
  │
  ▼
Consumer contracts (whitelisted only)
  │  getEncryptedPrice(feedId) → euint256
  │
  ├─ isPriceAbove(threshold)    ← FHE comparison, no plaintext
  ├─ isPriceBelow(threshold)    ← FHE comparison
  ├─ isWithinBand(lower, upper) ← FHE comparison
  └─ isLiquidatable(positionId) ← FHE comparison → liquidation fires
```

The comparison runs inside the FHE precompile. Only the boolean result is revealed. The price itself never appears in any transaction or storage slot as plaintext.

---

## Project Structure

```
fhe-oracle-bridge/
├── contracts/
│   ├── AccessRegistry.sol        # Whitelist management for consumer contracts
│   ├── FHEOracleBridge.sol       # Core oracle — encrypted storage + aggregation
│   ├── MockConsumer.sol          # Wave 2 demo consumer (price checks)
│   ├── PrivateLiquidator.sol     # Wave 4 — full liquidation engine
│   ├── interfaces/
│   │   └── IFHEOracleBridge.sol  # Interface for consumers to import
│   └── mocks/
│       └── FHEMock.sol           # Local Hardhat stand-in for FHE types
├── scripts/
│   ├── deploy.js                 # Full deployment + setup
│   ├── demoFlow.js               # Judge demo sequence
│   └── submitPrice.js            # Manual feeder price submission
├── test/
│   └── FHEOracleBridge.test.js   # 25 tests across all 5 waves
├── hardhat.config.js
└── package.json
```

---

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — add your PRIVATE_KEY
```

### 3. Run tests (local Hardhat)

```bash
npx hardhat test
```

Expected output: 25 passing tests across all 5 waves + gas report.

### 4. Run the judge demo

```bash
npx hardhat run scripts/demoFlow.js --network hardhat
```

This executes the exact 3-step sequence showing:
- Step 1: Transparent oracle (what Chainlink looks like)
- Step 2: FHE oracle storage — opaque euint256
- Step 3: Liquidation fires with zero plaintext price in any tx

### 5. Deploy to Fhenix testnet

```bash
# Arbitrum Sepolia (CoFHE)
npx hardhat run scripts/deploy.js --network arbitrumSepolia

# Fhenix Helium
npx hardhat run scripts/deploy.js --network helium
```

---

## Contracts

### `AccessRegistry.sol`

Controls which consumer contracts can pull encrypted prices.

| Function | Description |
|----------|-------------|
| `whitelist(address, string)` | Owner adds a consumer with a label |
| `revoke(address)` | Owner removes a consumer |
| `isWhitelisted(address)` | Called by oracle to gate pulls |
| `allConsumers()` | List all ever-whitelisted addresses |

### `FHEOracleBridge.sol`

The core oracle. Stores prices as `euint256` — FHE ciphertext.

| Function | Description |
|----------|-------------|
| `createFeed(description, ttl, minFeeders)` | Owner creates a new price feed |
| `addFeeder(address)` | Owner registers a feeder |
| `stake()` | Feeder bonds ETH to participate |
| `submitPrice(feedId, encPrice)` | Feeder submits encrypted price |
| `getEncryptedPrice(feedId)` | Whitelisted consumer pulls `euint256` |
| `getFeedInfo(feedId)` | Public metadata — no price exposure |
| `slash(feeder, amount)` | Owner slashes outlier feeder |

**Feed IDs:**
- `1` = ETH / USD
- `2` = BTC / USD
- (extensible via `createFeed`)

### `MockConsumer.sol`

Demo consumer showing oracle integration pattern.

```solidity
// Any whitelisted contract integrates in ~3 lines:
euint256 price = oracle.getEncryptedPrice(ETH_USD_FEED);
euint256 threshold = FHE.asEuint256(encThreshold);
ebool isAbove = FHE.gt(price, threshold);
```

### `PrivateLiquidator.sol`

Production-grade liquidation engine. Positions are opened with an **encrypted** liquidation threshold. The comparison with the oracle price runs entirely in FHE.

---

## Migrating to Fhenix Testnet (Real FHE)

The project uses `FHEMock.sol` locally so all logic can be tested without a Fhenix node. To deploy to a real FHE network:

**Step 1** — In `FHEOracleBridge.sol`, replace:
```solidity
import "./mocks/FHEMock.sol";
```
with:
```solidity
import "@fhenixprotocol/contracts/FHE.sol";
```

**Step 2** — Update `submitPrice` parameter type:
```solidity
// Before (local mock):
function submitPrice(uint256 feedId, uint256 encPrice)

// After (Fhenix):
function submitPrice(uint256 feedId, inEuint256 calldata encPrice)
```

**Step 3** — Update internal FHE calls:
```solidity
// Before:
euint256 enc = FHEMock.asEuint256(encPrice);
bool result  = FHEMock.gt(a, b);
euint256 med = FHEMock.encryptedMedian(prices);

// After:
euint256 enc  = FHE.asEuint256(encPrice);
ebool result  = FHE.gt(a, b);
// encryptedMedian: replace sort with FHE.select + FHE.gt comparisons
```

**Step 4** — Client-side encryption via CoFHE SDK:
```typescript
import { FhenixClient } from "@fhenixprotocol/sdk";

const client = new FhenixClient({ provider });
const encPrice = await client.encrypt_uint256(350000000000); // $3,500
await oracle.submitPrice(1, encPrice);
```

---

## Wave Milestones

| Wave | Deliverable | Grant |
|------|-------------|-------|
| 1 | `FHEOracleBridge.sol` deployed, encrypted price submission, opaque storage proven | $3,000 |
| 2 | `AccessRegistry.sol`, whitelisted consumer pull, staleness guard, non-whitelisted revert | $5,000 |
| 3 | Multi-feeder aggregation, encrypted median, staking/slashing | $12,000 |
| 4 | `PrivateLiquidator.sol`, end-to-end demo script, zero plaintext price in any tx | $14,000 |
| 5 | Multi-asset feeds, integration docs, gas profiling, NY Tech Week demo | $16,000 |

---

## Resources

- [Fhenix Docs](https://docs.fhenix.io)
- [CoFHE Quick Start](https://cofhe-docs.fhenix.zone/fhe-library/introduction/quick-start)
- [CoFHE Architecture](https://cofhe-docs.fhenix.zone/deep-dive/cofhe-components/overview)
- [Awesome Fhenix Examples](https://github.com/FhenixProtocol/awesome-fhenix)
- [Buildathon Telegram](https://t.me/+rA9gI3AsW8c3YzIx)

---

## License

MIT

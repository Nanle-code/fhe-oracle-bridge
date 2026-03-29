# Architecture Deep-Dive

## Overview

FHE Oracle Bridge is composed of four contracts and a client-side SDK integration. This document provides a detailed breakdown of each component, data flows, and design decisions.

---

## Contracts

```
AccessRegistry  ──────┐
                      │  isWhitelisted(caller)
FHEOracleBridge  ─────┤  ← price submission (euint256)
                      │  → getEncryptedPrice returns euint256
MockConsumer    ──────┘  (demo consumer)
PrivateLiquidator        (production consumer)
```

---

## Data Flow: Price Submission

```
Off-chain Feeder
│
│  1. price = 3500_00000000  (8-decimal precision, $3,500)
│  2. encPrice = await fhenixClient.encrypt_uint256(price)
│     → returns inEuint256 { data: Uint8Array[...] }
│
│  3. oracle.submitPrice(feedId=1, encPrice)
│                      │
│                      ▼
FHEOracleBridge.submitPrice()
│
│  4. Verify: feeder registered, stake ≥ MIN_STAKE, feed exists & active
│  5. Verify: not already submitted this round
│  6. euint256 enc = FHE.asEuint256(encPrice)
│     ← wraps inEuint256 into a handle the EVM can store and operate on
│  7. submissions[feedId][round][msg.sender] = { price: enc, submitted: true }
│  8. roundFeeders[feedId][round].push(msg.sender)
│
│  9. If roundFeeders.length >= feed.minFeeders → _finaliseRound()
│
_finaliseRound()
│
│  10. Collect all euint256 prices into memory array
│  11. If n == 1 → aggregated = prices[0]
│      If n > 1  → aggregated = FHEMock.encryptedMedian(prices)
│                   (on Fhenix: O(n²) FHE.gt comparisons, no decryption)
│
│  12. feeds[feedId].encryptedPrice = aggregated
│  13. feeds[feedId].lastUpdated = block.timestamp
│  14. feeds[feedId].roundId++
│  15. emit FeedUpdated(feedId, roundId, n)
```

---

## Data Flow: Consumer Price Pull

```
PrivateLiquidator.isLiquidatable(positionId)
│
│  1. Verify: position is active
│  2. euint128 currentPrice = oracle.getEncryptedPrice(pos.feedId)
│                                    │
│                                    ▼
│                         FHEOracleBridge.getEncryptedPrice()
│                         │
│                         a. require(registry.isWhitelisted(msg.sender))
│                         b. require(feed.active)
│                         c. require(feed.lastUpdated > 0)
│                         d. require(block.timestamp - lastUpdated <= ttl)
│                         e. return feed.encryptedPrice   ← euint128 handle
│
│  3. ebool result = FHE.gt(pos.encLiquidationPrice, currentPrice)
│     ← runs entirely inside FHE precompile — no plaintext observed
│
│  4. return FHE.decrypt(result)   ← only a bool crosses the plaintext boundary
```

---

## Encrypted Median Algorithm

For `n` feeders submitting in the same round, the aggregated price is the median — computed without revealing any individual submission.

### Algorithm (O(n²) FHE comparisons)

```
Given prices[] = [p0, p1, p2, ... pn-1]  (all euint256 ciphertexts)

For each pi:
    wins[i] = count of j where FHE.gt(pi, pj) is true

Median = pi where wins[i] ≈ n/2
```

In FHE, this is implemented using `FHE.gt` and `FHE.select` operations:
- All comparisons happen inside the FHE precompile
- No intermediate values are ever decrypted
- The result `aggregated` is itself a `euint256` ciphertext

**Complexity**: O(n²) `FHE.gt` operations. For n ≤ 5, this is ~10 comparisons per round. Practical for a 1-5 feeder deployment.

---

## FHE Type System (Fhenix CoFHE)

| Type | Description | Bits |
|---|---|---|
| `euint128` | Encrypted unsigned integer, 128-bit | 128 |
| `euint256` | Encrypted unsigned integer, 256-bit | 256 |
| `ebool` | Encrypted boolean | 1 |
| `inEuint128` | Input-encrypted uint128 (from client SDK) | — |
| `inEuint256` | Input-encrypted uint256 (from client SDK) | — |

**Key operations used:**

| Operation | Solidity | Description |
|---|---|---|
| Encrypt | `FHE.asEuint256(inEuint256)` | Wrap client ciphertext |
| Greater-than | `FHE.gt(a, b) → ebool` | Encrypted comparison |
| Less-than | `FHE.lt(a, b) → ebool` | Encrypted comparison |
| AND | `FHE.and(a, b) → ebool` | Encrypted logic |
| Select | `FHE.select(c, a, b) → euint256` | Encrypted ternary |
| Decrypt | `FHE.decrypt(ebool) → bool` | Reveals only final boolean |

---

## Local Testing vs. Production

The project ships with `FHEMock.sol` — a local stand-in that treats `euint256` as a plain `uint256`. This means:

- **All logic, access control, event emissions, and state transitions are testable locally** without a Fhenix node
- Privacy guarantees are **only active** when deployed to Fhenix Helium or Arbitrum Sepolia (CoFHE)
- The one-line import change (`FHEMock` → `@fhenixprotocol/contracts/FHE`) activates real FHE

---

## Feeder Staking & Slashing

Feeders must bond ETH before submitting prices. This creates economic skin-in-the-game:

```
MIN_STAKE = 0.01 ETH

stake()  → feederStake[msg.sender] += msg.value
slash()  → feederStake[feeder] -= amount
         → slashed ETH transferred to owner
           (v2: route to insurance fund)
```

Slashing is owner-controlled in v1. A fully decentralised approach would use:
1. On-chain outlier detection via FHE comparison across all submissions
2. Automatic slashing when a feeder's submission deviates significantly from the median

---

## Price Precision

All prices are stored with **8 decimal places** (Chainlink-compatible format):

```
$3,500.00  →  3500_00000000  (350000000000)
$2,000.00  →  2000_00000000  (200000000000)
```

This allows integration with any protocol that currently consumes Chainlink price feeds.

---

## Staleness Guard

Each feed has a configurable TTL (time-to-live). If a round is not updated within the TTL, `getEncryptedPrice` reverts:

```solidity
require(
    block.timestamp - feed.lastUpdated <= feed.ttl,
    "Oracle: stale price"
);
```

Default TTL: **1 hour** (`DEFAULT_TTL = 1 hours`). Configurable per-feed at creation time.

---

## Deployment Order

Contracts must be deployed in dependency order:

```
1. AccessRegistry          (no dependencies)
2. FHEOracleBridge         (depends on: AccessRegistry)
3. MockConsumer            (depends on: FHEOracleBridge)
4. PrivateLiquidator       (depends on: FHEOracleBridge)

Post-deploy:
5. oracle.createFeed(...)
6. oracle.addFeeder(feeder.address)
7. feeder calls oracle.stake({value: 0.01 ETH})
8. registry.whitelist(consumerAddr, "label")
```

This sequence is automated in `scripts/deploy.js`.

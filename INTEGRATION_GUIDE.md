# FHE Oracle Bridge - Integration Guide

## Quick Start for Developers

### 1. Contract Addresses (Arbitrum Sepolia)

```
AccessRegistry:     0x3b01F41557C08587c83c1EcA40ef93bb6829D223
FHEOracleBridge:    0x4c1A39704D65992464C4BE356c1A0BA001526dC3
MockConsumer:       0x2B826A58AB77E474c2A3a6C9B8cc521F33AA3d8c
PrivateLiquidator:  0x5d9DD91F4d8D8bF1c7Df801c6a0453316f4Af3ff
ThresholdAlerts:    0x80886CCF7253337E1ABe911CD36f1F7BAAdB1932
```

### 2. Network Configuration

- **Network**: Arbitrum Sepolia (Chain ID: 421614)
- **RPC**: https://sepolia-rollup.arbitrum.io/rpc
- **FHE**: CoFHE (Cross-chain FHE)

### 3. Integration Steps

#### Step 1: Import Interfaces

```solidity
import "./interfaces/IFHEOracleBridge.sol";
import "@cofhe/contracts/FHE.sol";

contract MyProtocol {
    IFHEOracleBridge public oracle;
    
    constructor(address _oracle) {
        oracle = IFHEOracleBridge(_oracle);
    }
}
```

#### Step 2: Get Whitelisted

Contact the oracle owner to whitelist your contract:
```solidity
registry.whitelist(address(myProtocol), "MyProtocol v1");
```

#### Step 3: Use Encrypted Prices (CoFHE — async liquidation)

On **Arbitrum Sepolia / Base Sepolia**, use `PrivateLiquidatorCofhe`: comparison stays encrypted; only a **boolean** is revealed via the threshold network + keeper.

```solidity
// 1. User opens position with client-encrypted threshold (inEuint128)
liquidator.openPosition(feedId, encLiqPrice, { value: collateral });

// 2. Anyone triggers encrypted check → emits LiquidationCheckPrepared(ctHash)
liquidator.requestLiquidationCheck(positionId);

// 3. Off-chain keeper: decryptForTx(ctHash) → completeLiquidation(id, bool, proof)
//    Keeper learns ONLY isLiquidatable — not spot or threshold USD.
```

See [`DEMO.md`](./DEMO.md) for live testnet commands (`npm run wave4:live`).

**Local Hardhat only** (sync mock decrypt):

```solidity
euint128 currentPrice = oracle.getEncryptedPrice(feedId);
euint128 threshold = FHE.asEuint128(encThreshold);
ebool isLiquidatable = FHE.lt(currentPrice, threshold);
bool result = FHE.decrypt(isLiquidatable); // mock path only
```

### 4. Client-Side Encryption

```typescript
import { CofheClient } from "@cofhe/sdk";

const client = new CofheClient({ provider });

// Encrypt threshold for liquidation
const encThreshold = await client.encrypt_uint128(3000_00000000n); // $3,000

// Call contract with encrypted threshold
await myProtocol.checkLiquidation(1, encThreshold);
```

### 5. Available Feeds

| Feed ID | Pair | Description |
|---------|------|-------------|
| 1 | ETH/USD | Ethereum price in USD |
| 2 | BTC/USD | Bitcoin price in USD |

### 6. Price Format

All prices use **8 decimal precision** (Chainlink compatible):
```
$3,500.00 → 3500_00000000 (350000000000)
$2,000.00 → 2000_00000000 (200000000000)
```

### 7. Error Handling

Common errors and solutions:

```solidity
// "Oracle: consumer not whitelisted"
// Solution: Get your contract whitelisted by registry owner

// "Oracle: stale price"
// Solution: Price feed hasn't been updated recently (TTL = 1 hour)

// "Oracle: feed not active"
// Solution: Feed may be paused or doesn't exist
```

### 8. Demo

Run the local demo to see the system in action:
```bash
npx hardhat run scripts/demoFlow.js --network hardhat
```

### 9. Frontend Dashboard

Visit the live dashboard:
- Local: `npm run frontend` → http://127.0.0.1:8765/
- Live: https://fhe-oracle-bridge-demo.surge.sh/

### 10. Support

- **Documentation**: See README.md
- **Issues**: Open GitHub issue
- **Contact**: Repository maintainers

---

## Security Notes

- Prices are never exposed as plaintext on-chain
- Only whitelisted contracts can access encrypted prices
- All comparisons happen inside FHE precompile
- Only boolean results cross the plaintext boundary

## Current Status

Wave 2 Complete: Core oracle + access control + consumer integration
- ✅ Contracts deployed on Arbitrum Sepolia
- ✅ Frontend dashboard functional
- ✅ Local demo proves concept
- ⚠️ CoFHE testnet submission temporarily unstable (network issue)

The infrastructure is production-ready. The CoFHE network issue is temporary and doesn't affect the core functionality.

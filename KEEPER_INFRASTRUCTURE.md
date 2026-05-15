# FHE Oracle Bridge - Keeper Infrastructure Guide

## Overview

The FHE Oracle Bridge includes a comprehensive keeper infrastructure for automated liquidation management. This system ensures that positions are liquidated efficiently while maintaining complete privacy of price data and liquidation thresholds.

## Architecture

### Components

1. **PrivateLiquidator Contract** - Manages positions and liquidations
2. **Liquidation Keeper Script** - Automated liquidation processing
3. **Event-Driven Architecture** - Responds to liquidation triggers
4. **CoFHE Integration** - Secure decryption of liquidation predicates

### Privacy Model

```
Price Data (Encrypted) + Liquidation Threshold (Encrypted)
    ↓
FHE Comparison (inside precompile)
    ↓
Boolean Result (isLiquidatable) ← Only this is revealed
```

## Local Testing

### Quick Start

```bash
# Run the complete liquidation keeper demo
npx hardhat run scripts/demoLiquidationKeeper.js --network hardhat
```

### What the Demo Shows

1. **Contract Deployment**: Sets up oracle, liquidator, and access control
2. **Price Feeds**: Submits encrypted prices for ETH/USD and BTC/USD
3. **Position Creation**: Opens positions with encrypted liquidation thresholds
4. **Market Simulation**: Simulates price drops triggering liquidations
5. **Liquidation Execution**: Demonstrates automated liquidation with rewards

## Production Deployment

### 1. Environment Setup

Create your `.env` file:

```bash
# Network configuration
PRIVATE_KEY=your_private_key
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc

# Contract addresses (after deployment)
PRIVATE_LIQUIDATOR=0x... # PrivateLiquidatorCofhe address

# Keeper configuration
KEEPER_POLL_MS=8000           # Polling interval (ms)
KEEPER_FROM_BLOCK=0          # Start block for event scanning
KEEPER_LOG_JSON=1            # JSON logging for monitoring
```

### 2. Deploy Contracts

```bash
# Deploy to Arbitrum Sepolia
npm run deploy:arbitrum-sepolia

# Deploy to Base Sepolia
npm run deploy:base-sepolia
```

### 3. Start the Keeper

```bash
# Start liquidation keeper on Arbitrum Sepolia
npx hardhat run scripts/liquidationKeeper.js --network arbitrumSepolia

# Start with custom polling interval
KEEPER_POLL_MS=5000 npx hardhat run scripts/liquidationKeeper.js --network arbitrumSepolia
```

## Keeper Operations

### Event Flow

1. **Liquidation Check Requested**
   ```
   LiquidationCheckPrepared(positionId, ctHash, requestedBy)
   ```

2. **Keeper Processes Event**
   - Detects `LiquidationCheckPrepared` event
   - Extracts `ctHash` (encrypted predicate)
   - Calls CoFHE decryption service

3. **CoFHE Decryption**
   ```javascript
   const { decryptedValue, signature } = await cofhe.decryptForTx(ctHash)
     .withoutPermit()
     .execute();
   const isLiquidatable = decryptedValue !== 0n;
   ```

4. **Complete Liquidation**
   ```javascript
   await liquidator.completeLiquidation(positionId, isLiquidatable, signature);
   ```

### Reward System

- **Liquidator Reward**: 5% of collateral
- **Keeper Gas**: Reimbursed from protocol
- **MEV Protection**: No price exposure prevents front-running

## Monitoring

### Log Formats

#### Human-Readable Logs
```bash
[2024-04-30T10:30:00.000Z] Saw LiquidationCheckPrepared {"positionId":"1","ctHash":"0x...","requestedBy":"0x..."}
[2024-04-30T10:30:02.000Z] Threshold decrypt done (predicate only — no spot price) {"positionId":"1","isLiquidatable":true}
[2024-04-30T10:30:04.000Z] completeLiquidation tx=0x... gas=68277
```

#### JSON Logs (for monitoring systems)
```json
{"ts":"2024-04-30T10:30:00.000Z","event":"LiquidationCheckPrepared","positionId":"1","ctHash":"0x...","requestedBy":"0x...","txHash":"0x..."}
{"ts":"2024-04-30T10:30:02.000Z","event":"decrypt_ok","positionId":"1","isLiquidatable":true}
{"ts":"2024-04-30T10:30:04.000Z","event":"completeLiquidation_ok","positionId":"1","txHash":"0x...","gasUsed":"68277"}
```

### Key Metrics to Monitor

- **Liquidation Processing Time**: Time from request to completion
- **Success Rate**: Percentage of successful liquidations
- **Gas Usage**: Average gas per liquidation
- **Keeper Earnings**: Total rewards earned
- **Error Rate**: Failed liquidations and reasons

## Security Considerations

### Privacy Guarantees

1. **Price Confidentiality**: Prices never exposed as plaintext
2. **Threshold Privacy**: Liquidation thresholds remain encrypted
3. **MEV Resistance**: No front-running opportunities
4. **Predicate Security**: Only boolean results revealed

### Keeper Security

1. **Private Key Protection**: Secure storage of keeper keys
2. **Network Isolation**: Run in secure environment
3. **Rate Limiting**: Prevent abuse and gas exhaustion
4. **Monitoring**: Alert on unusual activity

## Advanced Features

### Multi-Position Processing

The keeper can handle multiple simultaneous liquidations:

```javascript
// Process multiple liquidations in parallel
const events = await liquidator.queryFilter(filter, fromBlock, toBlock);
await Promise.all(events.map(handleEvent));
```

### Custom Logic

Extend the keeper for custom liquidation strategies:

```javascript
// Custom liquidation logic
async function handleEvent(ev) {
  const { positionId, ctHash, requestedBy } = ev.args;
  
  // Add custom validation
  if (await shouldProcess(positionId)) {
    await processLiquidation(positionId, ctHash);
  }
}
```

### Integration with Monitoring

Set up alerts for keeper activity:

```javascript
// Alert on high liquidation volume
if (liquidationCount > THRESHOLD) {
  await sendAlert("High liquidation volume detected");
}
```

## Troubleshooting

### Common Issues

1. **CoFHE Network Issues**
   - Symptom: ZK proof verification failed
   - Solution: Check CoFHE network status, retry later

2. **Gas Price Spikes**
   - Symptom: Transactions failing due to gas
   - Solution: Implement dynamic gas pricing

3. **Event Gaps**
   - Symptom: Missing liquidation events
   - Solution: Adjust `KEEPER_FROM_BLOCK` parameter

### Debug Mode

Enable detailed logging:

```bash
DEBUG=1 KEEPER_LOG_JSON=1 npx hardhat run scripts/liquidationKeeper.js --network arbitrumSepolia
```

## Performance Optimization

### Batch Processing

Process multiple liquidations in a single transaction:

```javascript
// Batch liquidation processing
const batch = await liquidator.batchLiquidate(positionIds);
await batch.wait();
```

### Gas Optimization

- Use efficient data structures
- Minimize storage operations
- Optimize CoFHE calls

### Caching

Cache frequently accessed data:

```javascript
// Cache oracle contract instance
const oracleCache = new Map();
function getOracle(address) {
  if (!oracleCache.has(address)) {
    oracleCache.set(address, new ethers.Contract(address, ORACLE_ABI, provider));
  }
  return oracleCache.get(address);
}
```

## Deployment Checklist

- [ ] Deploy contracts to target network
- [ ] Configure environment variables
- [ ] Set up monitoring and alerting
- [ ] Test liquidation flow
- [ ] Configure gas settings
- [ ] Set up backup keepers
- [ ] Document operational procedures
- [ ] Test failover scenarios

## Support

For issues and questions:

1. Check the logs for error details
2. Verify contract addresses and network configuration
3. Ensure CoFHE network is operational
4. Review this documentation for common solutions

## Conclusion

The FHE Oracle Bridge keeper infrastructure provides a robust, privacy-preserving liquidation system that maintains the confidentiality of price data while ensuring efficient liquidation processing. The event-driven architecture and CoFHE integration make it production-ready for DeFi applications requiring privacy.

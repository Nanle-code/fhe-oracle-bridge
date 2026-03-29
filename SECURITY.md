# Security Policy

## Security Model

FHE Oracle Bridge is a **privacy-preserving oracle** — the highest risk surface is not in smart contract bugs, but in the cryptographic guarantees of the FHE layer itself.

### Threat Model

| Threat | Severity | Mitigation |
|---|---|---|
| MEV front-running on price updates | Critical | Price stored as `euint256` — never readable as uint256 |
| Feeder collusion / price manipulation | High | Encrypted median: feeders cannot see each other's submissions |
| Stale price exploitation | High | Per-feed TTL; `getEncryptedPrice` reverts if expired |
| Unauthorised consumer access | Medium | `AccessRegistry` whitelist enforced on every pull |
| Double-submission by a feeder | Medium | `submissions[feedId][round][feeder]` mapping prevents repeats |
| Feeder economic manipulation | Medium | Min stake (0.01 ETH) required; owner can slash outliers |
| Oracle owner admin key compromise | High | Should be upgraded to multisig in production |
| FHE precompile trust | Critical | Relies on Fhenix CoFHE cryptographic correctness |

### What This Contract Does NOT Protect Against

- **Side-channel attacks on the Fhenix node** itself
- **Admin key compromise** — the owner address can whitelist arbitrary consumers and slash feeders. Use a multisig (e.g. Gnosis Safe) in production.
- **Re-entrance** — no ETH-transferring functions in the oracle itself; `PrivateLiquidator` uses checks-effects-interactions and does not call back into the oracle.

### Known Limitations (v1)

1. **Encrypted median is O(n²) FHE comparisons** — tested safe for up to 5 feeders per round. Larger feeder sets require a more efficient FHE sorting network.
2. **`FHE.decrypt(ebool)` in view functions** — on Fhenix testnets this is synchronous. In production CoFHE, decryption may require an async threshold decryption flow.
3. **No time-weighted average** — the oracle stores the latest round's aggregated price, not a TWAP. TWAP support is planned for v2.

## Reporting a Vulnerability

This is a hackathon submission. If you find a critical vulnerability:

1. **Do not open a public GitHub issue.**
2. Contact the team directly via the [Buildathon Telegram](https://t.me/+rA9gI3AsW8c3YzIx).

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@fhenixprotocol/contracts` | `^0.3.1` | FHE types (`euint256`, `ebool`, `inEuint256`) |
| `@cofhe/hardhat-plugin` | `^0.4.0` | Hardhat integration for CoFHE mock node |
| `@cofhe/sdk` | `^0.4.0` | Client-side encryption utilities |
| `fhenixjs` | `^0.4.1` | JavaScript SDK for FhenixClient |
| `@nomicfoundation/hardhat-toolbox` | `^4.0.0` | Hardhat testing, gas reporting |

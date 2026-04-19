#!/usr/bin/env bash
# Run from your machine (working RPC + funded deployer). Fills .env addresses from deploy output is manual:
# copy the printed block into .env after this finishes.
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "=== 1/4 Deploy CoFHE stack (Arbitrum Sepolia) ==="
export NODE_OPTIONS="--dns-result-order=ipv4first"
npx hardhat run scripts/deploy.js --network arbitrumSepolia

echo ""
echo "=== Next (manual) ==="
echo "  • Paste ACCESS_REGISTRY, FHE_ORACLE_BRIDGE, MOCK_CONSUMER, PRIVATE_LIQUIDATOR,"
echo "    PRIVATE_THRESHOLD_ALERTS from the output into .env"
echo ""
echo "=== 2/4 Optional quorum: add FEEDER2_PRIVATE_KEY to .env, then redeploy (minFeeders 2–3) ==="
echo ""
echo "=== 3/4 Feed price (terminal each, or one if minFeeders=1) ==="
echo "  FEEDER_SIGNER_INDEX=0 npm run feeder:arbitrum-sepolia"
echo "  FEEDER_SIGNER_INDEX=1 npm run feeder:arbitrum-sepolia   # if second key in hardhat.config"
echo ""
echo "=== 4/4 Keepers + UI (optional) ==="
echo "  npm run keeper:arbitrum-sepolia"
echo "  npm run keeper:threshold:arbitrum-sepolia"
echo "  npm run frontend   → open http://127.0.0.1:8765/  (paste addresses in config if needed)"
echo ""

#!/usr/bin/env bash
# Run live testnet demos with correct line breaks (no glued commands).
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"

if [[ "${SKIP_COFHE_WAIT:-}" != "1" ]]; then
  echo "Waiting for CoFHE testnet (SKIP_COFHE_WAIT=1 to skip)…"
  node scripts/cofheWait.js || {
    echo "CoFHE unavailable — try again later or SKIP_COFHE_WAIT=1 if feeds already fresh."
    exit 1
  }
fi

cmd="${1:-}"

case "$cmd" in
  wave4)
    echo "=== Wave 4: open position ==="
    npm run wave4:open
    POSITION_ID="${POSITION_ID:-$(node -e "
      require('dotenv').config();
      const { ethers } = require('ethers');
      const p = new ethers.JsonRpcProvider(process.env.ARBITRUM_SEPOLIA_RPC, 421614);
      const l = new ethers.Contract(process.env.PRIVATE_LIQUIDATOR, ['function positionCount() view returns (uint256)'], p);
      l.positionCount().then(n => console.log(n.toString()));
    ")}"
    echo "=== Wave 4: finish position $POSITION_ID ==="
    POSITION_ID="$POSITION_ID" npm run wave4:finish
    ;;
  wave5)
    npm run wave5:live
    ;;
  wave3)
    npm run wave3:quorum
    ;;
  smoke)
    npm run testnet:smoke
    ;;
  *)
    echo "Usage: $0 {wave4|wave5|wave3|smoke}"
    exit 1
    ;;
esac

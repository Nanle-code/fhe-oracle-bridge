#!/usr/bin/env bash
# Start live Arbitrum Sepolia stack: feeder + liquidation keeper + threshold keeper + frontend.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"
NETWORK="${SPIN_NETWORK:-arbitrumSepolia}"
LOG_DIR="${SPIN_LOG_DIR:-./logs/spin}"
mkdir -p "$LOG_DIR"

need_env() {
  if [[ -z "${!1:-}" ]]; then
    echo "Missing $1 in .env" >&2
    exit 1
  fi
}

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

need_env PRIVATE_KEY
need_env FHE_ORACLE_BRIDGE
need_env PRIVATE_LIQUIDATOR

echo "=== FHE Oracle Bridge — spin ($NETWORK) ==="
echo "Logs: $LOG_DIR"
echo ""

WRAPPER="$(dirname "$0")/spin-worker.sh"
chmod +x "$WRAPPER"

start_bg() {
  local name=$1
  shift
  echo "→ $name"
  nohup "$WRAPPER" "$name" "$@" >>"$LOG_DIR/$name.log" 2>&1 &
  echo "$!" >"$LOG_DIR/$name.pid"
  echo "  pid $(cat "$LOG_DIR/$name.pid") → $LOG_DIR/$name.log"
}

case "$NETWORK" in
  arbitrumSepolia)
    FEEDER_CMD=(npx hardhat run scripts/feederDaemon.js --network arbitrumSepolia)
    KEEPER_CMD=(npx hardhat run scripts/liquidationKeeper.js --network arbitrumSepolia)
    ALERT_CMD=(npx hardhat run scripts/thresholdAlertKeeper.js --network arbitrumSepolia)
  ;;
  baseSepolia)
    FEEDER_CMD=(npx hardhat run scripts/feederDaemon.js --network baseSepolia)
    KEEPER_CMD=(npx hardhat run scripts/liquidationKeeper.js --network baseSepolia)
    ALERT_CMD=(npx hardhat run scripts/thresholdAlertKeeper.js --network baseSepolia)
  ;;
  *)
    echo "SPIN_NETWORK must be arbitrumSepolia or baseSepolia" >&2
    exit 1
  ;;
esac

start_bg feeder env FEEDER_SIGNER_INDEX=0 "${FEEDER_CMD[@]}"

if [[ -n "${FEEDER2_PRIVATE_KEY:-}" ]]; then
  start_bg feeder-2 env FEEDER_SIGNER_INDEX=1 "${FEEDER_CMD[@]}"
  echo "  Dual-feeder mode: 2 price daemons (quorum when minFeeders ≥ 2 on-chain)"
else
  echo "  Single feeder (add FEEDER2_PRIVATE_KEY to .env for quorum)"
fi

start_bg liquidation-keeper "${KEEPER_CMD[@]}"

if [[ -n "${PRIVATE_THRESHOLD_ALERTS:-}" ]]; then
  start_bg threshold-keeper "${ALERT_CMD[@]}"
else
  echo "→ threshold-keeper skipped (set PRIVATE_THRESHOLD_ALERTS in .env)"
fi

PORT="${PORT:-8765}"
export PORT
start_bg frontend env PORT="$PORT" npm run frontend

echo ""
echo "Dashboard: http://127.0.0.1:${PORT}/ (check frontend.log if port was bumped)"
echo "Stop:      npm run spin:stop"
echo "Tail logs: tail -f $LOG_DIR/*.log"

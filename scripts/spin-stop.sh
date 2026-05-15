#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
LOG_DIR="${SPIN_LOG_DIR:-./logs/spin}"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "No spin logs at $LOG_DIR"
  exit 0
fi

shopt -s nullglob
for pidfile in "$LOG_DIR"/*.pid; do
  [[ -f "$pidfile" ]] || continue
  name=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping $name (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
done
echo "Done."

#!/usr/bin/env bash
# Restart a long-running hardhat script until SIGTERM (used by spin.sh).
set -uo pipefail
NAME=$1
shift
cd "$(dirname "$0")/.."
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"

while true; do
  echo "[$(date -Is)] starting $NAME" >&2
  if "$@"; then
    echo "[$(date -Is)] $NAME exited 0 — restarting in 5s" >&2
  else
    echo "[$(date -Is)] $NAME exited $? — restarting in 10s" >&2
  fi
  sleep 10
done

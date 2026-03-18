#!/usr/bin/env bash
# Restart processes that must pick up code changes: relayer + Vite UI.
# Does not restart Hardhat, Yaci, Midnight, or proof-server (those are stable across TS/UI edits).
#
# Uses /tmp/zk-stables-anvil-addrs.json when present (same as start-local-stack.sh) so EVM pool
# addresses match the running Anvil deploy. If missing, relayer runs from zk-stables-relayer/.env only.
#
#   ./scripts/restart-local-dev-services.sh
#
# Env: ZK_STABLES_VITE_PORT (default 5173), zk-stables-relayer/.env → RELAYER_PORT
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
set -a
source "$ROOT/zk-stables-relayer/.env"
set +a
RELAYER_PORT_VAL="${RELAYER_PORT:-8787}"
VITE_PORT="${ZK_STABLES_VITE_PORT:-5173}"
ADDRS_JSON=/tmp/zk-stables-anvil-addrs.json
RELAYER_PID_FILE=/tmp/zk-stables-relayer.pid
RELAYER_LOG=/tmp/zk-stables-relayer.log
VITE_PID_FILE=/tmp/zk-stables-vite.pid
VITE_LOG=/tmp/zk-stables-vite.log

wait_port () {
  local port="$1" tries="${2:-40}"
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

echo "[stop] Relayer :${RELAYER_PORT_VAL}, UI :${VITE_PORT}"
if [[ -f "$RELAYER_PID_FILE" ]]; then
  kill "$(cat "$RELAYER_PID_FILE")" 2>/dev/null || true
fi
if [[ -f "$VITE_PID_FILE" ]]; then
  kill "$(cat "$VITE_PID_FILE")" 2>/dev/null || true
fi
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${RELAYER_PORT_VAL}/tcp" >/dev/null 2>&1 || true
  fuser -k "${VITE_PORT}/tcp" >/dev/null 2>&1 || true
fi
sleep 1

echo "[relayer] Starting on :${RELAYER_PORT_VAL} (log $RELAYER_LOG)…"
(
  cd "$ROOT"
  set -a
  source "$ROOT/zk-stables-relayer/.env"
  set +a
  if [[ -f "$ADDRS_JSON" ]] && jq -e . "$ADDRS_JSON" >/dev/null 2>&1; then
    export RELAYER_EVM_LOCK_ADDRESS="$(jq -r .poolLock "$ADDRS_JSON")"
    export RELAYER_EVM_POOL_LOCK="$(jq -r .poolLock "$ADDRS_JSON")"
    export RELAYER_EVM_WRAPPED_TOKEN="$(jq -r .wUSDC "$ADDRS_JSON")"
    export RELAYER_EVM_UNDERLYING_TOKEN="$(jq -r .usdc "$ADDRS_JSON")"
    export RELAYER_EVM_BRIDGE_MINT="$(jq -r .bridgeMint "$ADDRS_JSON")"
    echo "[relayer] EVM addresses from $ADDRS_JSON"
  else
    echo "[relayer] No valid $ADDRS_JSON — using zk-stables-relayer/.env only (run start-local-stack.sh once if Anvil addresses drift)"
  fi
  nohup npm start -w @zk-stables/relayer >>"$RELAYER_LOG" 2>&1 &
  echo $! >"$RELAYER_PID_FILE"
)
wait_port "${RELAYER_PORT_VAL}" 40 || { echo "[relayer] Timeout — see $RELAYER_LOG"; tail -40 "$RELAYER_LOG"; exit 1; }
echo "[relayer] Listening (pid $(cat "$RELAYER_PID_FILE"))"

echo "[ui] Starting Vite 0.0.0.0:${VITE_PORT} (log $VITE_LOG)…"
(
  cd "$ROOT"
  nohup npm run dev -w @zk-stables/ui -- --host 0.0.0.0 --port "${VITE_PORT}" >>"$VITE_LOG" 2>&1 &
  echo $! >"$VITE_PID_FILE"
)
wait_port "${VITE_PORT}" 60 || { echo "[ui] Timeout — see $VITE_LOG"; tail -40 "$VITE_LOG"; exit 1; }
echo "[ui] http://127.0.0.1:${VITE_PORT} (pid $(cat "$VITE_PID_FILE"))"

echo ""
echo "=== Restart complete ==="
echo "  Relayer: http://127.0.0.1:${RELAYER_PORT_VAL}/health"
echo "  UI:      http://127.0.0.1:${VITE_PORT}"

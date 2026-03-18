#!/usr/bin/env bash
# Start local demo: Hardhat node :8545, deploy EVM contracts, sync UI .env, relayer :8787, Vite :5173.
# Requires: Midnight node :9944, indexer :8088, proof-server :6301 (run scripts/start-alt-proof-server.sh if needed; :6300 ok if you point .env at it).
# Optional: Yaci :8080 for green Cardano pill in UI (otherwise relayer still runs; Cardano paths may error in logs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
set -a
source "$ROOT/zk-stables-relayer/.env"
set +a
RELAYER_PORT_VAL="${RELAYER_PORT:-8787}"

HH_PID_FILE=/tmp/zk-stables-hardhat-node.pid
HH_LOG=/tmp/zk-stables-hardhat-node.log
ADDRS_JSON=/tmp/zk-stables-anvil-addrs.json

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

if ss -tlnp 2>/dev/null | grep -q ':8545 '; then
  echo "[evm] Port 8545 already listening — skipping Hardhat node start."
else
  echo "[evm] Starting Hardhat node on 0.0.0.0:8545 (log: $HH_LOG)"
  cd "$ROOT/evm"
  nohup npx hardhat node --hostname 0.0.0.0 >>"$HH_LOG" 2>&1 &
  echo $! >"$HH_PID_FILE"
  cd "$ROOT"
  wait_port 8545 40 || { echo "[evm] Timeout waiting for 8545"; exit 1; }
  echo "[evm] Hardhat node ready."
fi

echo "[evm] Deploying contracts to 8545…"
cd "$ROOT/evm"
LOG=$(mktemp)
set +e
npx hardhat run scripts/deploy-anvil.js --network anvil 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e
sed -n '/^{/,/^}/p' "$LOG" >"$ADDRS_JSON"
rm -f "$LOG"
if [ "$RC" != 0 ] || ! jq -e . "$ADDRS_JSON" >/dev/null 2>&1; then
  echo "[evm] Deploy failed or JSON missing. Check evm/hardhat and $ADDRS_JSON"
  exit 1
fi
cd "$ROOT"
echo "[evm] Addresses → $ADDRS_JSON"

echo "[ui] Patching zk-stables-ui/.env.development token addresses from deploy…"
ROOT="$ROOT" ADDRS_JSON="$ADDRS_JSON" node <<'NODE'
const fs = require('fs');
const path = require('path');
const j = JSON.parse(fs.readFileSync(process.env.ADDRS_JSON, 'utf8'));
const envPath = path.join(process.env.ROOT, 'zk-stables-ui', '.env.development');
let s = fs.readFileSync(envPath, 'utf8');
const set = (key, val) => {
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=.*$', 'm');
  if (re.test(s)) s = s.replace(re, key + '=' + val);
  else s += '\n' + key + '=' + val + '\n';
};
set('VITE_DEMO_USDC_ADDRESS', j.usdc);
set('VITE_DEMO_USDT_ADDRESS', j.usdt);
set('VITE_DEMO_WUSDC_ADDRESS', j.wUSDC);
set('VITE_DEMO_WUSDT_ADDRESS', j.wUSDT);
fs.writeFileSync(envPath, s);
NODE

RELAYER_PID_FILE=/tmp/zk-stables-relayer.pid
RELAYER_LOG=/tmp/zk-stables-relayer.log
# Default: free the relayer port so a fresh deploy’s pool addresses are always loaded (set ZK_STABLES_RESTART_RELAYER=0 to skip).
if [ "${ZK_STABLES_RESTART_RELAYER:-1}" != "0" ]; then
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${RELAYER_PORT_VAL}/tcp" >/dev/null 2>&1 || true
    sleep 1
  fi
fi
echo "[relayer] Starting on :${RELAYER_PORT_VAL} (log $RELAYER_LOG)…"
(
  cd "$ROOT"
  set -a
  source "$ROOT/zk-stables-relayer/.env"
  set +a
  export RELAYER_EVM_LOCK_ADDRESS="$(jq -r .poolLock "$ADDRS_JSON")"
  export RELAYER_EVM_POOL_LOCK="$(jq -r .poolLock "$ADDRS_JSON")"
  export RELAYER_EVM_WRAPPED_TOKEN="$(jq -r .wUSDC "$ADDRS_JSON")"
  export RELAYER_EVM_UNDERLYING_TOKEN="$(jq -r .usdc "$ADDRS_JSON")"
  export RELAYER_EVM_UNDERLYING_TOKEN_USDT="$(jq -r .usdt "$ADDRS_JSON")"
  export RELAYER_EVM_BRIDGE_MINT="$(jq -r .bridgeMint "$ADDRS_JSON")"
  nohup npm start -w @zk-stables/relayer >>"$RELAYER_LOG" 2>&1 &
  echo $! >"$RELAYER_PID_FILE"
)
wait_port "${RELAYER_PORT_VAL}" 40 || { echo "[relayer] Timeout — see $RELAYER_LOG"; exit 1; }
echo "[relayer] Listening (pid $(cat "$RELAYER_PID_FILE"))"

if [ "${ZK_STABLES_SKIP_FUND:-0}" = "1" ]; then
  echo "[fund] Skipped (ZK_STABLES_SKIP_FUND=1). Run: npm run fund:local"
else
  echo "[fund] Cardano Yaci top-up + EVM zk seed (required for Cardano txs + demo redeem)…"
  FUND_LOG=/tmp/zk-stables-fund.log
  if (cd "$ROOT" && npm run fund:local) >>"$FUND_LOG" 2>&1; then
    echo "[fund] OK (log: $FUND_LOG)"
  else
    echo "[fund] FAILED — need Yaci Store + admin (RELAYER_YACI_URL / RELAYER_YACI_ADMIN_URL in zk-stables-relayer/.env). Log: $FUND_LOG"
    echo "[fund] Or re-run after ./scripts/start-yaci-devkit.sh, then: npm run fund:local"
    exit 1
  fi
fi

VITE_PID_FILE=/tmp/zk-stables-vite.pid
VITE_LOG=/tmp/zk-stables-vite.log
if ss -tlnp 2>/dev/null | grep -q ':5173 '; then
  echo "[ui] Port 5173 in use — open http://127.0.0.1:5173 (or stop the existing dev server)"
else
  echo "[ui] Starting Vite dev server 0.0.0.0:5173…"
  (
    cd "$ROOT"
    nohup npm run dev -w @zk-stables/ui -- --host 0.0.0.0 --port 5173 >>"$VITE_LOG" 2>&1 &
    echo $! >"$VITE_PID_FILE"
  )
  wait_port 5173 60 || { echo "[ui] Timeout — see $VITE_LOG"; exit 1; }
  echo "[ui] Open http://127.0.0.1:5173 (pid $(cat "$VITE_PID_FILE"), log $VITE_LOG)"
fi

echo ""
echo "=== ZK-Stables local stack ==="
echo "  UI:       http://127.0.0.1:5173"
echo "  Relayer:  http://127.0.0.1:${RELAYER_PORT_VAL}  (GET /health, chains: /v1/health/chains)"
echo "  EVM RPC:  http://127.0.0.1:8545"
echo "  Deploy:   $ADDRS_JSON"
echo ""
echo "Midnight (Docker): node :9944, indexer :8088, proof :6300"
echo "Cardano (optional): ./scripts/start-yaci-devkit.sh — Store :8080; then npm run fund:cardano-yaci (see docs/CARDANO_LOCAL_YACI.md)"
echo "Stop: kill \$(cat $VITE_PID_FILE) \$(cat $RELAYER_PID_FILE); [ -f $HH_PID_FILE ] && kill \$(cat $HH_PID_FILE) 2>/dev/null || true"

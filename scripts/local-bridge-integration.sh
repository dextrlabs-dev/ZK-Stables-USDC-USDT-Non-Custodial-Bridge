#!/usr/bin/env bash
# Local cross-chain bridge smoke: Anvil + Midnight indexer + Cardano (when Yaci URL set). SRS requires full stack — see docs/SRS_RELAYER_REQUIREMENTS.md.
# Produces a text report on stdout and writes BRIDGE_INTEGRATION_REPORT_PATH (default: /tmp/zk-stables-bridge-integration-report.txt).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="${BRIDGE_INTEGRATION_REPORT_PATH:-/tmp/zk-stables-bridge-integration-report.txt}"
# Anvil: with confirmations=1 the tip must exceed the log block before the event is scanned; use 0 for instant local scans.
export RELAYER_EVM_CONFIRMATIONS="${RELAYER_EVM_CONFIRMATIONS:-0}"
# Production relayer: copy zk-stables-relayer/.env.integration.example and set RELAYER_SRS_STRICT=true (all chains required).
# Cardano: set ENABLE_CARDANO_INTEGRATION=1 to print SRS Cardano env hints (requires Yaci or Blockfrost). See docs/CARDANO_LOCAL_YACI.md.
EVM_RPC="${RELAYER_EVM_RPC_URL:-http://127.0.0.1:8545}"
MID_IDX="${RELAYER_MIDNIGHT_INDEXER_URL:-http://127.0.0.1:8088/api/v4/graphql}"
RELAYER_PORT="${RELAYER_PORT:-8787}"
RELAYER_URL="http://127.0.0.1:${RELAYER_PORT}"
ENABLE_CARDANO_INTEGRATION="${ENABLE_CARDANO_INTEGRATION:-0}"

log() { echo "[bridge-integration] $*"; }

check_http() {
  local name="$1" url="$2"
  if curl -sf -o /dev/null --connect-timeout 2 "$url"; then
    echo "  $name: OK ($url)"
    return 0
  fi
  echo "  $name: unreachable ($url)"
  return 1
}

check_jsonrpc() {
  local name="$1" rpc="$2"
  local out
  if out=$(curl -sf -X POST "$rpc" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null); then
    echo "  $name: OK chainId $(echo "$out" | sed 's/.*"result":"//;s/".*//')"
    return 0
  fi
  echo "  $name: unreachable ($rpc)"
  return 1
}

midnight_reachable() {
  curl -sf --connect-timeout 2 -X POST "$MID_IDX" \
    -H 'content-type: application/json' \
    -d '{"query":"query{__typename}"}' >/dev/null 2>&1
}

{
  echo "ZK-Stables local bridge integration report"
  echo "Generated: $(date -Iseconds)"
  echo "Repo: $ROOT"
  echo ""

  echo "== 1. Chain endpoints =="
  check_jsonrpc "EVM (Anvil)" "$EVM_RPC" || true
  if midnight_reachable; then
    echo "  Midnight indexer GraphQL: OK ($MID_IDX)"
  else
    echo "  Midnight indexer GraphQL: unreachable ($MID_IDX) — start bricktowers/midnight-local-network compose"
  fi
  YACI="${RELAYER_YACI_URL:-${YACI_URL:-}}"
  if [[ -n "${YACI}" ]]; then
    check_http "Cardano Yaci Store" "${YACI%/}/blocks/latest" || check_http "Cardano Yaci (epoch)" "${YACI%/}/epoch/latest" || check_http "Cardano Yaci (base)" "$YACI" || true
  else
    echo "  Cardano Yaci: not configured (set RELAYER_YACI_URL for local Cardano)"
  fi
  echo ""

  echo "== 2. EVM deploy + lock event =="
  cd "$ROOT/evm"
  if ! check_jsonrpc "preflight" "$EVM_RPC" >/dev/null 2>&1; then
    echo "  SKIP: Anvil not running at $EVM_RPC — start: ./scripts/anvil-docker.sh (or anvil --host 0.0.0.0 --port 8545)"
  else
    ADDRS_JSON="${DEPLOY_ADDRS_JSON:-/tmp/zk-stables-anvil-addrs.json}"
    export EVM_RPC_URL="$EVM_RPC"
    npx hardhat run scripts/deploy-anvil.js --network anvil 2>/dev/null | awk '/^\{/{p=1}p' > "$ADDRS_JSON"
    log "wrote addresses to $ADDRS_JSON"
    DEPLOY_ADDRS_JSON="$ADDRS_JSON" npx hardhat run scripts/integration-emit-lock.js --network anvil > /tmp/zk-stables-lock-out.json 2>/dev/null || true
    if [[ -f /tmp/zk-stables-lock-out.json ]] && grep -q txHash /tmp/zk-stables-lock-out.json 2>/dev/null; then
      echo "  Lock tx:"
      cat /tmp/zk-stables-lock-out.json
      POOL=$(grep -o '"poolLock": *"[^"]*"' /tmp/zk-stables-lock-out.json 2>/dev/null | head -1 | sed 's/.*"0x/0x/;s/".*//' || true)
      if [[ -z "$POOL" ]]; then
        POOL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ADDRS_JSON','utf8')).poolLock)" 2>/dev/null || true)
      fi
      echo "  RELAYER_EVM_LOCK_ADDRESS=$POOL"
    else
      echo "  WARN: could not emit lock (see evm/scripts/integration-emit-lock.js)"
    fi
  fi
  echo ""

  echo "== 3. Relayer HTTP =="
  if curl -sf --connect-timeout 1 "$RELAYER_URL/health" >/dev/null 2>&1; then
    echo "  Relayer already up: $RELAYER_URL"
  else
    echo "  Relayer not listening on $RELAYER_URL — start manually with scripts/zk-stables-relayer-env.example.sh or:"
    echo "    cd zk-stables-relayer && RELAYER_MIDNIGHT_ENABLED=true ... npm start"
  fi
  curl -sf "$RELAYER_URL/v1/health/chains" 2>/dev/null | head -c 400 || echo "  (no relayer)"
  echo ""
  echo ""

  echo "== 4. Midnight relayer status =="
  if midnight_reachable; then
    echo "  Indexer reachable — deploy contract via relayer: RELAYER_MIDNIGHT_ENABLED=true RELAYER_MIDNIGHT_AUTO_DEPLOY=true BIP39_MNEMONIC=\"...\""
  else
    echo "  Midnight stack not running — RELAYER_MIDNIGHT_ENABLED jobs will fail until indexer/node/proof-server are up."
  fi
  echo ""

  echo "== 5. Next steps =="
  echo "  - Fund BIP39 wallet on local Midnight (see local-cli/README.md fund-and-register-dust)."
  echo "  - Export pool address: RELAYER_EVM_LOCK_ADDRESS from deploy JSON; restart relayer."
  echo "  - Cardano (SRS): RELAYER_CARDANO_WATCHER_ENABLED=true RELAYER_CARDANO_BRIDGE_ENABLED=true RELAYER_YACI_URL=... RELAYER_CARDANO_LOCK_ADDRESS=... — docs/CARDANO_LOCAL_YACI.md"
  echo ""

  if [[ "${ENABLE_CARDANO_INTEGRATION}" == "1" ]] || [[ -n "${RELAYER_YACI_URL:-}${YACI_URL:-}" ]]; then
    echo "== 6. Cardano integration (watcher + payout enabled) =="
    YACI="${RELAYER_YACI_URL:-${YACI_URL:-http://127.0.0.1:8080/api/v1}}"
    if curl -sf --connect-timeout 2 "${YACI%/}/epoch/latest" >/dev/null 2>&1; then
      echo "  Yaci Store reachable: ${YACI}"
    else
      echo "  Yaci Store not reachable at ${YACI} — start DevKit: https://devkit.yaci.xyz/getting-started/docker"
    fi
    echo "  Export then start relayer (after setting lock address + funded mnemonic):"
    echo "    export RELAYER_YACI_URL=${YACI}"
    echo "    export RELAYER_YACI_ADMIN_URL=\${RELAYER_YACI_ADMIN_URL:-http://127.0.0.1:10000}"
    echo "    export RELAYER_CARDANO_WATCHER_ENABLED=true RELAYER_CARDANO_BRIDGE_ENABLED=true"
    echo "    export RELAYER_CARDANO_CONFIRMATIONS=0"
    echo "    export RELAYER_CARDANO_LOCK_ADDRESS=<addr_test1... from lock script / cardano/ts>"
    echo "    export RELAYER_CARDANO_WALLET_MNEMONIC=\"<24 words — fund on devnet>\""
    echo "  Or: set -a; source scripts/relayer-cardano-srs.env.sh; set +a"
    echo ""
  fi

} | tee "$REPORT"

log "report written to $REPORT"

#!/usr/bin/env bash
# One-shot local Cardano checks: Yaci Store, fund demo wallet, cardano/ts smoke, relayer LOCK/BURN → Cardano.
# Prereqs: Yaci DevKit (./scripts/start-yaci-devkit.sh), relayer + Anvil stack (./scripts/start-local-stack.sh or restart-local-dev-services.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== 1) Yaci Store /blocks/latest =="
curl -sfS "http://127.0.0.1:8080/api/v1/blocks/latest" | head -c 120
echo "…"

# shellcheck disable=SC1091
set -a
source "$ROOT/zk-stables-relayer/.env"
set +a
RELAYER_PORT_VAL="${RELAYER_PORT:-8787}"

echo ""
echo "== 2) Relayer /health :${RELAYER_PORT_VAL} =="
curl -sfS "http://127.0.0.1:${RELAYER_PORT_VAL}/health" | head -c 200
echo "…"

echo ""
echo "== 3) Fund (Cardano Yaci top-up + EVM zk seed) =="
npm run fund:local

DEMO_ADDR="${RELAYER_DEMO_CARDANO_ADDRESS_SRC:-addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn}"

# Relayer first: it shares the same mnemonic as yaci-smoke; running smoke first can leave Mesh/Yaci coin
# selection stale (BadInputsUTxO) for the heavy mint+lock+release txs.
echo ""
echo "== 4) Relayer LOCK → Cardano (Aiken mint + lock + release) =="
LOCK_BODY=$(jq -nc \
  --arg r "$DEMO_ADDR" \
  '{operation:"LOCK",sourceChain:"evm",destinationChain:"cardano",asset:"USDC",assetKind:0,amount:"1",recipient:$r}')
JOB_JSON=$(curl -sfS -X POST "http://127.0.0.1:${RELAYER_PORT_VAL}/v1/intents/lock" \
  -H 'Content-Type: application/json' -d "$LOCK_BODY")
JID=$(echo "$JOB_JSON" | jq -r .jobId)
echo "jobId=$JID"
for i in $(seq 1 90); do
  S=$(curl -sfS "http://127.0.0.1:${RELAYER_PORT_VAL}/v1/jobs/$JID")
  ph=$(echo "$S" | jq -r .phase)
  if [ "$ph" = "completed" ] || [ "$ph" = "failed" ]; then
    echo "$S" | jq '{phase,error,destinationHint}'
    [ "$ph" = "completed" ] || exit 1
    break
  fi
  sleep 1
done

echo "… indexer settle …"
sleep 5

echo ""
echo "== 5) Relayer BURN → Cardano =="
BURN_BODY=$(jq -nc \
  --arg r "$DEMO_ADDR" \
  '{operation:"BURN",sourceChain:"evm",destinationChain:"cardano",asset:"USDT",assetKind:1,amount:"1",recipient:$r,burnCommitmentHex:"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}')
JOB_JSON=$(curl -sfS -X POST "http://127.0.0.1:${RELAYER_PORT_VAL}/v1/intents/burn" \
  -H 'Content-Type: application/json' -d "$BURN_BODY")
JID=$(echo "$JOB_JSON" | jq -r .jobId)
echo "jobId=$JID"
for i in $(seq 1 90); do
  S=$(curl -sfS "http://127.0.0.1:${RELAYER_PORT_VAL}/v1/jobs/$JID")
  ph=$(echo "$S" | jq -r .phase)
  if [ "$ph" = "completed" ] || [ "$ph" = "failed" ]; then
    echo "$S" | jq '{phase,error,destinationHint}'
    [ "$ph" = "completed" ] || exit 1
    break
  fi
  sleep 1
done

echo ""
echo "== 6) cardano/ts yaci-smoke (lock + refund + registry) =="
export CARDANO_WALLET_MNEMONIC="${RELAYER_CARDANO_WALLET_MNEMONIC:?set in zk-stables-relayer/.env}"
export YACI_URL="${RELAYER_YACI_URL:?}"
export YACI_ADMIN_URL="${RELAYER_YACI_ADMIN_URL:?}"
export CARDANO_NETWORK_ID="${RELAYER_CARDANO_NETWORK_ID:-0}"
export CARDANO_MESH_NETWORK="${RELAYER_CARDANO_MESH_NETWORK:-preview}"
( cd "$ROOT/cardano/ts" && npx tsx src/cli/yaci-smoke.ts )

echo ""
echo "=== All Cardano local checks passed ==="

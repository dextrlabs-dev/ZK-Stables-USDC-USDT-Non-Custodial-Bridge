#!/usr/bin/env bash
# Mint synthetic zk at lock_pool (hold), then POST BURN cardano→EVM so relayer runs BridgeRelease+burn + pool unlock.
# Requires: Yaci + relayer on RELAYER_PORT (default 8787), zk-stables-relayer/.env with Cardano + EVM pool + OPERATOR_BURN_RELEASE=true.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/zk-stables-relayer"

set -a
# shellcheck disable=SC1091
source "$ROOT/zk-stables-relayer/.env"
set +a

RELAYER_PORT_VAL="${RELAYER_PORT:-8787}"
RELAYER_URL="http://127.0.0.1:${RELAYER_PORT_VAL}"

for _ in $(seq 1 30); do
  if curl -sfS "$RELAYER_URL/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "== Mint hold UTxO at lock_pool =="
HOLD_JSON=$(npx tsx scripts/mint-hold-for-burn-test.ts | head -1)
echo "$HOLD_JSON" | jq .

COMMIT=$(echo "$HOLD_JSON" | jq -r .commitment)
TX=$(echo "$HOLD_JSON" | jq -r .lockTxHash)
IDX=$(echo "$HOLD_JSON" | jq -r .lockOutputIndex)
AMT=$(echo "$HOLD_JSON" | jq -r .amountStr)
ASSET=$(echo "$HOLD_JSON" | jq -r .asset)
KIND=$([ "$ASSET" = USDT ] && echo 1 || echo 0)

EVM_REC="${RELAYER_BRIDGE_EVM_RECIPIENT:?set RELAYER_BRIDGE_EVM_RECIPIENT}"

echo ""
echo "== POST BURN (cardano → EVM) =="
BURN_BODY=$(jq -nc \
  --arg bc "$COMMIT" \
  --arg th "$TX" \
  --argjson oi "$IDX" \
  --arg r "$EVM_REC" \
  --arg a "$AMT" \
  --argjson ak "$KIND" \
  --arg ast "$ASSET" \
  '{operation:"BURN",sourceChain:"cardano",destinationChain:"evm",asset:$ast,assetKind:$ak,amount:$a,recipient:$r,burnCommitmentHex:$bc,source:{cardano:{txHash:$th,outputIndex:$oi}}}')

JOB_JSON=$(curl -sfS -X POST "$RELAYER_URL/v1/intents/burn" \
  -H 'Content-Type: application/json' \
  -d "$BURN_BODY")
JID=$(echo "$JOB_JSON" | jq -r .jobId)
echo "jobId=$JID"

for i in $(seq 1 180); do
  S=$(curl -sfS "$RELAYER_URL/v1/jobs/$JID")
  ph=$(echo "$S" | jq -r .phase)
  if [ "$ph" = "completed" ] || [ "$ph" = "failed" ]; then
    echo "$S" | jq '{phase,error,destinationHint}'
    [ "$ph" = "completed" ] || exit 1
    echo "$S" | jq -r .destinationHint | grep -q 'BridgeRelease+burn' || {
      echo "ERROR: expected operator release to record BridgeRelease+burn (negative mint) in destinationHint" >&2
      exit 1
    }
    break
  fi
  sleep 1
done

echo ""
echo "=== Cardano operator burn + EVM claim test passed ==="

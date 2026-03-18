#!/usr/bin/env bash
# E2E checklist: EVM LOCK → Cardano hold → user BridgeRelease → BURN intent → relayer completion.
# Requires: Anvil + zk-stables-relayer + Yaci + Cardano bridge wallet + UI env (VITE_YACI_URL, etc.).
set -euo pipefail
echo "SRS Cardano redeem E2E (manual steps)"
echo "1. Relayer: RELAYER_CARDANO_DESTINATION_LOCK_HOLD=true RELAYER_CARDANO_OPERATOR_BURN_RELEASE=false (or omit)"
echo "2. Submit LOCK EVM→Cardano (or watcher) so relayer runs lockMintHoldAtScriptOnly"
echo "3. Note lock tx hash + output index from job destinationHint"
echo "4. UI: connect CIP-30 wallet matching lock datum recipient; Cardano redeem → Sign BridgeRelease"
echo "5. UI: Review → Confirm BURN with filled commitment + spend tx id"
echo "6. Expect job completed; EVM unlock runs when destination is EVM and pool env is set"
echo "See docs/BURN_ANCHOR_SPEC.md and docs/SRS_RELAYER_REQUIREMENTS.md (Redeem parity)."

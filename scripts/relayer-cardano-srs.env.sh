#!/usr/bin/env bash
# Source after Yaci Store (or Blockfrost) is reachable so the relayer can watch locks and submit payouts.
# Usage:  set -a; source scripts/relayer-cardano-srs.env.sh; set +a
# Required exports before sourcing (or uncomment and edit below):
#   RELAYER_CARDANO_LOCK_ADDRESS=addr_test1...
#   RELAYER_CARDANO_WALLET_MNEMONIC="word1 ... word24"
#
# Yaci DevKit: https://devkit.yaci.xyz/getting-started/docker — default Store URL below.
# Blockfrost: set RELAYER_BLOCKFROST_PROJECT_ID and leave RELAYER_YACI_URL unset.
#
# See docs/CARDANO_LOCAL_YACI.md and docs/SRS_RELAYER_REQUIREMENTS.md.

export RELAYER_YACI_URL="${RELAYER_YACI_URL:-http://127.0.0.1:8080/api/v1}"
export RELAYER_YACI_ADMIN_URL="${RELAYER_YACI_ADMIN_URL:-http://127.0.0.1:10000}"

export RELAYER_CARDANO_WATCHER_ENABLED="${RELAYER_CARDANO_WATCHER_ENABLED:-true}"
export RELAYER_CARDANO_BRIDGE_ENABLED="${RELAYER_CARDANO_BRIDGE_ENABLED:-true}"

export RELAYER_CARDANO_CONFIRMATIONS="${RELAYER_CARDANO_CONFIRMATIONS:-0}"
export RELAYER_CARDANO_POLL_MS="${RELAYER_CARDANO_POLL_MS:-4000}"

export RELAYER_CARDANO_NETWORK_ID="${RELAYER_CARDANO_NETWORK_ID:-0}"
export RELAYER_CARDANO_MESH_NETWORK="${RELAYER_CARDANO_MESH_NETWORK:-preview}"

export RELAYER_CARDANO_DEST_CHAIN="${RELAYER_CARDANO_DEST_CHAIN:-midnight}"

export RELAYER_CARDANO_PAYOUT_LOVELACE="${RELAYER_CARDANO_PAYOUT_LOVELACE:-3000000}"

#!/usr/bin/env bash
# Wipe local Yaci DevKit chain data (all UTxOs, native assets, indexer DB) and recreate devnet.
# Requires Docker + Yaci DevKit at YACI_DEVKIT_ROOT (default ~/.yaci-devkit).
#
#   ./scripts/local-wipe-yaci-chain.sh
#
# After this, run from repo root:
#   npm run fund:cardano-yaci
#   npm run sync-cardano-units -w @zk-stables/ui   # if policy / mnemonic changed; optional if unchanged
set -euo pipefail

ROOT="${YACI_DEVKIT_ROOT:-$HOME/.yaci-devkit}"
COMPOSE_DIR="$ROOT/scripts"
ENV_FILE="$ROOT/config/env"
VER_FILE="$ROOT/config/version"

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "Yaci DevKit not found at $ROOT (set YACI_DEVKIT_ROOT)"
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "Need docker compose"
  exit 1
fi

echo "[yaci] Stopping DevKit and removing volumes (DESTRUCTIVE)…"
cd "$COMPOSE_DIR"
"${DC[@]}" --env-file "$ENV_FILE" --env-file "$VER_FILE" down -v

echo "[yaci] Starting containers…"
"${DC[@]}" --env-file "$ENV_FILE" --env-file "$VER_FILE" up -d

PORT=8080
if [[ -f "$ENV_FILE" ]] && grep -qE '^HOST_STORE_API_PORT=' "$ENV_FILE"; then
  PORT="$(grep -E '^HOST_STORE_API_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2)"
fi

probe() {
  curl -sfS "http://127.0.0.1:${PORT}/api/v1/blocks/latest" >/dev/null
}

echo "[yaci] Waiting for Store on :${PORT}…"
for _ in $(seq 1 30); do
  sleep 2
  probe && break
done

if ! probe; then
  echo "[yaci] create-node (non-interactive, up to 8 min)…"
  timeout 480 "${DC[@]}" --env-file "$ENV_FILE" --env-file "$VER_FILE" exec -T yaci-cli /app/yaci-cli.sh create-node -o --start || true
  sleep 3
fi

if probe; then
  echo "[yaci] Store OK: http://127.0.0.1:${PORT}/api/v1/"
else
  echo "[yaci] Store not ready — check: cd $COMPOSE_DIR && docker compose logs --tail=80 yaci-cli"
  exit 1
fi

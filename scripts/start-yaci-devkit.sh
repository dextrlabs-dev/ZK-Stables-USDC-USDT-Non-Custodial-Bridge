#!/usr/bin/env bash
# Start Yaci DevKit (Docker): Yaci Store Blockfrost API on HOST_STORE_API_PORT (default 8080).
# Install once: curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash
#
# Port note: default Yaci Viewer uses 5173 — same as the bridge Vite app. Set
# HOST_VIEWER_PORT=5280 (or similar) in ~/.yaci-devkit/config/env before first start.
#
# Stop: cd ~/.yaci-devkit/scripts && docker compose --env-file ../config/env --env-file ../config/version down
set -euo pipefail
ROOT="${YACI_DEVKIT_ROOT:-$HOME/.yaci-devkit}"
COMPOSE_DIR="$ROOT/scripts"
ENV_FILE="$ROOT/config/env"
VER_FILE="$ROOT/config/version"

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "Yaci DevKit not found at $ROOT"
  echo "Install: curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash"
  exit 1
fi

PORT=8080
if [[ -f "$ENV_FILE" ]] && grep -qE '^HOST_STORE_API_PORT=' "$ENV_FILE"; then
  PORT="$(grep -E '^HOST_STORE_API_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2)"
fi

cd "$COMPOSE_DIR"
# Prefer Docker Compose V2 (`docker compose`); legacy `docker-compose` may not accept the same flags.
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "Need Docker Compose (docker compose or docker-compose)"
  exit 1
fi

"${DC[@]}" --env-file "$ENV_FILE" --env-file "$VER_FILE" up -d

probe() {
  curl -sfS "http://127.0.0.1:${PORT}/api/v1/blocks/latest" >/dev/null
}

if probe; then
  echo "Yaci Store already up: http://127.0.0.1:${PORT}/api/v1/"
  exit 0
fi

echo "Waiting for containers (first run may need create-node)…"
for _ in $(seq 1 30); do
  sleep 2
  probe && { echo "Yaci Store up: http://127.0.0.1:${PORT}/api/v1/"; exit 0; }
done

echo "Creating devnet (non-interactive; capped at 8 minutes)…"
# CLI sometimes keeps waiting after Store is ready; timeout avoids a stuck shell.
if timeout 480 "${DC[@]}" --env-file "$ENV_FILE" --env-file "$VER_FILE" exec -T yaci-cli /app/yaci-cli.sh create-node -o --start; then
  :
else
  echo "(create-node finished or timed out — checking Store…)"
fi

sleep 3
if probe; then
  echo "Yaci Store OK: http://127.0.0.1:${PORT}/api/v1/"
  exit 0
fi

echo "Store not reachable yet. Logs: cd $COMPOSE_DIR && docker compose logs --tail=80 yaci-cli"
exit 1

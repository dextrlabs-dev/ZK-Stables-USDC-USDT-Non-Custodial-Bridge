#!/usr/bin/env bash
# Foundry Anvil — local EVM for zk-stables-ui (wagmi Localhost 31337) + relayer health.
# Uses Docker host networking on Linux so Anvil is reachable at http://127.0.0.1:8545.
# If `anvil` is on PATH (native Foundry), runs that instead.

set -euo pipefail
IMAGE="${FOUNDRY_IMAGE:-ghcr.io/foundry-rs/foundry:latest}"
NAME="${ANVIL_CONTAINER_NAME:-zk-stables-anvil}"

if command -v anvil >/dev/null 2>&1; then
  echo "Using native Foundry anvil on 0.0.0.0:8545"
  exec anvil --host 0.0.0.0 --port 8545
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Install Foundry (https://getfoundry.sh) or Docker, then re-run." >&2
  exit 1
fi

docker rm -f "$NAME" 2>/dev/null || true
echo "Starting Anvil in Docker: $IMAGE (container $NAME, host network)"
docker run -d --name "$NAME" --network host "$IMAGE" anvil --host 127.0.0.1 --port 8545
sleep 2
curl -s -S -X POST http://127.0.0.1:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | head -c 200
echo
echo "Anvil RPC: http://127.0.0.1:8545 (chainId 0x7a69 = 31337). Stop: scripts/anvil-stop.sh"

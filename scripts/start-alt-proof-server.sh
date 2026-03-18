#!/usr/bin/env bash
# Start a second Midnight proof-server on the host without touching the default :6300 instance.
# Same image as midnight-local-network (ledger 8.0.3). Container listens on 6300 internally.
set -euo pipefail
NAME="${MIDNIGHT_ALT_PROOF_CONTAINER_NAME:-midnight-proof-server-zk-stables}"
IMAGE="${MIDNIGHT_PROOF_SERVER_IMAGE:-midnightntwrk/proof-server:8.0.3}"
HOST_PORT="${1:-6301}"

if docker ps -q --filter "name=^${NAME}$" | grep -q .; then
  echo "Already running: ${NAME} (use: docker ps --filter name=${NAME})"
  exit 0
fi

if docker ps -aq --filter "name=^${NAME}$" | grep -q .; then
  docker start "${NAME}"
  echo "Started existing container ${NAME} → http://127.0.0.1:${HOST_PORT}"
  exit 0
fi

docker run -d --name "${NAME}" -p "${HOST_PORT}:6300" "${IMAGE}"
echo "Started ${NAME}: http://127.0.0.1:${HOST_PORT} → container :6300 (${IMAGE})"
echo "Point ZK-Stables at it, e.g.:"
echo "  export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:${HOST_PORT}"
echo "  export RELAYER_MIDNIGHT_PROOF_SERVER=http://127.0.0.1:${HOST_PORT}"
echo "  # optional: export PROOF_SERVER_PORT=${HOST_PORT}  # if not using full URLs"
echo "Vite UI: set VITE_MIDNIGHT_PROOF_SERVER_PORT=${HOST_PORT} in zk-stables-ui/.env.development"

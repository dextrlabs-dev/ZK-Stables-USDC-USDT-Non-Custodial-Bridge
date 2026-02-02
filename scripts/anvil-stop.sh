#!/usr/bin/env bash
set -euo pipefail
NAME="${ANVIL_CONTAINER_NAME:-zk-stables-anvil}"
docker rm -f "$NAME" 2>/dev/null && echo "Stopped $NAME" || echo "No container $NAME"

#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: smoke-test.sh IMAGE [PLATFORM ...]}
shift
if [ "$#" -eq 0 ]; then
  set -- linux/amd64 linux/arm64
fi

container=''
cleanup() {
  if [ -n "$container" ]; then
    docker logs "$container" || true
    docker rm -f "$container" >/dev/null || true
  fi
}
trap cleanup EXIT

for platform in "$@"; do
  container="entrytwo-updater-smoke-${platform##*/}-$$"
  docker run --detach --platform "$platform" --name "$container" "$image" >/dev/null
  ready=false
  for attempt in {1..30}; do
    if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != true ]; then
      break
    fi
    if docker exec "$container" node -e '
      fetch("http://127.0.0.1:4000/health")
        .then(async response => {
          if (!response.ok || (await response.json()).status !== "ok") process.exit(1)
        })
        .catch(() => process.exit(1))
    '; then
      ready=true
      break
    fi
    sleep 1
  done
  if [ "$ready" != true ]; then
    echo "Updater failed to start with its default entrypoint on $platform" >&2
    exit 1
  fi
  docker exec "$container" docker compose version
  docker exec "$container" cosign version
  echo "Updater image smoke test passed: $platform"
  cleanup
  container=''
done

#!/usr/bin/env bash
# Builds docker/Dockerfile.edge-runtime from supabase/functions. Content-reproducible only
# (the config embeds a timestamp): compare function trees, never digests.
# Usage: [--push] [--platform <list>] [--tag <tag>]; tag defaults to the 8-char commit SHA.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

IMAGE="${IMAGE:-ghcr.io/thetimmyman/tacticus-analytics-edge-runtime}"
PLATFORMS="linux/amd64,linux/arm64"
PUSH=false
TAG="$(git rev-parse --short=8 HEAD)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=true
      shift
      ;;
    --platform)
      PLATFORMS="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    *)
      echo "::error::Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! printf '%s' "$TAG" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'; then
  echo "::error::Invalid image tag: $TAG" >&2
  exit 1
fi

args=(
  buildx build
  --file docker/Dockerfile.edge-runtime
  --platform "$PLATFORMS"
  --tag "$IMAGE:$TAG"
)

if [[ "$PUSH" == "true" ]]; then
  args+=(--push)
else
  # buildx cannot --load a multi-platform build.
  if [[ "$PLATFORMS" == *,* ]]; then
    echo "::error::--platform must be a single platform when not pushing (buildx --load doesn't support multi-platform)." >&2
    exit 1
  fi
  args+=(--load)
fi

args+=(.)

echo "Building $IMAGE:$TAG for $PLATFORMS (push=$PUSH)"
docker "${args[@]}"
echo "IMAGE_REF=$IMAGE:$TAG"

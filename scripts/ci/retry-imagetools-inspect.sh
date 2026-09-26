#!/usr/bin/env bash
# `docker buildx imagetools inspect` with bounded retry: GHCR may briefly 404 a
# just-created manifest. Callers still assert on the output.
# Usage: retry-imagetools-inspect.sh <image:tag> [args...] (RETRY_ATTEMPTS=6, RETRY_SLEEP_SECONDS=5)
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <image:tag> [extra docker buildx imagetools inspect args...]" >&2
  exit 2
fi

ref="$1"
shift

attempts="${RETRY_ATTEMPTS:-6}"
sleep_seconds="${RETRY_SLEEP_SECONDS:-5}"

attempt=1
output=""
while true; do
  if output="$(docker buildx imagetools inspect "$ref" "$@" 2>&1)"; then
    printf '%s\n' "$output"
    exit 0
  fi
  if (( attempt >= attempts )); then
    printf '%s\n' "$output" >&2
    echo "::error::docker buildx imagetools inspect failed for $ref after $attempts attempts" >&2
    exit 1
  fi
  echo "imagetools inspect attempt $attempt/$attempts failed for $ref; retrying in ${sleep_seconds}s..." >&2
  sleep "$sleep_seconds"
  attempt=$((attempt + 1))
done

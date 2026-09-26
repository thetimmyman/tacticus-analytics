#!/usr/bin/env bash
# Build receipt for the edge-runtime image: git's tree for supabase/functions and
# blob for docker/Dockerfile.edge-runtime, since digests are not reproducible.
# Usage: scripts/edge-runtime-receipt.sh [<commit>] (default HEAD); prints JSON.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

COMMIT_REF="${1:-HEAD}"
COMMIT="$(git rev-parse "$COMMIT_REF")"
FUNCTIONS_TREE="$(git rev-parse "${COMMIT}:supabase/functions")"
DOCKERFILE_BLOB="$(git rev-parse "${COMMIT}:docker/Dockerfile.edge-runtime")"

printf '{\n  "commit": "%s",\n  "functions_tree": "%s",\n  "dockerfile_blob": "%s"\n}\n' \
  "$COMMIT" "$FUNCTIONS_TREE" "$DOCKERFILE_BLOB"

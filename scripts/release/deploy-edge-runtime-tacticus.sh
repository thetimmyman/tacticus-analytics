#!/usr/bin/env bash
# Image-only edge-runtime deploy for `tacticus` (run by the reconciler): verifies the pin's
# ancestry and receipt, then prints or (--apply) runs `kubectl set image`.
# Usage: scripts/release/deploy-edge-runtime-tacticus.sh [--apply]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

PIN_FILE="deploy/tacticus.pin.json"
NAMESPACE="tacticus"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-supabase-edge-functions}"  # see deploy/tacticus/
CONTAINER_NAME="${CONTAINER_NAME:-edge-runtime}"

if [[ ! -f "$PIN_FILE" ]]; then
  echo "::error::$PIN_FILE not found" >&2
  exit 1
fi

IMAGE="$(jq -r '.image' "$PIN_FILE")"
TAG="$(jq -r '.tag' "$PIN_FILE")"
DIGEST="$(jq -r '.digest' "$PIN_FILE")"
COMMIT="$(jq -r '.commit' "$PIN_FILE")"
PIN_FUNCTIONS_TREE="$(jq -r '.functions_tree' "$PIN_FILE")"
PIN_DOCKERFILE_BLOB="$(jq -r '.dockerfile_blob' "$PIN_FILE")"

if [[ "$DIGEST" == "null" || -z "$DIGEST" ]]; then
  echo "::error::$PIN_FILE has no digest yet — no CI build has stamped it. Nothing to deploy." >&2
  exit 1
fi

echo "Pin: $IMAGE:$TAG@$DIGEST (commit $COMMIT)"

git fetch origin main --quiet
if ! git merge-base --is-ancestor "$COMMIT" origin/main; then
  echo "::error::Pinned commit $COMMIT is not an ancestor of origin/main. Refusing to deploy a pin this repo cannot vouch for." >&2
  exit 1
fi
echo "OK: $COMMIT is an ancestor of origin/main."

RECEIPT="$(scripts/edge-runtime-receipt.sh "$COMMIT")"
RECEIPT_FUNCTIONS_TREE="$(echo "$RECEIPT" | jq -r '.functions_tree')"
RECEIPT_DOCKERFILE_BLOB="$(echo "$RECEIPT" | jq -r '.dockerfile_blob')"

if [[ "$RECEIPT_FUNCTIONS_TREE" != "$PIN_FUNCTIONS_TREE" || "$RECEIPT_DOCKERFILE_BLOB" != "$PIN_DOCKERFILE_BLOB" ]]; then
  echo "::error::Receipt mismatch for $COMMIT — pin does not match this repo's tree at that commit." >&2
  echo "  pin functions_tree=$PIN_FUNCTIONS_TREE receipt functions_tree=$RECEIPT_FUNCTIONS_TREE" >&2
  echo "  pin dockerfile_blob=$PIN_DOCKERFILE_BLOB receipt dockerfile_blob=$RECEIPT_DOCKERFILE_BLOB" >&2
  exit 1
fi
echo "OK: receipt matches pin (content check, not digest — see scripts/edge-runtime-receipt.sh)."

# Keep the tag with the digest: the ancestry gate resolves the live image's tag
# prefix, and a bare `image@sha256:` gives it nothing to resolve.
CMD=(kubectl -n "$NAMESPACE" set image "deployment/${DEPLOYMENT_NAME}" "${CONTAINER_NAME}=${IMAGE}:${TAG}@${DIGEST}")

if [[ "$APPLY" != "true" ]]; then
  echo "Dry run (pass --apply to run this):"
  printf '  %q' "${CMD[@]}"
  echo
  exit 0
fi

echo "Applying:"
printf '  %q' "${CMD[@]}"
echo
"${CMD[@]}"

#!/usr/bin/env bash
# Render the `tacticus` edge-runtime manifests to stdout with the image from
# deploy/tacticus.pin.json replacing the tracked (deliberately invalid) placeholder.
# Usage: scripts/release/render-edge-manifests.sh [--selftest]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PIN_FILE="deploy/tacticus.pin.json"
MANIFEST_DIR="deploy/tacticus"
PLACEHOLDER='PIN_PLACEHOLDER_RENDER_FROM_deploy/tacticus.pin.json'

pin_field() {
  node -e '
    const pin = require("node:fs").readFileSync(process.argv[1], "utf8");
    const v = JSON.parse(pin)[process.argv[2]];
    process.stdout.write(v == null ? "null" : String(v));
  ' "$PIN_FILE" "$1"
}

render() {
  local image tag digest ref
  # node, not jq: node is guaranteed wherever the npm scripts run.
  image="$(pin_field image)"
  tag="$(pin_field tag)"
  digest="$(pin_field digest)"

  for f in image tag digest; do
    if [[ "${!f}" == "null" || -z "${!f}" ]]; then
      echo "::error::$PIN_FILE has no '$f' — no CI build has stamped it. Nothing to render." >&2
      return 1
    fi
  done

  # Tag and digest: the ancestry gate needs the tag prefix.
  ref="${image}:${tag}@${digest}"

  local first=true
  for f in "$MANIFEST_DIR"/edge-runtime.service.yaml "$MANIFEST_DIR"/edge-runtime.deployment.yaml; do
    if [[ "$first" == true ]]; then first=false; else echo "---"; fi
    # The placeholder contains '/', so use a delimiter no image reference contains.
    awk -v ph="$PLACEHOLDER" -v ref="$ref" \
      '{ i = index($0, ph); if (i > 0) { $0 = substr($0, 1, i-1) ref substr($0, i+length(ph)) } print }' "$f"
  done
}

selftest() {
  local out rc=0
  out="$(render)"

  if grep -qF "$PLACEHOLDER" <<<"$out"; then
    echo "SELFTEST FAIL: placeholder survived rendering" >&2
    rc=1
  else
    echo "selftest: placeholder is gone from rendered output — OK"
  fi

  local expected
  expected="$(pin_field image):$(pin_field tag)@$(pin_field digest)"
  if grep -qF "image: $expected" <<<"$out"; then
    echo "selftest: rendered image matches the pin exactly — OK"
  else
    echo "SELFTEST FAIL: rendered output does not contain 'image: $expected'" >&2
    rc=1
  fi

  # Negative control: the tracked manifest must still hold the placeholder.
  if grep -qF "$PLACEHOLDER" "$MANIFEST_DIR/edge-runtime.deployment.yaml"; then
    echo "selftest: tracked manifest still carries the placeholder — OK"
  else
    echo "SELFTEST FAIL: $MANIFEST_DIR/edge-runtime.deployment.yaml no longer carries the placeholder; the image pin has been duplicated and will diverge" >&2
    rc=1
  fi

  if grep -qE '^\s*image:\s*ghcr\.io/' "$MANIFEST_DIR"/*.yaml; then
    echo "SELFTEST FAIL: a literal ghcr.io image ref is hardcoded in $MANIFEST_DIR — the pin is no longer single-source" >&2
    rc=1
  else
    echo "selftest: no literal image ref hardcoded in tracked manifests — OK"
  fi

  return "$rc"
}

if [[ "${1:-}" == "--selftest" ]]; then
  selftest
else
  render
fi

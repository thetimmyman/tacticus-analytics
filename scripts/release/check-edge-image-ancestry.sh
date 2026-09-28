#!/usr/bin/env bash
# Ancestry gate for the live edge-runtime image (offline): the repository is the pinned edge image, the tag
# is a commit prefix that resolves here, and that commit is an ancestor of origin/main. A tag is mutable, so
# it does not prove the deployed bytes; the receipt check does. Run both. Fetches only with `--fetch`.
# Usage: scripts/release/check-edge-image-ancestry.sh <repo>:<sha-prefix>[@sha256:<digest>] [--fetch] | --selftest
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PIN_FILE="deploy/tacticus.pin.json"

pin_field() {
  node -e '
    const pin = require("node:fs").readFileSync(process.argv[1], "utf8");
    const v = JSON.parse(pin)[process.argv[2]];
    process.stdout.write(v == null ? "" : String(v));
  ' "$PIN_FILE" "$1"
}

fail() {
  echo "::error::$*" >&2
  return 1
}

# Split "<repo>:<tag>[@<digest>]"; a last ':' segment containing '/' is a registry port, not a tag.
check_image() {
  local ref="$1"
  local expected_image repo tag resolved

  expected_image="$(pin_field image)"
  if [[ -z "$expected_image" ]]; then
    fail "$PIN_FILE has no 'image' field — cannot tell which repository is ours."
    return 1
  fi

  if [[ -z "$ref" ]]; then
    fail "no image reference given. Usage: $0 <image-ref>"
    return 1
  fi

  local without_digest="${ref%%@*}"

  if [[ "$without_digest" != *:* || "${without_digest##*:}" == */* ]]; then
    fail "image string '$ref' has no tag — a bare digest reference gives this gate nothing to resolve. Re-deploy with the tag alongside the digest."
    return 1
  fi

  repo="${without_digest%:*}"
  tag="${without_digest##*:}"

  if [[ "$repo" != "$expected_image" ]]; then
    fail "image repository '$repo' is not this repo's edge image ('$expected_image' per $PIN_FILE). This repo cannot vouch for a tag it did not mint."
    return 1
  fi

  if ! resolved="$(git rev-parse --verify --quiet "${tag}^{commit}")"; then
    fail "tag '$tag' does not resolve to a commit in this repository. It is not a commit prefix this repo owns."
    return 1
  fi

  if ! git rev-parse --verify --quiet origin/main >/dev/null; then
    fail "origin/main is not present locally. Fetch it (or pass --fetch) before running this gate."
    return 1
  fi

  if ! git merge-base --is-ancestor "$resolved" origin/main; then
    fail "commit $resolved (tag '$tag') is NOT an ancestor of origin/main. The live image was built from code this repo has not merged."
    return 1
  fi

  echo "OK: $repo:$tag -> $resolved is an ancestor of origin/main."
  echo "NOTE: ancestry is a claim about the TAG, not about the deployed bytes."
  echo "      The content proof is the receipt — scripts/edge-runtime-receipt.sh"
  echo "      verified against $PIN_FILE by deploy-edge-runtime-tacticus.sh."
  return 0
}

selftest() {
  local rc=0 image out
  image="$(pin_field image)"

  expect_pass() {
    local label="$1" ref="$2"
    if out="$(check_image "$ref" 2>&1)"; then
      echo "selftest: $label — OK (passed as expected)"
    else
      echo "SELFTEST FAIL: $label — expected PASS, got:" >&2
      echo "$out" >&2
      rc=1
    fi
  }

  expect_fail() {
    local label="$1" ref="$2"
    if out="$(check_image "$ref" 2>&1)"; then
      echo "SELFTEST FAIL: $label — expected FAIL, but it passed:" >&2
      echo "$out" >&2
      rc=1
    else
      echo "selftest: $label — OK (refused as expected): ${out##*::error::}"
    fi
  }

  # Positive controls use origin/main's tip, which is present even in shallow clones.
  local main_sha main_short
  main_sha="$(git rev-parse origin/main)"
  main_short="${main_sha:0:8}"

  expect_pass "ancestor tag (origin/main tip, full sha)" "${image}:${main_sha}"

  expect_pass "ancestor tag with digest suffix" \
    "${image}:${main_short}@sha256:0000000000000000000000000000000000000000000000000000000000000000"

  # Conditional control: a known historical tag; skipped in a shallow clone.
  if git rev-parse --is-shallow-repository | grep -qx false \
    && git cat-file -e 'd35450ed^{commit}' 2>/dev/null; then
    expect_pass "ancestor tag d35450ed (deployed build commit)" "${image}:d35450ed"
  else
    echo "selftest: d35450ed control SKIPPED (commit not in clone)"
  fi

  expect_fail "tag b97d7054 that is not a commit here" "${image}:b97d7054"

  expect_fail "wrong repository name" \
    "ghcr.io/thetimmyman/some-other-edge-runtime:d35450ed"

  # Negative control: a parentless throwaway commit is not an ancestor of main.
  local empty_tree throwaway
  empty_tree="$(git hash-object -t tree /dev/null)"
  throwaway="$(GIT_AUTHOR_NAME=selftest GIT_AUTHOR_EMAIL=selftest@invalid \
    GIT_COMMITTER_NAME=selftest GIT_COMMITTER_EMAIL=selftest@invalid \
    git commit-tree "$empty_tree" -m 'edge ancestry selftest throwaway (never merged)')"
  expect_fail "non-ancestor commit from a throwaway branch" "${image}:${throwaway}"

  expect_fail "bare digest reference (no tag)" \
    "${image}@sha256:0000000000000000000000000000000000000000000000000000000000000000"

  return "$rc"
}

case "${1:-}" in
  --selftest)
    selftest
    ;;
  '' | --help | -h)
    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//;$d'
    exit 1
    ;;
  *)
    if [[ "${2:-}" == "--fetch" ]]; then
      git fetch origin main --quiet
    fi
    check_image "$1"
    ;;
esac

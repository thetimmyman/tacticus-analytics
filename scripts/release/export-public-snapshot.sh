#!/usr/bin/env bash
# Export HEAD minus config/public-snapshot-exclude.txt into an empty directory; never
# publishes. Run the gates in the exported tree before publishing.
# Usage: scripts/release/export-public-snapshot.sh <empty-output-dir>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${ROOT}/config/public-snapshot-exclude.txt"
OUT="${1:?usage: $0 <empty-output-dir>}"

[ -f "$MANIFEST" ] || { echo "export-public-snapshot: missing $MANIFEST" >&2; exit 1; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
[ -z "$(ls -A "$OUT")" ] || { echo "export-public-snapshot: $OUT is not empty" >&2; exit 1; }

pathspecs=(.)
keep=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed -e 's/[[:space:]]*$//')"
  [ -n "$line" ] || continue
  if [[ "$line" == '!'* ]]; then
    keep+=("${line#!}")
  else
    pathspecs+=(":(exclude,glob)${line}")
  fi
done <"$MANIFEST"

cd "$ROOT"
# A throwaway index, so staged changes cannot alter the snapshot.
HEAD_INDEX_DIR="$(mktemp -d)"
trap 'rm -rf "$HEAD_INDEX_DIR"' EXIT
HEAD_INDEX="${HEAD_INDEX_DIR}/index"
GIT_INDEX_FILE="$HEAD_INDEX" git read-tree HEAD
head_ls() { GIT_INDEX_FILE="$HEAD_INDEX" git ls-files "$@"; }
mapfile -d '' files < <(head_ls -z -- "${pathspecs[@]}")
for k in "${keep[@]:-}"; do
  [ -n "$k" ] && head_ls --error-unmatch -- "$k" >/dev/null 2>&1 && files+=("$k")
done
mapfile -d '' files < <(printf '%s\0' "${files[@]}" | sort -zu)

# Committed blobs, not the working tree, so local edits never leak.
git archive --format=tar HEAD -- "${files[@]}" | tar -x -C "$OUT"

total="$(head_ls | wc -l | tr -d ' ')"
echo "export-public-snapshot: HEAD $(git rev-parse --short HEAD) -> ${OUT}"
echo "export-public-snapshot: kept ${#files[@]} of ${total} tracked files"

echo "export-public-snapshot: remaining mentions of excluded paths (informational):"
dropped="$(comm -23 <(head_ls | sort) <(printf '%s\n' "${files[@]}" | sort))"
grep -rlF --exclude-dir=node_modules -f <(printf '%s\n' "$dropped") "$OUT" 2>/dev/null |
  sed "s#^${OUT}/#  #" | sort || true

#!/usr/bin/env bash
# Stubs `docker` to test retry-imagetools-inspect.sh: N failures then success exits 0; constant
# failure exits non-zero after exactly RETRY_ATTEMPTS attempts.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../retry-imagetools-inspect.sh"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

fail=0

# Stub docker: fails FAKE_DOCKER_FAIL_COUNT times, then succeeds; counts calls.
fake_bin_dir="$work_dir/bin"
mkdir -p "$fake_bin_dir"
cat > "$fake_bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
count_file="${FAKE_DOCKER_COUNTER:?FAKE_DOCKER_COUNTER must be set}"
count="$(cat "$count_file" 2>/dev/null || echo 0)"
count=$((count + 1))
printf '%s' "$count" > "$count_file"
if (( count <= "${FAKE_DOCKER_FAIL_COUNT:-0}" )); then
  echo "manifest unknown: not found (attempt $count)" >&2
  exit 1
fi
echo "ok: inspected $* on attempt $count"
exit 0
EOF
chmod +x "$fake_bin_dir/docker"

# Sets globals case_status/case_calls/case_output (no command substitution).
run_case() {
  local name="$1" fail_count="$2" attempts="$3"
  local counter="$work_dir/counter-$name"
  local out_file="$work_dir/output-$name"
  rm -f "$counter" "$out_file"
  case_status=0
  PATH="$fake_bin_dir:$PATH" \
  FAKE_DOCKER_COUNTER="$counter" \
  FAKE_DOCKER_FAIL_COUNT="$fail_count" \
  RETRY_ATTEMPTS="$attempts" \
  RETRY_SLEEP_SECONDS=0 \
  "$script" "ghcr.io/example/image:tag" > "$out_file" 2>&1 || case_status=$?
  case_calls="$(cat "$counter" 2>/dev/null || echo 0)"
  case_output="$(cat "$out_file")"
}

echo "== case 1: fails 3 times, succeeds on the 4th (within 6 attempts) =="
run_case case1 3 6
if [[ "$case_status" != "0" ]]; then
  echo "FAIL: expected exit 0, got $case_status. output:"
  echo "$case_output"
  fail=1
elif [[ "$case_calls" != "4" ]]; then
  echo "FAIL: expected exactly 4 docker invocations, got $case_calls"
  fail=1
else
  echo "PASS: exit 0 after $case_calls attempts"
fi

echo "== case 2: fails every time -> non-zero after exactly 6 attempts =="
run_case case2 999 6
if [[ "$case_status" == "0" ]]; then
  echo "FAIL: expected non-zero exit, got 0"
  fail=1
elif [[ "$case_calls" != "6" ]]; then
  echo "FAIL: expected exactly 6 docker invocations (RETRY_ATTEMPTS=6), got $case_calls"
  fail=1
else
  echo "PASS: exit $case_status after $case_calls attempts (all failed, as expected)"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "one or more cases FAILED"
  exit 1
fi
echo "all cases PASSED"

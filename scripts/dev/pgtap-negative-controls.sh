#!/usr/bin/env bash
# Controls run before the pgTAP roster: a failing suite, an early stop, roster and
# anchor drift and a removed IF EXISTS guard must each turn the runner red.
# Usage: scripts/dev/pgtap-negative-controls.sh   (PGTAP_KEEP=1 keeps the container)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$REPO_ROOT/scripts/dev/pgtap-throwaway.sh"
CONTROL_DIR="$REPO_ROOT/scripts/dev/pgtap-controls"
ROSTER="$REPO_ROOT/supabase/tests/pgtap/suites.txt"
ANCHOR="$REPO_ROOT/supabase/tests/pgtap/suites.expected.txt"
PS399_GUARD_CHECK="$REPO_ROOT/scripts/dev/check-ps399-idempotency-guards.sh"
PS399_MIGRATION="$REPO_ROOT/supabase/migrations/20260908012000_ps399_drop_cluster_applications_plaintext_api_key_columns.sql"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pgtap-controls.XXXXXXXX")"
# shellcheck disable=SC2329  # invoked by the EXIT trap on the next line but one
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

failures=0

report() { # <n> <name> <expected> <observed-rc> <ok?>
  if [ "$5" = "yes" ]; then
    echo "control $1 ($2): exercised -- $3, runner exited $4. OK"
  else
    echo "control $1 ($2): NOT EXERCISED -- $3, but the runner exited $4." >&2
    echo "  the gate's judgement is not wired; the roster run that follows proves nothing" >&2
    failures=$((failures + 1))
  fi
}

echo "== negative controls 3 and 4: the runner must refuse to start =="

# 3: the suite it named is then neither rostered nor DARK, and the anchor mismatches.
mkdir -p "$WORK_DIR/c3"
awk 'BEGIN{s=0;dropped=0}
     /^# === ROSTER ===$/{s=1;print;next}
     /^# === DARK ===$/{s=2;print;next}
     s==1 && dropped==0 && /\.sql[[:space:]]*#/{dropped=1;next}
     {print}' "$ROSTER" > "$WORK_DIR/c3/suites.txt"
cp "$ANCHOR" "$WORK_DIR/c3/suites.expected.txt"
"$RUNNER" --roster "$WORK_DIR/c3/suites.txt" > "$WORK_DIR/c3.log" 2>&1
rc=$?
[ "$rc" -ne 0 ] && ok=yes || ok=no
report 3 "roster with one line deleted" "the runner must refuse" "$rc" "$ok"
sed -n '1,6p' "$WORK_DIR/c3.log"

mkdir -p "$WORK_DIR/c4"
cp "$ROSTER" "$WORK_DIR/c4/suites.txt"
awk '/^assertions[[:space:]]+[0-9]+/{print "assertions", $2 + 1; next}{print}' \
  "$ANCHOR" > "$WORK_DIR/c4/suites.expected.txt"
"$RUNNER" --roster "$WORK_DIR/c4/suites.txt" > "$WORK_DIR/c4.log" 2>&1
rc=$?
[ "$rc" -ne 0 ] && ok=yes || ok=no
report 4 "anchor total mismatched" "the runner must refuse" "$rc" "$ok"
sed -n '1,6p' "$WORK_DIR/c4.log"

echo
echo "== negative controls 1 and 2: the runner must go red on a bad suite =="
echo "   (one container, both control suites, no roster)"

# One seeded container: the first two are expected failures, the fixture must pass.
PGTAP_CONTAINER="${PGTAP_CONTROL_CONTAINER:-pgtap-controls}" \
  "$RUNNER" "$CONTROL_DIR/control-failing-assertion.sql" \
            "$CONTROL_DIR/control-early-stop.sql" \
            "$CONTROL_DIR/control-storage-prefixes-fixture.sql" > "$WORK_DIR/c12.log" 2>&1
rc=$?
[ "$rc" -ne 0 ] && ok=yes || ok=no
report 1 "suite emits not ok" "the runner must exit non-zero" "$rc" "$ok"

# Control 1 alone produces the shared exit status, so check each diagnostic.
if grep -q '1 assertion(s) failed' "$WORK_DIR/c12.log"; then
  echo "control 1: the runner reported the failing assertion"
else
  echo "control 1: the runner never reported a failing assertion" >&2
  failures=$((failures + 1))
fi
if grep -q 'planned 4 assertion(s) and produced 1' "$WORK_DIR/c12.log"; then
  report 2 "suite stops early" "the runner must exit non-zero" "$rc" "$ok"
else
  echo "control 2 (suite stops early): NOT EXERCISED -- the runner did not report" >&2
  echo "  the plan/produced mismatch, so a suite that dies mid-transaction would pass" >&2
  failures=$((failures + 1))
fi
tail -14 "$WORK_DIR/c12.log"

if grep -Eq '^[[:space:]]*ok[[:space:]]+control-storage-prefixes-fixture\.sql[[:space:]]+plan=9[[:space:]]+produced=9[[:space:]]+executed=9[[:space:]]+skipped=0[[:space:]]+failed=0$' "$WORK_DIR/c12.log"; then
  report 6 "Storage prefixes replay fixture" "PS-392 must apply and all nine assertions must pass" 0 yes
else
  report 6 "Storage prefixes replay fixture" "PS-392 must apply and all nine assertions must pass" 1 no
  grep -A14 -B2 'control-storage-prefixes-fixture.sql' "$WORK_DIR/c12.log" >&2 || true
fi

echo
echo "== negative control 5: the PS-399 idempotency guard check must catch a removed guard =="

# 5a: the unmodified migration must pass, or 5b could catch it for the wrong reason.
"$PS399_GUARD_CHECK" "$PS399_MIGRATION" > "$WORK_DIR/c5-positive.log" 2>&1
rc_positive=$?
if [ "$rc_positive" -eq 0 ]; then
  echo "control 5 (real migration): exercised -- the guard check must pass on the unmodified file, exited $rc_positive. OK"
else
  echo "control 5 (real migration): NOT EXERCISED -- the guard check must pass on the unmodified file, but it exited $rc_positive." >&2
  echo "  the checked-in migration itself fails its own idempotency guard check; see the log below" >&2
  failures=$((failures + 1))
  sed -n '1,20p' "$WORK_DIR/c5-positive.log"
fi

mkdir -p "$WORK_DIR/c5"
sed 's/DROP COLUMN IF EXISTS guild_leader_api_key/DROP COLUMN guild_leader_api_key/' \
  "$PS399_MIGRATION" > "$WORK_DIR/c5/mutated.sql"
"$PS399_GUARD_CHECK" "$WORK_DIR/c5/mutated.sql" > "$WORK_DIR/c5-negative.log" 2>&1
rc_negative=$?
[ "$rc_negative" -ne 0 ] && ok=yes || ok=no
report 5 "PS-399 migration with one IF EXISTS removed" "the guard check must exit non-zero" "$rc_negative" "$ok"
if grep -q 'missing guard: DROP COLUMN IF EXISTS guild_leader_api_key' "$WORK_DIR/c5-negative.log"; then
  echo "control 5: the guard check named the guard it removed"
else
  echo "control 5: the guard check went non-zero but did not name the removed guard" >&2
  failures=$((failures + 1))
fi
sed -n '1,20p' "$WORK_DIR/c5-negative.log"

echo
if [ "$failures" -eq 0 ]; then
  echo "pgtap-controls: PASS — 6 controls exercised (failing assertion, early stop, roster line deleted, anchor mismatched, PS-399 idempotency guard removed, Storage prefixes fixture); the gate's judgement is wired"
  exit 0
fi
echo "pgtap-controls: FAIL — $failures control(s) did not produce the failure they exist to produce; the roster run below cannot be trusted" >&2
exit 1

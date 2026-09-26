#!/usr/bin/env bash
# Each injected census drift must fail its assertion (9, 10, 11); the unmodified suite passes.
# Throwaway container only. Usage: bash <this file>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
suite="$root/supabase/tests/pgtap/ps218_authenticated_write_grants.sql"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

mutate() {
  python3 - "$suite" "$1" "$2" <<'PY'
import sys
from pathlib import Path
src, out, sql = sys.argv[1], sys.argv[2], sys.argv[3]
text = Path(src).read_text()
anchor = 'SELECT NOT EXISTS (\n  SELECT 1\n  FROM supabase_migrations.schema_migrations'
if text.count(anchor) != 1:
    raise SystemExit('PS-218 negative controls: ledger-check anchor not found in the suite')
Path(out).write_text(text.replace(anchor, sql + '\n\n' + anchor))
PY
}

cp "$suite" "$scratch/nc0_control.sql"
# A kept census table disappears: rename it.
mutate "$scratch/nc1_kept_table_missing.sql" \
  'ALTER TABLE public.guild_war_meta_teams RENAME TO ps218_nc_renamed;'
# A policy-governed table loses its write policy.
mutate "$scratch/nc2_policy_dropped.sql" \
  'DROP POLICY guild_war_meta_teams_leader_write ON public.guild_war_meta_teams;'
# The reverse direction: an undecided table gains an arming policy.
mutate "$scratch/nc3_undecided_gains_policy.sql" \
  'CREATE POLICY ps218_nc_insert ON public.coaching_tasks FOR INSERT TO authenticated WITH CHECK (true);'

out="$scratch/run.log"
PGTAP_CONTAINER="ps218-nc-$$" bash "$root/scripts/dev/pgtap-throwaway.sh" \
  "$scratch/nc0_control.sql" \
  "$scratch/nc1_kept_table_missing.sql" \
  "$scratch/nc2_policy_dropped.sql" \
  "$scratch/nc3_undecided_gains_policy.sql" >"$out" 2>&1 || true

block() {
  awk -v name="$1" '
    /^== / { on = index($0, name) > 0; next }
    on { print }
  ' "$out"
}

fail=0
tap=''
has() { grep -qE "$1" <<<"$tap"; }
lacks() { ! grep -qE "$1" <<<"$tap"; }
expect() { # suite-name, description, predicate over $tap
  tap="$(block "$1")"
  if [ -z "$tap" ]; then
    echo "  FAIL $2 -- no TAP output for $1" >&2
    fail=1
  elif eval "$3"; then
    echo "  ok   $2"
  else
    echo "  FAIL $2" >&2
    printf '%s\n' "$tap" | grep -E '^(not )?ok|^1\.\.' >&2 || true
    fail=1
  fi
}

# shellcheck disable=SC2016  # predicates are eval'd inside expect(), where $tap is set
expect nc0_control.sql 'unmodified suite: 11 of 11 ok' \
  'has "^1\.\.11$" && lacks "^not ok" && [ "$(grep -c "^ok " <<<"$tap")" -eq 11 ]'
expect nc1_kept_table_missing.sql 'a renamed kept table fails assertion 9' \
  'has "^not ok 9 "'
expect nc2_policy_dropped.sql 'a dropped policy on a policy-governed table fails assertion 10' \
  'has "^not ok 10 " && lacks "^not ok 9 "'
expect nc3_undecided_gains_policy.sql 'a new write policy on a keep-undecided table fails assertion 11' \
  'has "^not ok 11 " && lacks "^not ok 10 "'

if [ "$fail" -ne 0 ]; then
  echo 'PS-218 pgTAP negative controls: FAIL (runner output follows)' >&2
  tail -40 "$out" >&2
  exit 1
fi
echo 'PS-218 pgTAP negative controls: OK'

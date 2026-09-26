#!/usr/bin/env bash
# pgTAP proof that the revoke migration tolerates known production ACL drift; negative controls: no drift
# fails assertion 2, the pre-tolerance revision refuses. Throwaway containers only. Usage: bash <this file>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
suite="$root/scripts/security/ps218-drift/ps218_drift_tolerance.sql"
prestate="$root/scripts/security/ps218-drift/prod-drift-prestate.sql"
migration_rel="supabase/migrations/20260925080000_ps218_revoke_authenticated_write_grants.sql"
pre_tolerance_rev="a859e084"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

run() { # name, runner-root, [prestate]
  local name="$1" runner_root="$2" pre="${3:-}"
  PGTAP_CONTAINER="ps218-drift-$name-$$" PGTAP_LIVE_FUNCTIONS="$pre" \
    bash "$runner_root/scripts/dev/pgtap-throwaway.sh" "$suite" \
    >"$scratch/$name.log" 2>&1
}

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1" >&2; tail -30 "$scratch/$2.log" >&2; fail=1; }

if run drift "$root" "$prestate" \
  && grep -q '^1\.\.6$' "$scratch/drift.log" \
  && [ "$(grep -c '^ok ' "$scratch/drift.log")" -eq 6 ] \
  && ! grep -q '^not ok' "$scratch/drift.log"; then
  ok 'drifted replay: migration applied, drift suite 6/6'
else
  bad 'drifted replay: migration applied, drift suite 6/6' drift
fi

# 2. negative control: without drift the suite must fail on assertion 2
run nodrift "$root" || true
if grep -q '^not ok 2 ' "$scratch/nodrift.log" && grep -q '^ok 1 ' "$scratch/nodrift.log"; then
  ok 'undrifted replay: drift suite fails assertion 2 (suite is not vacuous)'
else
  bad 'undrifted replay: drift suite fails assertion 2 (suite is not vacuous)' nodrift
fi

# 3. negative control: the pre-tolerance migration refuses the same drift
old="$scratch/old-root"
mkdir -p "$old/scripts" "$old/supabase"
cp -a "$root/scripts/dev" "$old/scripts/dev"
cp -a "$root/supabase/migrations" "$old/supabase/migrations"
git -C "$root" show "$pre_tolerance_rev:$migration_rel" >"$old/$migration_rel"
if run oldmig "$old" "$prestate"; then
  bad 'pre-tolerance migration refuses the drift (it applied instead)' oldmig
elif grep -q 'NOT APPLIED (UNEXPECTED) 20260925080000' "$scratch/oldmig.log" \
  && grep -q 'service_role cannot write 2 swept table(s)' "$scratch/oldmig.log"; then
  ok 'pre-tolerance migration (a859e084) refuses the drift: service_role cannot write 2 swept table(s)'
else
  bad 'pre-tolerance migration refuses the drift for the service_role reason' oldmig
fi

if [ "$fail" -ne 0 ]; then
  echo 'PS-218 drift tolerance: FAIL' >&2
  exit 1
fi
echo 'PS-218 drift tolerance: OK'

#!/usr/bin/env bash
# Control 5 of pgtap-negative-controls.sh: every ALTER/DROP in the migration dropping
# cluster_applications' plaintext key columns must carry IF EXISTS (static: pgTAP cannot read files).
# Usage: check-ps399-idempotency-guards.sh [migration-file]; exit 1 names the missing guard.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_MIGRATION="$REPO_ROOT/supabase/migrations/20260908012000_ps399_drop_cluster_applications_plaintext_api_key_columns.sql"
TARGET="${1:-$DEFAULT_MIGRATION}"

if [ ! -f "$TARGET" ]; then
  echo "check-ps399-idempotency-guards: FAIL -- migration file not found: $TARGET" >&2
  exit 1
fi

missing=0

# Strip whole-line `--` comments: the migration's prose shows the unguarded forms.
CODE_ONLY="$(/usr/bin/grep -vE '^[[:space:]]*--' "$TARGET")"

require_present() { # <label> <pattern>
  if printf '%s\n' "$CODE_ONLY" | /usr/bin/grep -qE -- "$2"; then
    echo "check-ps399-idempotency-guards: present -- $1"
  else
    echo "check-ps399-idempotency-guards: FAIL -- missing guard: $1 (pattern: $2) in $TARGET" >&2
    missing=$((missing + 1))
  fi
}

require_no_unguarded() { # <label> <all-occurrences-pattern> <guarded-pattern>
  local all_count guarded_count
  all_count=$(printf '%s\n' "$CODE_ONLY" | /usr/bin/grep -cE -- "$2")
  guarded_count=$(printf '%s\n' "$CODE_ONLY" | /usr/bin/grep -cE -- "$3")
  if [ "$all_count" -eq "$guarded_count" ]; then
    echo "check-ps399-idempotency-guards: present -- $1 has no unguarded occurrence ($all_count total, $guarded_count guarded)"
  else
    echo "check-ps399-idempotency-guards: FAIL -- missing guard: $1 has an unguarded occurrence ($all_count total, only $guarded_count guarded) in $TARGET" >&2
    missing=$((missing + 1))
  fi
}

require_present "ALTER TABLE IF EXISTS public.cluster_applications" \
  'ALTER TABLE IF EXISTS public\.cluster_applications'
require_present "DROP COLUMN IF EXISTS guild_leader_api_key" \
  'DROP COLUMN IF EXISTS guild_leader_api_key'
require_present "DROP COLUMN IF EXISTS player_api_key" \
  'DROP COLUMN IF EXISTS player_api_key'

# Every bare match must also match the guarded pattern, catching a second unguarded statement.
require_no_unguarded "ALTER TABLE ... public.cluster_applications" \
  'ALTER TABLE( IF EXISTS)? public\.cluster_applications' \
  'ALTER TABLE IF EXISTS public\.cluster_applications'
require_no_unguarded "DROP COLUMN ... guild_leader_api_key" \
  'DROP COLUMN( IF EXISTS)? guild_leader_api_key' \
  'DROP COLUMN IF EXISTS guild_leader_api_key'
require_no_unguarded "DROP COLUMN ... player_api_key" \
  'DROP COLUMN( IF EXISTS)? player_api_key' \
  'DROP COLUMN IF EXISTS player_api_key'

if [ "$missing" -eq 0 ]; then
  echo "check-ps399-idempotency-guards: PASS -- all idempotency guards present in $TARGET"
  exit 0
fi
echo "check-ps399-idempotency-guards: FAIL -- $missing guard(s) missing or unguarded in $TARGET" >&2
exit 1

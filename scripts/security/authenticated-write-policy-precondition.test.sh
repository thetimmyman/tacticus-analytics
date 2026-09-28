#!/usr/bin/env bash
# Exercise the actual migration against inherited and unrelated policy
# roles. The first case must refuse the revoke; the second must complete it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$root/supabase/migrations/20260925080000_ps218_revoke_authenticated_write_grants.sql"
scratch="$(mktemp -d)"
container="authwrite-policy-guard-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

# Use the migration's own table list, rejecting unexpected names before quoting.
python3 - "$migration" > "$scratch/setup.sql" <<'PY'
import re
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text()
match = re.search(
    r'INSERT INTO ps218_swept \(relname\)\s+SELECT unnest\(ARRAY\[(.*?)\]::text\[\]\)',
    source,
    re.S,
)
if not match:
    raise SystemExit('swept-table population not found in migration')
names = re.findall(r"'([^']+)'", match.group(1))
if len(names) != 55 or len(set(names)) != 55:
    raise SystemExit(f'expected 55 unique swept tables, found {len(names)}')
if any(not re.fullmatch(r'[a-z_][a-z0-9_]*', name) for name in names):
    raise SystemExit('unsafe or unexpected swept table name')

print('CREATE ROLE authenticated;')
print('CREATE ROLE service_role;')
print('CREATE ROLE writers;')
print('CREATE ROLE unrelated;')
for name in names:
    print(f'CREATE TABLE public.{name} (id integer);')
    print(f'ALTER TABLE public.{name} ENABLE ROW LEVEL SECURITY;')
    print(f'GRANT SELECT, INSERT, UPDATE, DELETE ON public.{name} TO authenticated, service_role;')
PY

docker run --rm -d --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
for attempt in {1..50}; do
  # Wait for the final server, not the image's temporary init server.
  if docker logs "$container" 2>&1 | rg -q 'PostgreSQL init process complete' \
    && docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  if ((attempt == 50)); then
    echo 'authenticated-write precondition test: disposable Postgres did not become ready' >&2
    exit 1
  fi
  sleep 0.2
done

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  -q -f - < "$scratch/setup.sql" > "$scratch/setup.out"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT writers TO authenticated;
CREATE POLICY inherited_write ON public._ha_state
  FOR UPDATE TO writers USING (true);
SQL

if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  -q -f - < "$migration" > "$scratch/inherited.out" 2>&1; then
  echo 'authenticated-write precondition test: migration revoked despite a live inherited write policy' >&2
  exit 1
fi
if ! rg -q 'gained a policy that grants authenticated a write command' "$scratch/inherited.out"; then
  echo 'authenticated-write precondition test: inherited-policy refusal had an unexpected cause' >&2
  cat "$scratch/inherited.out" >&2
  exit 1
fi
still_granted="$(docker exec "$container" psql -U postgres -Atq -c \
  "SELECT has_table_privilege('authenticated', 'public._ha_state', 'UPDATE')")"
[[ "$still_granted" == t ]] || {
  echo 'authenticated-write precondition test: refused migration changed the existing write grant' >&2
  exit 1
}

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DROP POLICY inherited_write ON public._ha_state;
REVOKE writers FROM authenticated;
SQL

# Drift tolerance must not weaken the writer precondition: a table the migration
# would revoke on that service_role cannot write must still refuse.
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
REVOKE INSERT, UPDATE, DELETE ON public.maps FROM service_role;
SQL
if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  -q -f - < "$migration" > "$scratch/no-writer.out" 2>&1; then
  echo 'authenticated-write precondition test: migration revoked on a table service_role cannot write' >&2
  exit 1
fi
if ! rg -q 'service_role cannot write 1 swept table\(s\).*: maps$' "$scratch/no-writer.out"; then
  echo 'authenticated-write precondition test: no-writer refusal had an unexpected cause' >&2
  cat "$scratch/no-writer.out" >&2
  exit 1
fi
[[ "$(docker exec "$container" psql -U postgres -Atq -c \
  "SELECT has_table_privilege('authenticated', 'public.maps', 'UPDATE')")" == t ]] || {
  echo 'authenticated-write precondition test: refused migration changed the maps write grant' >&2
  exit 1
}
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT INSERT, UPDATE, DELETE ON public.maps TO service_role;
SQL

# Known drift (neither role writes): skipped with a NOTICE; the migration completes.
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
REVOKE INSERT, UPDATE, DELETE ON public.player_invite_codes FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.guild_war_visibility_audit FROM authenticated, service_role;
-- partial drift: authenticated holds only UPDATE here
REVOKE INSERT, DELETE ON public.boss_tiers FROM authenticated;
CREATE POLICY unrelated_write ON public._ha_state
  FOR UPDATE TO unrelated USING (true);
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  -q -f - < "$migration" > "$scratch/unrelated.out" 2>&1
for expected in \
  'PS-218: 2 swept table\(s\) already grant authenticated no INSERT/UPDATE/DELETE; nothing to revoke, skipped \(service_role precondition not applied to them\): guild_war_visibility_audit, player_invite_codes$' \
  'PS-218: revoked authenticated INSERT/UPDATE/DELETE on 53 table\(s\): ' \
  'PS-218 verify: OK -- authenticated holds no INSERT/UPDATE/DELETE on all 55 swept tables \(53 revoked here, 2 already without\)'; do
  rg -q "$expected" "$scratch/unrelated.out" || {
    echo "authenticated-write precondition test: expected NOTICE not found: $expected" >&2
    cat "$scratch/unrelated.out" >&2
    exit 1
  }
done
# The NOTICE records pre-migration privileges, and the documented ROLLBACK restores exactly that ACL.
if ! rg -q 'boss_tiers:UPDATE(,| |$)' "$scratch/unrelated.out" \
  || ! rg -q 'maps:INSERT,UPDATE,DELETE' "$scratch/unrelated.out" \
  || rg -q 'player_invite_codes:' "$scratch/unrelated.out"; then
  echo 'authenticated-write precondition test: revoke NOTICE does not carry exact per-table privileges' >&2
  cat "$scratch/unrelated.out" >&2
  exit 1
fi
entries="$(rg -o 'revoked authenticated INSERT/UPDATE/DELETE on [0-9]+ table\(s\): (.*)$' -r '$1' "$scratch/unrelated.out")"
array_sql="$(printf '%s' "$entries" | tr -d ' ' | awk -F, '
  { n = 0
    for (i = 1; i <= NF; i++) {
      if ($i ~ /:/) { if (n) out = out "\x27,"; out = out "\x27" $i; n = 1 }
      else out = out "," $i
    }
    printf "%s\x27", out }')"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;
DO \$rollback\$
DECLARE e text;
BEGIN
  FOREACH e IN ARRAY ARRAY[$array_sql]::text[] LOOP
    EXECUTE format(
      'GRANT %s ON public.%I TO authenticated',
      replace(split_part(e, ':', 2), ',', ', '), split_part(e, ':', 1));
  END LOOP;
END
\$rollback\$;
CREATE TEMP TABLE rb AS
SELECT
  has_table_privilege('authenticated', 'public.boss_tiers', 'INSERT')::text || '|' ||
  has_table_privilege('authenticated', 'public.boss_tiers', 'UPDATE')::text || '|' ||
  has_table_privilege('authenticated', 'public.boss_tiers', 'DELETE')::text || '|' ||
  has_table_privilege('authenticated', 'public.player_invite_codes', 'INSERT')::text || '|' ||
  (SELECT count(*) FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND (has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE')))::text AS v;
\copy rb TO '/tmp/authwrite-rollback.out'
ROLLBACK;
SQL
rolled="$(docker exec "$container" cat /tmp/authwrite-rollback.out)"
[[ "$rolled" == 'false|true|false|false|53' ]] || {
  echo "authenticated-write precondition test: rollback restored $rolled, expected false|true|false|false|53 (boss_tiers UPDATE only, drifted table untouched, 53 tables back)" >&2
  exit 1
}

drifted="$(docker exec "$container" psql -U postgres -Atq -c \
  "SELECT has_table_privilege('authenticated', 'public.player_invite_codes', 'INSERT'), has_table_privilege('service_role', 'public.player_invite_codes', 'INSERT'), has_table_privilege('authenticated', 'public.player_invite_codes', 'SELECT')")"
[[ "$drifted" == 'f|f|t' ]] || {
  echo "authenticated-write precondition test: drifted-table post-state is $drifted, expected f|f|t" >&2
  exit 1
}
posture="$(docker exec "$container" psql -U postgres -Atq -c \
  "SELECT has_table_privilege('authenticated', 'public._ha_state', 'UPDATE'), has_table_privilege('authenticated', 'public._ha_state', 'SELECT'), has_table_privilege('service_role', 'public._ha_state', 'UPDATE')")"
[[ "$posture" == 'f|t|t' ]] || {
  echo "authenticated-write precondition test: unrelated-policy post-state is $posture, expected f|t|t" >&2
  exit 1
}

echo 'authenticated-write policy precondition: inherited writer refused; revoke without a service_role writer refused; drifted tables skipped with NOTICE; partial grants recorded and rolled back exactly; unrelated writer allowed; grants preserved as intended'

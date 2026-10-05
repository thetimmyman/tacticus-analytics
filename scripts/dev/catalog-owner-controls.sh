#!/usr/bin/env bash
# Exercise the checked-in migration against a fresh, isolated local PostgreSQL
# container. This script never accepts a database URL or publishes a port.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
migration="$root/supabase/migrations/20260831150100_wi8360_revoke_pg_db_role_setting_public_select.sql"
image=postgres:16-alpine
bootstrap_user=catalog_fixture_bootstrap
tmp=$(mktemp -d)
chmod 0700 "$tmp"
container="ta-catalog-owner-controls-$(date +%s)-$$"
created=0

cleanup() {
  if [[ "$created" == 1 ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT INT TERM

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
pass() { echo "PASS: $*"; }

[[ -f "$migration" ]] || fail "checked-in catalog migration is missing"
docker image inspect "$image" >/dev/null 2>&1 \
  || fail "required cached image $image is unavailable; no image pull was attempted"

awk '
  /^DO \$verify\$/ { inside = 1 }
  inside { print }
  inside && /^\$verify\$;/ { exit }
' "$migration" >"$tmp/verify.sql"
[[ $(grep -c '^DO \$verify\$' "$tmp/verify.sql") -eq 1 ]] \
  || fail "could not extract exactly one verifier block from the checked-in migration"

docker run --pull=never --detach --network none --name "$container" \
  --env POSTGRES_HOST_AUTH_METHOD=trust --env "POSTGRES_USER=$bootstrap_user" \
  --env POSTGRES_DB=postgres "$image" \
  -c allow_system_table_mods=on >/dev/null
created=1
ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -q -U "$bootstrap_user" -d postgres 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done
[[ "$ready" == 1 ]] || fail "fresh isolated PostgreSQL container did not become ready"
image_id=$(docker image inspect "$image" --format '{{.Id}}')
printf 'Synthetic engine image: postgres:16-alpine (%s)\n' "$image_id"

psql_input() {
  local database=$1
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U "$bootstrap_user" \
    -d "$database" -f -
}

psql_query() {
  local database=$1 query=$2
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$bootstrap_user" \
    -d "$database" -Atq -c "$query"
}

psql_query_as() {
  local user=$1 database=$2 query=$3
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$user" \
    -d "$database" -Atq -c "$query"
}

apply_migration() {
  psql_input "$1" <"$migration"
}

apply_migration_as() {
  local user=$1 database=$2
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U "$user" \
    -d "$database" -f - <"$migration"
}

psql_input postgres <<'SQL' >"$tmp/initial-owner-fixture.out" 2>&1 \
  || fail "could not create the disposable non-bootstrap postgres role"
CREATE ROLE postgres SUPERUSER LOGIN;
ALTER TABLE pg_catalog.pg_db_role_setting OWNER TO postgres;
SQL

assert_scalar() {
  local expected=$1 database=$2 query=$3 label=${4:-synthetic catalog assertion} actual
  actual=$(psql_query "$database" "$query") \
    || fail "could not read $label"
  [[ "$actual" == "$expected" ]] \
    || fail "$label differed (expected $expected, got $actual)"
}

assert_scalar_as() {
  local expected=$1 user=$2 database=$3 query=$4 label=$5 actual
  actual=$(psql_query_as "$user" "$database" "$query") \
    || fail "could not read $label as $user"
  [[ "$actual" == "$expected" ]] \
    || fail "$label as $user differed (expected $expected, got $actual)"
}

expect_refusal() {
  local label=$1 expected=$2 database=$3 fixture=$4
  if psql_input "$database" <"$fixture" >"$tmp/$label.out" 2>&1; then
    fail "$label unexpectedly succeeded"
  fi
  if ! grep -Fq "$expected" "$tmp/$label.out"; then
    sed -n '1,16p' "$tmp/$label.out" >&2
    fail "$label failed without its expected SQL diagnostic"
  fi
  pass "$label refused with the expected migration verifier diagnostic"
}

identity_state_sql() {
  local expected_owner=$1 expected_super=$2
  cat <<SQL
SELECT current_database() = 'postgres'
   AND count(c.oid) = 1
   AND bool_and(c.relisshared)
   AND min(owner_role.rolname) = '$expected_owner'
   AND bool_and(owner_role.rolsuper) = $expected_super
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = c.relowner
WHERE n.nspname = 'pg_catalog' AND c.relname = 'pg_db_role_setting';
SQL
}

no_public_select_sql() {
  cat <<'SQL'
SELECT NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class AS acl_class
     CROSS JOIN LATERAL pg_catalog.aclexplode(
       coalesce(acl_class.relacl, pg_catalog.acldefault('r', acl_class.relowner))
     ) AS acl
     WHERE acl_class.oid = 'pg_catalog.pg_db_role_setting'::regclass
       AND acl.grantee = 0 AND acl.privilege_type = 'SELECT'
     UNION ALL
     SELECT 1 FROM pg_catalog.pg_attribute AS acl_attribute
     CROSS JOIN LATERAL pg_catalog.aclexplode(acl_attribute.attacl) AS acl
     WHERE acl_attribute.attrelid = 'pg_catalog.pg_db_role_setting'::regclass
       AND acl_attribute.attnum > 0 AND NOT acl_attribute.attisdropped
       AND acl.grantee = 0 AND acl.privilege_type = 'SELECT'
   );
SQL
}

assert_scalar t postgres "$(identity_state_sql postgres true)" \
  || fail "ordinary postgres-owned catalog precondition is unavailable"
apply_migration postgres >"$tmp/postgres-first.out" 2>&1 \
  || fail "full migration failed for the ordinary postgres owner"
apply_migration postgres >"$tmp/postgres-repeat.out" 2>&1 \
  || fail "full migration was not idempotent for the ordinary postgres owner"
assert_scalar t postgres "$(identity_state_sql postgres true)" \
  || fail "postgres-owner migration changed required catalog access"
assert_scalar t postgres "$(no_public_select_sql)" \
  || fail "postgres-owner migration left PUBLIC table/column SELECT"
assert_scalar t postgres "SELECT pg_catalog.has_table_privilege('postgres','pg_catalog.pg_db_role_setting','SELECT')" \
  || fail "postgres-owner migration removed postgres SELECT"
pass "full migration and repeated apply pass for the postgres owner; PUBLIC table/column SELECT is absent and postgres SELECT remains"

docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'CREATE ROLE supabase_admin SUPERUSER' >/dev/null
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'ALTER TABLE pg_catalog.pg_db_role_setting OWNER TO supabase_admin' >/dev/null
apply_migration postgres >"$tmp/supabase-admin-first.out" 2>&1 \
  || fail "full migration failed for the supabase_admin superuser owner"
apply_migration postgres >"$tmp/supabase-admin-repeat.out" 2>&1 \
  || fail "full migration was not idempotent for the supabase_admin owner"
assert_scalar t postgres "$(identity_state_sql supabase_admin true)" \
  || fail "supabase_admin-owner migration changed required catalog access"
assert_scalar t postgres "$(no_public_select_sql)" \
  || fail "supabase_admin-owner migration left PUBLIC table/column SELECT"
assert_scalar t postgres "SELECT pg_catalog.has_table_privilege('postgres','pg_catalog.pg_db_role_setting','SELECT')" \
  || fail "supabase_admin-owner migration removed postgres SELECT"
pass "full migration and repeated apply pass for OID-bound supabase_admin with rolsuper=true"

make_identity_fixture() {
  local fixture=$1 role=$2 role_attributes=$3 shared_value=$4
  {
    echo 'BEGIN;'
    echo 'SET LOCAL allow_system_table_mods = on;'
    if [[ "$role" == unsupported_owner ]]; then
      echo 'CREATE ROLE unsupported_owner SUPERUSER;'
    elif [[ "$role_attributes" == nosuper ]]; then
      echo 'ALTER ROLE supabase_admin NOSUPERUSER;'
    fi
    if [[ -n "$shared_value" ]]; then
      printf "UPDATE pg_catalog.pg_class SET relisshared = %s WHERE oid = 'pg_catalog.pg_db_role_setting'::regclass;\n" "$shared_value"
    fi
    if [[ "$role" != preserve ]]; then
      printf "UPDATE pg_catalog.pg_class SET relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = '%s') WHERE oid = 'pg_catalog.pg_db_role_setting'::regclass;\n" "$role"
    fi
    cat "$tmp/verify.sql"
    echo 'ROLLBACK;'
  } >"$fixture"
}

make_identity_fixture "$tmp/unsupported.sql" unsupported_owner super true
expect_refusal unsupported-super-owner 'unexpected pg_db_role_setting identity' postgres "$tmp/unsupported.sql"
assert_scalar supabase_admin postgres "SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid = 'pg_catalog.pg_db_role_setting'::regclass" \
  || fail "unsupported-owner fixture did not roll back"

make_identity_fixture "$tmp/admin-nosuper.sql" supabase_admin nosuper true
expect_refusal named-admin-without-superuser 'unexpected pg_db_role_setting identity' postgres "$tmp/admin-nosuper.sql"
assert_scalar t postgres "SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname='supabase_admin'" \
  || fail "non-superuser role fixture did not roll back"

make_identity_fixture "$tmp/not-shared.sql" preserve super false
if psql_input postgres <"$tmp/not-shared.sql" >"$tmp/nonshared-relation.out" 2>&1; then
  fail "nonshared relation fixture unexpectedly succeeded"
elif grep -Fq 'unexpected pg_db_role_setting identity' "$tmp/nonshared-relation.out"; then
  pass "nonshared-relation refused by the checked-in migration verifier"
elif grep -Fq 'could not find relation mapping for relation "pg_db_role_setting"' "$tmp/nonshared-relation.out"; then
  echo "UNKNOWN: PostgreSQL rejected the disposable nonshared system-catalog fixture before verifier execution; no refusal pass claimed" >&2
else
  sed -n '1,16p' "$tmp/nonshared-relation.out" >&2
  fail "nonshared relation fixture failed for an unexpected reason"
fi
assert_scalar t postgres "SELECT relisshared FROM pg_catalog.pg_class WHERE oid = 'pg_catalog.pg_db_role_setting'::regclass" \
  || fail "nonshared relation fixture did not roll back"

make_acl_fixture() {
  local fixture=$1 grant=$2
  {
    echo 'BEGIN;'
    printf '%s\n' "$grant"
    cat "$tmp/verify.sql"
    echo 'ROLLBACK;'
  } >"$fixture"
}

make_acl_fixture "$tmp/public-table-select.sql" \
  'GRANT SELECT ON pg_catalog.pg_db_role_setting TO PUBLIC;'
expect_refusal public-table-select 'PUBLIC SELECT remains on pg_db_role_setting' postgres "$tmp/public-table-select.sql"

make_acl_fixture "$tmp/public-column-select.sql" \
  'GRANT SELECT (setdatabase) ON pg_catalog.pg_db_role_setting TO PUBLIC;'
expect_refusal public-column-select 'PUBLIC SELECT remains on pg_db_role_setting' postgres "$tmp/public-column-select.sql"

if apply_migration template1 >"$tmp/wrong-database.out" 2>&1; then
  fail "full migration unexpectedly accepted template1"
fi
grep -Fq 'General migration requires database postgres, got template1' "$tmp/wrong-database.out" \
  || fail "wrong-database refusal lacked its expected SQL diagnostic"
pass "full migration refuses the wrong database before ACL changes"

make_postgres_privilege_fixture() {
  local fixture=$1
  {
    echo 'BEGIN;'
    echo 'ALTER ROLE postgres NOSUPERUSER;'
    echo 'REVOKE SELECT ON pg_catalog.pg_db_role_setting FROM PUBLIC, postgres;'
    echo 'REVOKE SELECT (setdatabase, setrole, setconfig) ON pg_catalog.pg_db_role_setting FROM PUBLIC, postgres;'
    echo 'SET LOCAL ROLE postgres;'
    cat "$tmp/verify.sql"
    echo 'ROLLBACK;'
  } >"$fixture"
}
make_postgres_privilege_fixture "$tmp/postgres-select-lost.sql"
if psql_input postgres <"$tmp/postgres-select-lost.sql" >"$tmp/postgres-select-lost.out" 2>&1; then
  fail "privilege guard unexpectedly succeeded after postgres SELECT was removed"
elif grep -Fq 'postgres owner lost pg_db_role_setting SELECT' "$tmp/postgres-select-lost.out"; then
  pass "unchanged postgres SELECT guard refuses a supported non-superuser/no-SELECT fixture"
else
  echo "UNKNOWN: disposable postgres non-superuser/no-SELECT fixture was unsupported; no guard pass claimed" >&2
  sed -n '1,12p' "$tmp/postgres-select-lost.out" >&2
fi

# Exercise the startup executor shape that ordinary postgres-superuser controls
# cannot represent: postgres keeps a direct, non-grantable SELECT but does not
# own the relation or the PUBLIC grants. All role/ACL changes stay in this
# disposable container and are destroyed by the outer cleanup trap.
psql_input postgres <<'SQL' >"$tmp/executor-fixture-bootstrap.out" 2>&1 \
  || fail "could not prepare the disposable catalog ACL authority fixture"
CREATE ROLE catalog_acl_peer NOLOGIN;
ALTER ROLE supabase_admin SUPERUSER;
ALTER TABLE pg_catalog.pg_db_role_setting OWNER TO supabase_admin;
SET ROLE supabase_admin;
GRANT SELECT ON pg_catalog.pg_db_role_setting TO PUBLIC;
GRANT SELECT (setdatabase) ON pg_catalog.pg_db_role_setting TO PUBLIC;
GRANT SELECT ON pg_catalog.pg_db_role_setting TO catalog_acl_peer WITH GRANT OPTION;
GRANT SELECT ON pg_catalog.pg_db_role_setting TO postgres;
RESET ROLE;
SQL

multi_grantor=0
if docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'SET ROLE catalog_acl_peer; GRANT SELECT ON pg_catalog.pg_db_role_setting TO PUBLIC; GRANT SELECT (setrole) ON pg_catalog.pg_db_role_setting TO PUBLIC; RESET ROLE' \
  >"$tmp/multi-grantor-setup.out" 2>&1; then
  multi_grantor=1
else
  echo "UNKNOWN: secondary grantor fixture was unsupported; the primary executor control continues" >&2
  sed -n '1,8p' "$tmp/multi-grantor-setup.out" >&2
fi

docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d postgres \
  -c 'ALTER ROLE postgres NOSUPERUSER' \
  >"$tmp/executor-demotion.out" 2>&1 \
  || { sed -n '1,12p' "$tmp/executor-demotion.out" >&2; fail "could not demote the synthetic postgres executor using its disposable bootstrap role"; }

authority_facts_sql=$(cat <<'SQL'
SELECT fact
FROM (
  SELECT 'executor|' || current_user || '|' || session_user || '|' || r.rolsuper::text AS fact
    FROM pg_catalog.pg_roles AS r WHERE r.rolname = current_user
  UNION ALL
  SELECT 'relation|' || pg_catalog.pg_get_userbyid(c.relowner) || '|' || c.relisshared::text
    FROM pg_catalog.pg_class AS c WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass
  UNION ALL
  SELECT 'table-acl|' || CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END
         || '|' || pg_catalog.pg_get_userbyid(acl.grantor) || '|' || acl.privilege_type || '|' || acl.is_grantable::text
    FROM pg_catalog.pg_class AS c
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) AS acl
   WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass
     AND acl.privilege_type = 'SELECT'
     AND acl.grantee IN (0, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres'))
  UNION ALL
  SELECT 'column-acl|' || a.attname || '|' || CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END
         || '|' || pg_catalog.pg_get_userbyid(acl.grantor) || '|' || acl.privilege_type || '|' || acl.is_grantable::text
    FROM pg_catalog.pg_attribute AS a
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
   WHERE a.attrelid = 'pg_catalog.pg_db_role_setting'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND acl.privilege_type = 'SELECT'
     AND acl.grantee IN (0, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres'))
) AS facts
ORDER BY fact;
SQL
)
executor_before=$(psql_query_as postgres postgres "$authority_facts_sql") \
  || fail "could not capture synthetic executor/grantor facts before migration"
printf '%s\n' "$executor_before" >"$tmp/executor-before.txt"
assert_scalar_as t postgres postgres "SELECT current_user = 'postgres' AND session_user = 'postgres' AND NOT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user" \
  "synthetic executor must be postgres non-superuser"
assert_scalar_as t postgres postgres "SELECT pg_catalog.has_table_privilege('postgres','pg_catalog.pg_db_role_setting','SELECT') AND EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS acl WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass AND acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres') AND acl.privilege_type='SELECT' AND NOT acl.is_grantable)" \
  "synthetic postgres direct SELECT must be non-grantable"
assert_scalar_as t postgres postgres "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS acl WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass AND acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres') AND acl.privilege_type='SELECT' AND acl.is_grantable) AND NOT pg_catalog.pg_has_role('postgres','supabase_admin','USAGE')" \
  "synthetic postgres executor must have neither SELECT grant option nor owner membership"
assert_scalar_as t postgres postgres "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS acl WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass AND acl.grantee = 0 AND acl.privilege_type = 'SELECT') AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl WHERE a.attrelid = 'pg_catalog.pg_db_role_setting'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND acl.grantee = 0 AND acl.privilege_type = 'SELECT')" \
  "fixture must contain PUBLIC table and column SELECT"
assert_scalar_as t postgres postgres "SELECT c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) AS acl WHERE acl.grantee = 0 AND acl.grantor = c.relowner AND acl.privilege_type = 'SELECT') AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl WHERE a.attrelid = c.oid AND a.attname = 'setdatabase' AND acl.grantee = 0 AND acl.grantor = c.relowner AND acl.privilege_type = 'SELECT') FROM pg_catalog.pg_class AS c WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass" \
  "PUBLIC table/column grants must include owner grantor"
printf 'Synthetic executor/grantor facts before migration (role and ACL metadata only):\n%s\n' "$executor_before"

if apply_migration_as postgres postgres >"$tmp/nonowner-migration.out" 2>&1; then
  fail "full migration unexpectedly passed as postgres non-superuser without grant option"
else
  if awk '$0 ~ /ERROR:[[:space:]].*PUBLIC SELECT remains on pg_db_role_setting/ { found = 1 } END { exit !found }' "$tmp/nonowner-migration.out"; then
    pass "full migration fails closed with the exact PUBLIC SELECT verifier diagnostic for a non-owner, non-superuser executor"
  else
    sed -n '1,20p' "$tmp/nonowner-migration.out" >&2
    tail -n 8 "$tmp/nonowner-migration.out" >&2
    fail "non-owner executor migration failed before the expected PUBLIC SELECT verifier diagnostic"
  fi
fi

executor_after=$(psql_query_as postgres postgres "$authority_facts_sql") \
  || fail "could not capture synthetic executor/grantor facts after migration rollback"
printf '%s\n' "$executor_after" >"$tmp/executor-after.txt"
[[ "$executor_after" == "$executor_before" ]] \
  || fail "failed migration did not roll back the executor/grantor ACL state"
pass "failed migration transaction rolled back with executor and ACL grantor facts unchanged"
printf 'Synthetic executor/grantor facts after migration rollback (role and ACL metadata only):\n%s\n' "$executor_after"
if [[ "$multi_grantor" == 1 ]] && grep -Fq '|supabase_admin|' "$tmp/executor-before.txt" \
  && grep -Fq '|catalog_acl_peer|' "$tmp/executor-before.txt"; then
  pass "multi-grantor table/column PUBLIC SELECT remains visible in the exact migration refusal"
else
  echo "UNKNOWN: multiple PUBLIC SELECT grantors were not both represented by this PostgreSQL fixture; no multi-grantor pass claimed" >&2
fi

printf 'Catalog-owner controls finished: PASS lines are supported controls; UNKNOWN lines are unexercised fixture boundaries.\n'

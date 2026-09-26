#!/usr/bin/env bash
# Run pgTAP suites against a throwaway PostgreSQL seeded from this repo's migrations.
# Usage: pgtap-throwaway.sh <suite.sql>... | --roster supabase/tests/pgtap/suites.txt
# Env: PGTAP_LIVE_FUNCTIONS (live-only dump, loaded as pre-state), PGTAP_KEEP, PGTAP_IMAGE.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="${PGTAP_CONTAINER:-pgtap-throwaway}"
IMAGE="${PGTAP_IMAGE:-postgres:17}"

# Auth shim: the standard Supabase auth.uid()/role()/jwt() bodies, not diffed against live, so it proves
# the documented contract, not parity. Hashes are sha256 of pg_get_functiondef() on postgres:17; the drift
# check below exits 1 if body and hash disagree.
AUTH_UID_FUNCTIONDEF_SHA256="cd656145d15435f5b9348f338ff7836cf8f51f3673d103b1237437ff3a9b4b4c"
AUTH_ROLE_FUNCTIONDEF_SHA256="cdc8ff6d505dc3d913b877747acb7d4c397672c769ab9ace9510a9482497fee2"

# No fixed scratch path, so parallel runs cannot clobber each other.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pgtap-throwaway.XXXXXXXX")"
CONTAINER_DIR="/pgtap-$(basename "$WORK_DIR")"
# shellcheck disable=SC2329  # invoked by the EXIT trap on the next line but one
cleanup() {
  rm -rf "$WORK_DIR"
  [ -n "${PGTAP_KEEP:-}" ] || docker rm -f "$CONTAINER" >/dev/null 2>&1
}
trap cleanup EXIT

ROSTER_FILE=""
SUITE_DIR="$REPO_ROOT/supabase/tests/pgtap"
SUITES=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --roster)
      [ "$#" -ge 2 ] || { echo "--roster needs a file" >&2; exit 2; }
      ROSTER_FILE="$2"; shift 2 ;;
    --roster=*) ROSTER_FILE="${1#--roster=}"; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) SUITES+=("$1"); shift ;;
  esac
done

if [ -z "$ROSTER_FILE" ] && [ "${#SUITES[@]}" -eq 0 ]; then
  echo "usage: $0 supabase/tests/pgtap/<suite>.sql [more...]" >&2
  echo "       $0 --roster supabase/tests/pgtap/suites.txt" >&2
  exit 2
fi

# Roster mode: every check runs before a container exists, so a disagreeing
# roster never produces a green that looks like a judged population.
declare -A ROSTER_COUNT=()
ROSTER_ORDER=()
declare -A DARK_CLASS=()
DARK_ORDER=()
ROSTER_ASSERTIONS=0

if [ -n "$ROSTER_FILE" ]; then
  case "$ROSTER_FILE" in /*) roster_path="$ROSTER_FILE" ;; *) roster_path="$REPO_ROOT/$ROSTER_FILE" ;; esac
  [ -f "$roster_path" ] || { echo "roster not found: $ROSTER_FILE" >&2; exit 2; }
  anchor_path="$(dirname "$roster_path")/suites.expected.txt"
  [ -f "$anchor_path" ] || { echo "anchor not found next to the roster: $anchor_path" >&2; exit 2; }

  section=""
  lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in
      "# === ROSTER ===") section="roster"; continue ;;
      "# === DARK ===")   section="dark";   continue ;;
    esac
    [ -n "${line//[[:space:]]/}" ] || continue

    if [ "$section" = "roster" ] && [ "${line:0:1}" != "#" ]; then
      # `<suite>.sql # <count>` -- the count is mandatory.
      if [[ ! "$line" =~ ^([A-Za-z0-9_.-]+\.sql)[[:space:]]+#[[:space:]]+([0-9]+)[[:space:]]*$ ]]; then
        echo "roster line $lineno is not '<suite>.sql # <count>': $line" >&2
        exit 2
      fi
      name="${BASH_REMATCH[1]}"; count="${BASH_REMATCH[2]}"
      if [ -n "${ROSTER_COUNT[$name]:-}" ]; then
        echo "roster line $lineno lists $name twice" >&2; exit 2
      fi
      ROSTER_COUNT["$name"]="$count"
      ROSTER_ORDER+=("$name")
      ROSTER_ASSERTIONS=$((ROSTER_ASSERTIONS + count))
    elif [ "$section" = "dark" ] && [ "${line:0:1}" = "#" ]; then
      # Class and blocker are mandatory, or the gate's population shrinks silently.
      if [[ "$line" =~ ^#[[:space:]]+([A-Za-z0-9_.-]+\.sql)[[:space:]]+#[[:space:]]+([A-Z-]+)[[:space:]]+--[[:space:]]+(.*[^[:space:]])[[:space:]]*$ ]]; then
        DARK_CLASS["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        DARK_ORDER+=("${BASH_REMATCH[1]}")
      elif [[ "$line" =~ \.sql ]]; then
        echo "DARK line $lineno names a .sql without '# <CLASS> -- <blocker>': $line" >&2
        exit 2
      fi
    fi
  done < "$roster_path"

  [ "${#ROSTER_ORDER[@]}" -gt 0 ] || { echo "roster has no ROSTER section entries" >&2; exit 2; }

  # roster u dark == the directory, both directions.
  refuse=0
  for name in "${ROSTER_ORDER[@]}"; do
    [ -f "$SUITE_DIR/$name" ] || { echo "rostered suite is not in the directory: $name" >&2; refuse=1; }
    if [ -n "${DARK_CLASS[$name]:-}" ]; then
      echo "$name is both rostered and listed DARK" >&2; refuse=1
    fi
  done
  for name in "${DARK_ORDER[@]}"; do
    [ -f "$SUITE_DIR/$name" ] || { echo "DARK suite is not in the directory: $name" >&2; refuse=1; }
  done
  for path in "$SUITE_DIR"/*.sql; do
    name="$(basename "$path")"
    if [ -z "${ROSTER_COUNT[$name]:-}" ] && [ -z "${DARK_CLASS[$name]:-}" ]; then
      echo "suite is neither rostered nor listed DARK: $name" >&2; refuse=1
    fi
  done

  anchor_suites="$(sed -n 's/^suites[[:space:]]\+\([0-9]\+\)[[:space:]]*$/\1/p' "$anchor_path" | head -1)"
  anchor_assertions="$(sed -n 's/^assertions[[:space:]]\+\([0-9]\+\)[[:space:]]*$/\1/p' "$anchor_path" | head -1)"
  if [ -z "$anchor_suites" ] || [ -z "$anchor_assertions" ]; then
    echo "anchor must carry both 'suites <n>' and 'assertions <n>': $anchor_path" >&2; refuse=1
  else
    if [ "$anchor_suites" != "${#ROSTER_ORDER[@]}" ]; then
      echo "anchor says $anchor_suites suites; the roster lists ${#ROSTER_ORDER[@]}" >&2; refuse=1
    fi
    if [ "$anchor_assertions" != "$ROSTER_ASSERTIONS" ]; then
      echo "anchor says $anchor_assertions assertions; the roster's counts sum to $ROSTER_ASSERTIONS" >&2; refuse=1
    fi
  fi

  if [ "$refuse" -ne 0 ]; then
    echo "pgtap-gate: REFUSED — the roster, the suite directory and the anchor do not agree; nothing was run" >&2
    exit 2
  fi

  echo "== roster: ${#ROSTER_ORDER[@]} suites / $ROSTER_ASSERTIONS assertions; ${#DARK_ORDER[@]} listed dark =="
  for name in "${ROSTER_ORDER[@]}"; do SUITES+=("supabase/tests/pgtap/$name"); done
fi

set -- "${SUITES[@]}"

docker rm -f "$CONTAINER" >/dev/null 2>&1
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=postgres "$IMAGE" >/dev/null || {
  echo "could not start $IMAGE" >&2; exit 1; }

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

# Pinned so pgTAP cannot change between runs of one commit; an apt failure exits with its own message.
PGTAP_VERSION="${PGTAP_VERSION:-1.3.4-*}"
echo "== installing pgTAP (postgresql-17-pgtap=$PGTAP_VERSION) =="
docker exec "$CONTAINER" bash -c \
  "apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq postgresql-17-pgtap=$PGTAP_VERSION >/dev/null 2>&1" \
  || { echo "pgtap-gate: HARNESS FAILURE — pgTAP $PGTAP_VERSION did not install (network or PGDG); re-run, do not suppress" >&2; exit 1; }

echo "== roles, schemas and the auth shim =="
psql_in -q <<'SQL'
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE supabase_admin LOGIN SUPERUSER;
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE;
CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE;
CREATE ROLE authenticator NOINHERIT LOGIN;
CREATE ROLE dashboard_user NOLOGIN;
CREATE ROLE pgbouncer NOLOGIN;
CREATE ROLE supabase_read_only_user NOLOGIN;
CREATE ROLE supabase_replication_admin NOLOGIN;
CREATE ROLE supabase_realtime_admin NOLOGIN;
CREATE ROLE supabase_etl_admin NOLOGIN;

-- analytics_ro is not a Supabase role. It is a hand-made production login
-- (ledger row 20260802060000 analytics_readonly_role) that no migration in
-- this tree creates, so without this line every migration guarded on
-- `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro')` -- PS-397's
-- revoke and PS-472's -- silently does nothing here and the suites that judge
-- them pass vacuously. NOLOGIN because nothing in a throwaway connects as it.
CREATE ROLE analytics_ro NOLOGIN;

GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION postgres;
CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION postgres;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations
  (version text PRIMARY KEY, statements text[], name text);

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- pgTAP helper grants -- HARNESS ONLY, never mirrored into a migration.
--
-- A suite does `SET LOCAL ROLE anon/authenticated/service_role` to probe a
-- client role, then keeps calling pgTAP helpers (plan, throws_ok, ok, is,
-- lives_ok, finish, ...) under that switched role. Without USAGE on schema
-- extensions AND EXECUTE on the helper, the first such call after the switch
-- errors -- "does not exist" (schema not usable, so not visible via
-- search_path) or "permission denied" for a qualified call -- and aborts the
-- transaction. Every assertion after that point is swallowed silently: no
-- "not ok" is printed, so a bare failed-count check reads it as clean; only
-- comparing the suite's declared plan(n) against assertions actually
-- produced (done below, per suite) catches it (PS-349).
--
-- Granted by extension membership, not "every function in extensions", so
-- this stays scoped to pgTAP's own helpers and says nothing about pgcrypto
-- or uuid-ossp exposure. This is a client-role privilege on a disposable
-- database that is destroyed with the container; it must never be widened
-- for the roles under test in a real migration.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    JOIN pg_extension e ON e.oid = d.refobjid AND e.extname = 'pgtap'
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
  END LOOP;
END
$$;

-- Minimal GoTrue-shaped auth objects. Enough for the baseline's foreign keys
-- and auth.uid() calls to resolve; not a substitute for GoTrue.
CREATE TABLE auth.users (
  instance_id uuid,
  id uuid NOT NULL PRIMARY KEY,
  aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz,
  invited_at timestamptz, confirmation_token varchar(255),
  confirmation_sent_at timestamptz, recovery_token varchar(255),
  recovery_sent_at timestamptz, email_change_token_new varchar(255),
  email_change varchar(255), email_change_sent_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  phone text UNIQUE DEFAULT NULL, phone_confirmed_at timestamptz,
  phone_change text DEFAULT '', phone_change_token varchar(255) DEFAULT '',
  phone_change_sent_at timestamptz, confirmed_at timestamptz,
  email_change_token_current varchar(255) DEFAULT '',
  email_change_confirm_status smallint DEFAULT 0, banned_until timestamptz,
  reauthentication_token varchar(255) DEFAULT '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false, deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);
CREATE TABLE auth.identities (
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL, provider text NOT NULL,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text, id uuid NOT NULL DEFAULT extensions.gen_random_uuid() PRIMARY KEY
);
CREATE TABLE auth.sessions (
  id uuid NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz, updated_at timestamptz
);
CREATE TABLE auth.audit_log_entries (
  instance_id uuid, id uuid NOT NULL PRIMARY KEY, payload json,
  created_at timestamptz, ip_address varchar(64) NOT NULL DEFAULT ''
);
-- PS-393: enough of GoTrue's refresh_tokens shape for
-- public.revoke_stale_refresh_tokens() to run against -- id/token/user_id/
-- revoked/created_at/updated_at, the columns the sweep predicate reads and
-- writes. session_id/parent are omitted; nothing in this repository's
-- migrations reads them.
CREATE TABLE auth.refresh_tokens (
  instance_id uuid,
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  token varchar(255),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz
);
-- PS-356: pinned to the standard Supabase body (see AUTH SHIM PROVENANCE
-- above) -- a COALESCE that tries the flat request.jwt.claim.sub/.role GUC
-- first and falls back to the request.jwt.claims JSON GUC's sub/role key.
-- Previously this shim read ONLY the flat claim.sub/claim.role GUC, so any
-- suite that establishes identity via `SET LOCAL request.jwt.claims =
-- '{"sub": ...}'` (the JSON form) saw auth.uid()/auth.role() as NULL here
-- even though production resolves it. Do not reformat the function bodies
-- below without recomputing AUTH_UID_FUNCTIONDEF_SHA256 /
-- AUTH_ROLE_FUNCTIONDEF_SHA256 -- see the drift check right after this block.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
$f$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('request.jwt.claim.email', true), '')::text $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;
SQL

# Self-consistency only, not production parity.
echo "== auth shim drift check (self-consistency; production parity requires operator DB access) =="
for pair in "auth.uid():uid:$AUTH_UID_FUNCTIONDEF_SHA256" "auth.role():role:$AUTH_ROLE_FUNCTIONDEF_SHA256"; do
  fn="${pair%%:*}"; rest="${pair#*:}"; label="${rest%%:*}"; expected="${rest#*:}"
  actual="$(docker exec -i "$CONTAINER" psql -tA -U postgres -d postgres \
    -c "SELECT pg_get_functiondef('${fn}'::regprocedure);" | sha256sum | cut -d' ' -f1)"
  if [ "$actual" != "$expected" ]; then
    echo "pgtap-gate: HARNESS FAILURE -- auth.${label}() drifted from its pinned body" >&2
    echo "  expected sha256 $expected" >&2
    echo "  actual   sha256 $actual" >&2
    exit 1
  fi
  echo "  auth.${label}() matches pinned body ($expected)"
done

# Shared with the vitest integration lane so the two cannot drift.
# shellcheck source=scripts/dev/lib/replay-migrations.sh
. "$REPO_ROOT/scripts/dev/lib/replay-migrations.sh"
if ! replay_migrations "$CONTAINER" "$REPO_ROOT" "$CONTAINER_DIR"; then
  echo "pgtap-gate: REFUSED — the migration replay left the schema incomplete (see the UNEXPECTED lines above); no suite was run" >&2
  exit 2
fi

# Always set (0 or 1): "is the object present" cannot tell a lane that never
# had it from a migration that dropped it.
LIVE_FUNCTIONS_LOADED=0
[ -n "${PGTAP_LIVE_FUNCTIONS:-}" ] && LIVE_FUNCTIONS_LOADED=1

# Each suite runs once, so the printed TAP is the judged TAP.
status=0
TOTAL_SUITES=0
TOTAL_PLANNED=0
TOTAL_EXECUTED=0
TOTAL_SKIPPED=0
TOTAL_FAILED=0
TOTAL_SHORT=0
: > "$WORK_DIR/table.out"
for suite in "$@"; do
  echo
  echo "== $suite =="
  short=0
  case "$suite" in
    /*) suite_path="$suite" ;;
     *) suite_path="$REPO_ROOT/$suite" ;;
  esac
  docker cp "$suite_path" "$CONTAINER":"$CONTAINER_DIR/suite.sql" >/dev/null

  # Captured, never piped: with `psql | grep -q`, psql takes SIGPIPE, pipefail
  # reports 141, and a failing suite could exit 0.
  docker exec -i "$CONTAINER" psql -tA -U postgres -d postgres \
    -v pgtap_live_functions="$LIVE_FUNCTIONS_LOADED" \
    -f "$CONTAINER_DIR/suite.sql" > "$WORK_DIR/tap.out" 2>&1
  psql_status=$?

  grep -E '^(ok|not ok|1\.\.|#)' "$WORK_DIR/tap.out"

  if [ "$psql_status" -ne 0 ]; then
    echo "  psql exited $psql_status" >&2
    sed -n '1,20p' "$WORK_DIR/tap.out" >&2
    status=1
  fi

  # `not ok ... # SKIP` is a reviewed skip; a bare `not ok` is a failure.
  failed="$(grep -E '^not ok' "$WORK_DIR/tap.out" | grep -cv '# SKIP')"
  skipped="$(grep -cE '^(ok|not ok) .*# SKIP' "$WORK_DIR/tap.out")"
  if [ "$failed" -gt 0 ]; then
    echo "  $failed assertion(s) failed" >&2
    status=1
  fi

  # psql exits 0 after a statement error and later assertions vanish, so compare plan to assertions.
  planned="$(sed -n 's/^1\.\.\([0-9]\+\).*/\1/p' "$WORK_DIR/tap.out" | head -1)"
  produced="$(grep -c -E '^(ok|not ok) ' "$WORK_DIR/tap.out")"
  if [ -z "$planned" ]; then
    echo "  no TAP plan was printed -- the suite did not run" >&2
    sed -n '1,20p' "$WORK_DIR/tap.out" >&2
    status=1
  elif [ "$planned" != "$produced" ]; then
    echo "  the suite planned $planned assertion(s) and produced $produced;" >&2
    echo "  it stopped early. First error:" >&2
    grep -m1 'ERROR:' "$WORK_DIR/tap.out" >&2
    status=1
    short=1
  fi
  [ -n "$planned" ] || planned=0

  executed=$((produced - skipped))

  # Roster mode also fails a suite whose assertion count drops below the roster
  # (a lowered plan stays self-consistent) and a suite whose every assertion skipped.
  suite_name="$(basename "$suite")"
  if [ -n "$ROSTER_FILE" ]; then
    expected="${ROSTER_COUNT[$suite_name]:-}"
    if [ -n "$expected" ] && [ "$planned" != "$expected" ]; then
      echo "  the roster says $suite_name has $expected assertion(s); it planned $planned" >&2
      status=1
    fi
    if [ "$executed" -eq 0 ]; then
      echo "  $suite_name executed 0 assertions -- a rostered suite that runs nothing is a" >&2
      echo "  failure, not a pass; move it to the roster's DARK section with its blocker" >&2
      status=1
    fi
  fi

  if [ "$failed" -gt 0 ] || [ "$short" -ne 0 ] ||
     { [ -n "$ROSTER_FILE" ] && [ "$executed" -eq 0 ]; }; then
    verdict="FAIL"
  else
    verdict="ok  "
  fi
  printf '  %s %-52s plan=%-4s produced=%-4s executed=%-4s skipped=%-3s failed=%s\n' \
    "$verdict" "$suite_name" "$planned" "$produced" "$executed" "$skipped" "$failed" \
    >> "$WORK_DIR/table.out"

  TOTAL_PLANNED=$((TOTAL_PLANNED + planned))
  TOTAL_EXECUTED=$((TOTAL_EXECUTED + executed))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
  TOTAL_FAILED=$((TOTAL_FAILED + failed))
  TOTAL_SHORT=$((TOTAL_SHORT + short))
  TOTAL_SUITES=$((TOTAL_SUITES + 1))
done

echo
echo "== per suite =="
cat "$WORK_DIR/table.out"

# The verdict names the lane's blind spot: a tree-seeded container, not the live privilege surface.
echo
if [ "$status" -eq 0 ]; then outcome="PASS"; else outcome="FAIL"; fi
echo "pgtap-gate: $outcome — $TOTAL_SUITES suites / $TOTAL_PLANNED assertions:" \
     "$TOTAL_EXECUTED executed, $TOTAL_SKIPPED reviewed-skipped, $TOTAL_FAILED failed," \
     "$TOTAL_SHORT stopped early, ${#DARK_ORDER[@]} listed dark;" \
     "replay lane, weaker than production: cannot see live ACLs, live-only functions," \
     "or the $NOT_APPLIED migrations this database could not apply"

exit $status

#!/usr/bin/env bash
# Migration replay shared by the pgTAP and integration lanes so they cannot drift.
# Creates the hand-made `analytics_ro` login so migrations guarded on it run.
# Usage: source it, then `replay_migrations <container> <repo_root> <container_dir>`.

replay_migrations() {
  local CONTAINER="$1" REPO_ROOT="$2" CONTAINER_DIR="$3"
  local path file target_db version name storage_setup_role

  psql_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
  storage_setup_role="$(docker exec "$CONTAINER" psql -At -U postgres -d postgres -c "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin' AND rolsuper) THEN 'supabase_admin' WHEN to_regnamespace('storage') IS NULL OR has_schema_privilege('postgres', 'storage', 'CREATE') THEN 'postgres' ELSE '' END")"
  if [ -z "$storage_setup_role" ]; then
    echo "replay: REFUSED -- no disposable superuser or postgres CREATE privilege for a missing Storage fixture" >&2
    return 1
  fi
  psql_storage_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$storage_setup_role" -d postgres "$@"; }

  psql_in -q <<'PRESQL'
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    CREATE ROLE analytics_ro NOLOGIN;
  END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations
  (version text PRIMARY KEY, statements text[], name text);
PRESQL

docker exec "$CONTAINER" mkdir -p "$CONTAINER_DIR" >/dev/null
docker cp "$REPO_ROOT/supabase/migrations" "$CONTAINER":"$CONTAINER_DIR/mig" >/dev/null

echo "== clean baseline =="
docker exec -i "$CONTAINER" psql -q -U postgres -d postgres \
  -f "$CONTAINER_DIR/mig/20260813000000_clean_baseline.sql" >/dev/null 2>&1

echo "== Storage prefix table pre-state (local harness fixture) =="
docker cp "$REPO_ROOT/scripts/dev/lib/fixtures/storage-prefixes-prestate.sql" \
  "$CONTAINER":"$CONTAINER_DIR/storage-prefixes-prestate.sql" >/dev/null
psql_storage_in -q -f "$CONTAINER_DIR/storage-prefixes-prestate.sql" \
  || { echo "replay: REFUSED -- could not provision the measured storage.prefixes pre-state" >&2; return 1; }

echo "== live column shape (see LIVE SHAPE in pgtap-throwaway.sh) =="
psql_in -q <<'SQL'
ALTER TABLE public.player_mapping
  ADD COLUMN IF NOT EXISTS consecutive_api_key_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_api_key_failure_at timestamptz;
ALTER TABLE public.guild_config
  ADD COLUMN IF NOT EXISTS client_secret text,
  ADD COLUMN IF NOT EXISTS client_secret_uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS client_secret_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS war_sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consecutive_war_sync_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_war_sync_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_war_sync_error_reason text,
  ADD COLUMN IF NOT EXISTS last_war_sync_error_details jsonb;
-- The live ACL on the erasure is postgres/EXECUTE only; the clean baseline
-- still carries the anon/authenticated/service_role grants live has revoked,
-- and the erasure migration's own verify block refuses to pass with them present.
REVOKE ALL ON FUNCTION public.revoke_all_player_identity_for_subject(uuid, text, uuid, text)
  FROM anon, authenticated, service_role, PUBLIC;
SQL

echo "== live ACL shape: the analytics_ro pre-state on player_mapping =="
# Reproduces live's column-level analytics_ro SELECT on player_mapping (no table grant) so a later
# table-level REVOKE is proven to clear column grants.
psql_in -q <<'SQL'
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.player_mapping'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname NOT IN ('tacticus_api_key_encrypted', 'ownership_attestation_id');
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.player_mapping TO analytics_ro', v_cols);
END
$$;
SQL

  # Live-only definitions are pre-state: loaded after the baseline and live-shape patches, before later
  # migrations, so they may reference only objects that exist at this point.
  if [ -n "${PGTAP_LIVE_FUNCTIONS:-}" ]; then
    echo "== live-only functions from $PGTAP_LIVE_FUNCTIONS (pre-state, before the later migrations) =="
    docker cp "$PGTAP_LIVE_FUNCTIONS" "$CONTAINER":"$CONTAINER_DIR/live-functions.sql" >/dev/null
    psql_in -q -f "$CONTAINER_DIR/live-functions.sql" \
      || { echo "could not load them" >&2; return 1; }
  fi

  # The CLI image seeds an authenticator statement_timeout live does not have;
  # remove only it and prove every other setting is unchanged.
  psql_in -q <<'SQL'
DO $$
DECLARE
  v_before text[];
  v_after text[];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    SELECT array_agg(setting ORDER BY setting)
      INTO v_before
      FROM pg_roles r
      CROSS JOIN LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS u(setting)
     WHERE r.rolname = 'authenticator'
       AND setting NOT LIKE 'statement_timeout=%';

    EXECUTE 'ALTER ROLE authenticator RESET statement_timeout';

    SELECT array_agg(setting ORDER BY setting)
      INTO v_after
      FROM pg_roles r
      CROSS JOIN LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS u(setting)
     WHERE r.rolname = 'authenticator'
       AND setting NOT LIKE 'statement_timeout=%';

    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'role-timeout replay pre-state changed unrelated authenticator settings';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_roles r
        CROSS JOIN LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS u(setting)
       WHERE r.rolname = 'authenticator'
         AND setting LIKE 'statement_timeout=%'
    ) THEN
      RAISE EXCEPTION 'role-timeout replay pre-state still has authenticator statement_timeout';
    END IF;
  END IF;
END
$$;
SQL

echo "== later migrations =="
  # Only listed failures are tolerated; anything else would pass the gate on a partially migrated schema.
  local ALLOWLIST="$REPO_ROOT/scripts/dev/lib/replay-unappliable.txt"
  local -a EXPECTED_UNAPPLIABLE=()
  local entry
  # `cli-stack:` marks a failure specific to the CLI image; it is accepted but
  # skips the "listed but applied cleanly" prune note on the pgTAP lane.
  local -a LANE_SPECIFIC=()
  if [ -f "$ALLOWLIST" ]; then
    while IFS= read -r entry; do
      entry="${entry%%#*}"
      entry="$(printf '%s' "$entry" | tr -d '[:space:]')"
      [ -n "$entry" ] || continue
      case "$entry" in
        cli-stack:*)
          entry="${entry#cli-stack:}"
          LANE_SPECIFIC+=("$entry")
          ;;
      esac
      EXPECTED_UNAPPLIABLE+=("$entry")
    done < "$ALLOWLIST"
  else
    echo "replay: REFUSED -- $ALLOWLIST is missing; the replay will not decide for itself which migration failures are acceptable" >&2
    return 1
  fi

  NOT_APPLIED=0
  local -a UNEXPECTED=() SEEN_EXPECTED=()
  local err expected migration_role
  for path in "$REPO_ROOT"/supabase/migrations/*.sql; do
    file="$(basename "$path")"
    case "$file" in *clean_baseline.sql) continue;; esac
    target_db="$(grep -m1 -i '^-- target-db:' "$path" | sed 's/.*: *//' | tr -d '\r')"
    case "$target_db" in eot) echo "  skip (not this database) $file"; continue;; esac
    migration_role=postgres
    if [ "$file" = "20261007210000_rest_reader_role.sql" ]; then
      # Only this migration changes privileged role attributes. The CLI's
      # postgres role is not necessarily a superuser; never weaken the SQL or
      # excuse its failure. Use only a measured disposable superuser.
      if ! migration_role="$(docker exec "$CONTAINER" psql -At -U postgres -d postgres -c \
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin' AND rolsuper) THEN 'supabase_admin' WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolsuper) THEN 'postgres' ELSE '' END")"; then
        echo "replay: REFUSED -- could not verify a disposable superuser for the reader-role migration" >&2
        return 1
      fi
      case "$migration_role" in
        supabase_admin|postgres) ;;
        *)
          echo "replay: REFUSED -- no verified disposable superuser for the reader-role migration" >&2
          return 1
          ;;
      esac
    fi
    err="$(docker exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$migration_role" -d postgres \
             -f "$CONTAINER_DIR/mig/$file" 2>&1 >/dev/null)"
    if [ $? -eq 0 ]; then
      version="${file%%_*}"; name="${file#*_}"; name="${name%.sql}"
      docker exec -i "$CONTAINER" psql -q -U postgres -d postgres -c \
        "INSERT INTO supabase_migrations.schema_migrations(version, name)
           VALUES ('$version', '$name') ON CONFLICT DO NOTHING;" >/dev/null 2>&1
      echo "  applied $file"
      local lane_specific=0
      for entry in ${LANE_SPECIFIC+"${LANE_SPECIFIC[@]}"}; do
        [ "$entry" = "$file" ] && lane_specific=1 && break
      done
      if [ "$lane_specific" -eq 0 ]; then
        for entry in ${EXPECTED_UNAPPLIABLE+"${EXPECTED_UNAPPLIABLE[@]}"}; do
          if [ "$entry" = "$file" ]; then
            echo "  note: $file is listed in replay-unappliable.txt but applied cleanly -- prune it from that list" >&2
          fi
        done
      fi
    else
      expected=0
      for entry in ${EXPECTED_UNAPPLIABLE+"${EXPECTED_UNAPPLIABLE[@]}"}; do
        [ "$entry" = "$file" ] && expected=1 && break
      done
      if [ "$expected" -eq 1 ]; then
        # Known: a verify block asserting live data this replay does not have.
        echo "  not applied (known) $file"
        SEEN_EXPECTED+=("$file")
        NOT_APPLIED=$((NOT_APPLIED + 1))
      else
        echo "  NOT APPLIED (UNEXPECTED) $file"
        printf '%s\n' "$err" | tail -5 | sed 's/^/      /'
        UNEXPECTED+=("$file")
      fi
    fi
  done
  echo "== $NOT_APPLIED migration(s) could not be applied on this lane (all known) =="

  if [ "${#UNEXPECTED[@]}" -gt 0 ]; then
    echo "" >&2
    echo "replay: FAILED -- ${#UNEXPECTED[@]} migration(s) failed that are not in scripts/dev/lib/replay-unappliable.txt:" >&2
    printf '  %s\n' "${UNEXPECTED[@]}" >&2
    echo "The schema this lane seeded is therefore incomplete and every assertion run against it is unsound." >&2
    echo "Fix the migration, or -- only if the failure is genuinely live-data-only -- add it to that file with its measured reason." >&2
    return 1
  fi
  return 0
}

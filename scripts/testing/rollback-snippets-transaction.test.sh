#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="rollback-snippet-test-$$"
image="${ROLLBACK_TEST_IMAGE:-postgres:17}"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/rollback-snippet-test.XXXXXXXX")"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "rollback snippet test requires the local image $image" >&2
  exit 2
fi

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT

docker run --detach --name "$container" --network none \
  --cpus=2 --memory=2g --memory-swap=2g \
  -e POSTGRES_PASSWORD=synthetic \
  -v "$repo_root/supabase/snippets:/snippets:ro" \
  "$image" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo 'rollback snippet test database did not become ready' >&2
  exit 1
fi

# Negative control: recreate the original uncommented capture headers in
# temporary copies and prove ON_ERROR_STOP rejects them before any function is
# installed. The checked-in snippets are never rewritten by this test.
sed -e 's/^-- === SIGNATURES ===$/=== SIGNATURES ===/' \
    -e 's/^-- monitoring.notify(/monitoring.notify(/' \
    -e 's/^-- === DEFS ===$/=== DEFS ===/' \
  "$repo_root/supabase/snippets/20260919011000_rollback_alert_staleness_notify.sql" \
  > "$test_dir/alert-staleness.sql"
sed -E -e 's/^-- (=== SIGNATURES ===|=== DEFS ===|call_edge_function.*|get_cron_secret.*|get_service_role_key.*|monitoring\.notify.*)$/\1/' \
  "$repo_root/supabase/snippets/20260902010000_rollback_live_prosrc_capture.sql" \
  > "$test_dir/live-capture.sql"
for negative_sql in "$test_dir/alert-staleness.sql" "$test_dir/live-capture.sql"; do
  docker cp "$negative_sql" "$container:/tmp/negative.sql" >/dev/null
  if negative_output="$(docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL' 2>&1
BEGIN;
\i /tmp/negative.sql
ROLLBACK;
SQL
)"; then
    echo "rollback snippet test accepted the original bare capture header in $(basename "$negative_sql")" >&2
    exit 1
  fi
  if [[ "$negative_output" != *"syntax error"* ]]; then
    echo "rollback snippet negative control failed for an unexpected reason: $negative_output" >&2
    exit 1
  fi
done

# This database contains only synthetic objects. Neither captured function is
# called; applying the SQL inside this transaction proves parse/catalog safety
# and then verifies the original function catalog is restored by ROLLBACK.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE SCHEMA monitoring;
CREATE SCHEMA internal;
CREATE SCHEMA net;
CREATE TABLE monitoring.alert_state (
  alert_key text PRIMARY KEY,
  status text,
  since timestamptz,
  last_seen_at timestamptz,
  last_title text,
  last_body text
);
CREATE ROLE snippet_probe NOLOGIN;
CREATE FUNCTION monitoring.notify(p_alert_key text, p_status text, p_title text,
  p_body text DEFAULT NULL::text, p_quiet boolean DEFAULT false)
RETURNS boolean LANGUAGE sql AS 'SELECT false';
GRANT EXECUTE ON FUNCTION monitoring.notify(text,text,text,text,boolean) TO snippet_probe;

CREATE TEMP TABLE original_catalog(hash text) ON COMMIT PRESERVE ROWS;
INSERT INTO original_catalog
SELECT md5(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, ''))
  FROM pg_proc p
 WHERE p.oid = 'monitoring.notify(text,text,text,text,boolean)'::regprocedure;

BEGIN;
\i /snippets/20260919011000_rollback_alert_staleness_notify.sql
\i /snippets/20260902010000_rollback_live_prosrc_capture.sql
DO $verify_applied$
DECLARE
  old_hash text;
  new_hash text;
BEGIN
  SELECT hash INTO old_hash FROM original_catalog;
  SELECT md5(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, ''))
    INTO new_hash
    FROM pg_proc p
   WHERE p.oid = 'monitoring.notify(text,text,text,text,boolean)'::regprocedure;
  IF new_hash = old_hash THEN
    RAISE EXCEPTION 'rollback definitions did not replace the synthetic function';
  END IF;
  IF to_regprocedure('public.call_edge_function(text,jsonb)') IS NULL
     OR to_regprocedure('public.get_cron_secret()') IS NULL
     OR to_regprocedure('public.get_service_role_key()') IS NULL THEN
    RAISE EXCEPTION 'rollback capture definitions did not all parse and install';
  END IF;
END
$verify_applied$;
ROLLBACK;

DO $verify_rollback$
DECLARE
  old_hash text;
  restored_hash text;
BEGIN
  SELECT hash INTO old_hash FROM original_catalog;
  SELECT md5(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, ''))
    INTO restored_hash
    FROM pg_proc p
   WHERE p.oid = 'monitoring.notify(text,text,text,text,boolean)'::regprocedure;
  IF restored_hash IS DISTINCT FROM old_hash THEN
    RAISE EXCEPTION 'ROLLBACK did not restore the original definition and ACL';
  END IF;
  IF NOT has_function_privilege('snippet_probe', 'monitoring.notify(text,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK did not restore the synthetic role grant';
  END IF;
  IF to_regprocedure('public.call_edge_function(text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.get_cron_secret()') IS NOT NULL
     OR to_regprocedure('public.get_service_role_key()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK left captured definitions installed';
  END IF;
END
$verify_rollback$;
SQL

echo 'rollback snippet transaction test PASS (original-header controls fail; corrected files parse; synthetic catalog rolls back)'

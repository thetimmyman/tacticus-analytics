-- A failed pg_net response survives as a durable snapshot holding only the host and
-- allowed fields (the stub plants secrets everywhere). Rolled back.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(13);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260925020000'),
  1,
  '2. the PS-203 migration is recorded as applied'
);

SELECT ok(
  (SELECT relpersistence = 'p' AND relrowsecurity
     FROM pg_class
    WHERE oid = 'monitoring.pgnet_failure_snapshots'::regclass),
  '3. the snapshot table is logged and RLS-enabled'
);

-- Recreate the UNLOGGED response table, independent of the image's extensions.
DROP EXTENSION IF EXISTS pg_net;

DO $schema$
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    CREATE SCHEMA net;
  END IF;
END
$schema$;

DROP TABLE IF EXISTS net._http_response;
CREATE UNLOGGED TABLE net._http_response (
  id           bigint,
  status_code  integer,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz NOT NULL
);

-- No-op notify sink so the watchdog still reaches its snapshot INSERT.
CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  headers jsonb DEFAULT '{}'::jsonb,
  body jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $stub$
BEGIN
  RETURN 1;
END
$stub$;

DELETE FROM monitoring.pgnet_failure_snapshots;
DELETE FROM monitoring.pgnet_request_ledger;

INSERT INTO net._http_response
  (id, status_code, content_type, headers, content, timed_out, error_msg, created)
VALUES
  (203001, 503, 'application/json',
   '{"authorization":"Bearer HEADER_SECRET_DO_NOT_STORE"}'::jsonb,
   'BODY_SECRET_DO_NOT_STORE', false, 'upstream failure', now() - INTERVAL '5 minutes'),
  (203002, 204, NULL, NULL, NULL, false, NULL, now() - INTERVAL '5 minutes');

INSERT INTO monitoring.pgnet_request_ledger (request_id, function_name, url)
VALUES
  (203001, 'ps203-failing-request',
   'https://user:password@api.example.test:8443/private/path?token=URL_SECRET_DO_NOT_STORE'), -- trufflehog:ignore (synthetic fixture)
  (203002, 'ps203-successful-request',
   'https://ok.example.test/private/path?token=ANOTHER_URL_SECRET');

-- An aged row proves the watchdog also applies retention.
INSERT INTO monitoring.pgnet_failure_snapshots
  (captured_at, source, response_id, status_code, error_msg, url_host, created)
VALUES
  (now() - INTERVAL '91 days', 'retention-fixture', 999999, 500,
   'old', 'old.example.test', now() - INTERVAL '91 days');

-- Own statement, so later reads see the watchdog's side effects.
DO $run$
BEGIN
  PERFORM public.check_http_response_errors();
END
$run$;

SELECT is(
  (SELECT count(*)::integer
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203001),
  1,
  '4. the failing response is captured once'
);

SELECT is(
  (SELECT source
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203001),
  'check_http_response_errors'::text,
  '5. the snapshot records the firing watchdog as its source'
);

SELECT is(
  (SELECT status_code
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203001),
  503,
  '6. the snapshot preserves the failing status code'
);

SELECT is(
  (SELECT error_msg
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203001),
  'upstream failure'::text,
  '7. the snapshot preserves the pg_net error message'
);

SELECT is(
  (SELECT s.created
     FROM monitoring.pgnet_failure_snapshots s
    WHERE s.response_id = 203001),
  (SELECT r.created
     FROM net._http_response r
    WHERE r.id = 203001),
  '8. the snapshot preserves the response creation timestamp'
);

SELECT is(
  (SELECT url_host
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203001),
  'api.example.test'::text,
  '9. the URL is reduced to its host, without userinfo or port'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM monitoring.pgnet_failure_snapshots s
     WHERE s.response_id = 203001
       AND s.url_host !~* '(user|password|private|URL_SECRET|HEADER_SECRET|BODY_SECRET)'
       AND row_to_json(s)::text !~* '(URL_SECRET|HEADER_SECRET|BODY_SECRET)'
  ),
  '10. no full URL, headers, or response body is stored'
);

SELECT is(
  (SELECT count(*)::integer
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203002),
  0,
  '11. a 2xx response is not snapshotted'
);

SELECT is(
  (SELECT count(*)::integer
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 999999),
  0,
  '12. snapshots older than 90 days are removed'
);

DO $rerun$
BEGIN
  PERFORM public.check_http_response_errors();
END
$rerun$;

SELECT is(
  (SELECT count(*)::integer
     FROM monitoring.pgnet_failure_snapshots
    WHERE response_id = 203001),
  1,
  '13. repeated watchdog runs de-duplicate on response_id'
);

SELECT * FROM finish();
ROLLBACK;

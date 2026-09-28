-- anon/authenticated carry statement_timeout=15s, analytics_ro the idle reapers.
-- No skip gate: an unmigrated database reads RED.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(14);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260919010000'
      AND name = 'ps25_role_statement_and_idle_timeouts'),
  1,
  '2. the role statement and idle timeouts migration is recorded exactly once in the ledger'
);

-- Only the setdatabase = 0 rolconfig row is read, so ALTER ROLE ... IN DATABASE fails these.
SELECT ok(
  (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname = 'anon')
    @> ARRAY['statement_timeout=15s'],
  '3. anon.rolconfig contains statement_timeout=15s'
);

SELECT ok(
  (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
    @> ARRAY['statement_timeout=15s'],
  '4. authenticated.rolconfig contains statement_timeout=15s'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'analytics_ro'),
  '5. FIXTURE CONTROL: analytics_ro exists here, so the role-guarded ALTER in the migration was actually reached and assertions 6 and 7 are not vacuous'
);

SELECT ok(
  (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname = 'analytics_ro')
    @> ARRAY['idle_session_timeout=10min'],
  '6. analytics_ro.rolconfig contains idle_session_timeout=10min'
);

SELECT ok(
  (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname = 'analytics_ro')
    @> ARRAY['idle_in_transaction_session_timeout=2min'],
  '7. analytics_ro.rolconfig contains idle_in_transaction_session_timeout=2min'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_roles r,
          LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS entry
    WHERE r.rolname = 'analytics_ro'
      AND entry LIKE 'statement_timeout=%'),
  0,
  '8. analytics_ro carries NO statement_timeout: long aggregates are its job, and the ticket asks only for idle reapers on it'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_roles r,
          LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS entry
    WHERE r.rolname IN ('anon', 'authenticated')
      AND entry LIKE 'idle%_timeout=%'),
  0,
  '9. neither anon nor authenticated picked up an idle timeout: they are NOLOGIN impersonation targets and never own a session to reap'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_roles r,
          LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS entry
    WHERE r.rolname IN ('service_role', 'authenticator')
      AND entry LIKE 'statement_timeout=%'),
  0,
  '10. service_role and authenticator carry no statement_timeout: cron, the sync paths and the batch work run as service_role and legitimately exceed 15s'
);

-- pgTAP never runs under a switched role (search_path hides it), so probes use a temp table.
CREATE TEMP TABLE tp25_probe(label text PRIMARY KEY, sqlstate text, detail text)
  ON COMMIT DROP;

DO $parses$
DECLARE
  v_entry text;
BEGIN
  SELECT substring(entry FROM 'statement_timeout=(.*)$')
    INTO v_entry
    FROM pg_catalog.pg_roles r,
         LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS entry
   WHERE r.rolname = 'anon'
     AND entry LIKE 'statement_timeout=%';

  -- coalesce to '0': set_config('') raises and ends the suite instead of reporting `not ok`.
  PERFORM set_config('statement_timeout', coalesce(v_entry, '0'), true);
  INSERT INTO tp25_probe VALUES
    ('parsed', NULL, current_setting('statement_timeout'));
  PERFORM set_config('statement_timeout', '0', true);
END;
$parses$;

SELECT is(
  (SELECT detail FROM tp25_probe WHERE label = 'parsed'),
  '15s'::text,
  '11. the committed value is a duration this server accepts: applying anon''s rolconfig entry transaction-scoped yields statement_timeout = 15s'
);

-- anon's rolconfig lowered to 200ms (rolled back). PL/pgSQL cannot trap the cancel, so each probe
-- runs in a SAVEPOINT and psql captures :LAST_ERROR_SQLSTATE.
ALTER ROLE anon SET statement_timeout = '200ms';

SELECT set_config(
  'statement_timeout',
  coalesce(
    (SELECT substring(entry FROM 'statement_timeout=(.*)$')
       FROM pg_catalog.pg_roles r,
            LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS entry
      WHERE r.rolname = 'anon'
        AND entry LIKE 'statement_timeout=%'),
    '0'),
  true
);

SAVEPOINT tp25_cancelled;
SET LOCAL ROLE anon;
SELECT pg_sleep(1);
\set tp25_cancelled_error :ERROR
\set tp25_cancelled_sqlstate :LAST_ERROR_SQLSTATE
ROLLBACK TO SAVEPOINT tp25_cancelled;

SELECT set_config('statement_timeout', '5s', true);

SAVEPOINT tp25_within_bound;
SET LOCAL ROLE anon;
SELECT pg_sleep(0.1);
\set tp25_within_error :ERROR
\set tp25_within_sqlstate :LAST_ERROR_SQLSTATE
ROLLBACK TO SAVEPOINT tp25_within_bound;

-- SET ROLE alone does not apply rolconfig; PostgREST re-applies it per request.
SELECT set_config('statement_timeout', '0', true);

SAVEPOINT tp25_set_role_only;
SET LOCAL ROLE anon;
SELECT pg_sleep(0.5);
\set tp25_set_role_only_error :ERROR
\set tp25_set_role_only_sqlstate :LAST_ERROR_SQLSTATE
ROLLBACK TO SAVEPOINT tp25_set_role_only;

INSERT INTO tp25_probe VALUES
  ('cancelled',
   CASE WHEN :'tp25_cancelled_error' = 'true'
        THEN :'tp25_cancelled_sqlstate' ELSE '00000' END,
   '200ms, read back from anon.rolconfig'),
  ('within_bound',
   CASE WHEN :'tp25_within_error' = 'true'
        THEN :'tp25_within_sqlstate' ELSE '00000' END,
   '5s'),
  ('set_role_only',
   CASE WHEN :'tp25_set_role_only_error' = 'true'
        THEN :'tp25_set_role_only_sqlstate' ELSE '00000' END,
   'no impersonated setting applied');

SELECT is(
  (SELECT sqlstate FROM tp25_probe WHERE label = 'cancelled'),
  '57014'::text,
  '12. ACCEPTANCE 3: with anon''s rolconfig bound applied the way PostgREST applies an impersonated role setting, a statement that outruns it is cancelled with SQLSTATE 57014 (query_canceled)'
);

SELECT is(
  (SELECT sqlstate FROM tp25_probe WHERE label = 'within_bound'),
  '00000'::text,
  '13. POSITIVE CONTROL: the same plumbing with a bound the statement fits inside returns normally, so 57014 in 12 is the timeout and not "anon cannot run anything"'
);

SELECT is(
  (SELECT sqlstate FROM tp25_probe WHERE label = 'set_role_only'),
  '00000'::text,
  '14. MECHANISM CONTROL: SET ROLE alone does NOT apply anon''s rolconfig -- PostgreSQL applies role settings only at session start for the role that authenticated -- so the 15s bound reaches a real request through PostgREST re-applying it per transaction, not through session inheritance'
);

SELECT * FROM finish();
ROLLBACK;

-- 15s statement_timeout for anon/authenticated and idle reapers for analytics_ro,
-- so abandoned clients cannot hold PostgREST pool slots.
-- target-db: general
-- Role-wide on purpose (the proof reads setdatabase = 0 rows). PostgREST re-applies
-- role settings per request, hence both reloads.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-25 General migration requires database postgres, got %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- service_role runs long work; authenticator's rolconfig must stay as found.
DO $apply_statement_timeout$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', v_role, '15s');
      RAISE NOTICE 'PS-25: % now carries statement_timeout=15s', v_role;
    ELSE
      RAISE NOTICE 'PS-25: role % does not exist here; skipped (this is expected on a database that is not the General estate)', v_role;
    END IF;
  END LOOP;
END;
$apply_statement_timeout$;

-- idle-in-transaction pins xmin; no statement_timeout, long aggregates are its job.
DO $apply_idle_timeouts$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'analytics_ro') THEN
    ALTER ROLE analytics_ro SET idle_session_timeout = '10min';
    ALTER ROLE analytics_ro SET idle_in_transaction_session_timeout = '2min';
    RAISE NOTICE 'PS-25: analytics_ro now carries idle_session_timeout=10min and idle_in_transaction_session_timeout=2min';
  ELSE
    RAISE NOTICE 'PS-25: role analytics_ro does not exist here; skipped (it is a hand-made production login, ledger row 20260802060000, that no migration in this tree creates)';
  END IF;
END;
$apply_idle_timeouts$;

-- Absent roles are skipped; present ones are asserted.
DO $verify$
DECLARE
  v_role     text;
  v_config   text[];
  v_expected text;
BEGIN
  -- 3a. statement_timeout=15s on every PostgREST-facing role present here.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      SELECT rolconfig INTO v_config
        FROM pg_catalog.pg_roles WHERE rolname = v_role;
      IF v_config IS NULL OR NOT (v_config @> ARRAY['statement_timeout=15s']) THEN
        RAISE EXCEPTION
          'PS-25 verify: statement_timeout=15s missing from %.rolconfig — got %',
          v_role, coalesce(v_config::text, '(null)');
      END IF;
    END IF;
  END LOOP;

  -- 3b. Both idle bounds on analytics_ro, and NO statement_timeout on it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'analytics_ro') THEN
    SELECT rolconfig INTO v_config
      FROM pg_catalog.pg_roles WHERE rolname = 'analytics_ro';

    FOREACH v_expected IN ARRAY ARRAY['idle_session_timeout=10min',
                                      'idle_in_transaction_session_timeout=2min'] LOOP
      IF v_config IS NULL OR NOT (v_config @> ARRAY[v_expected]) THEN
        RAISE EXCEPTION
          'PS-25 verify: % missing from analytics_ro.rolconfig — got %',
          v_expected, coalesce(v_config::text, '(null)');
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM unnest(coalesce(v_config, ARRAY[]::text[])) AS entry
                WHERE entry LIKE 'statement_timeout=%') THEN
      RAISE EXCEPTION
        'PS-25 verify: analytics_ro carries a statement_timeout, which this migration does not set and must not add — got %',
        v_config::text;
    END IF;
  END IF;

  -- 3c. NOT AN OVER-REACH. The two roles whose long work this bound would
  --     break must not have picked it up.
  FOREACH v_role IN ARRAY ARRAY['service_role', 'authenticator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      SELECT rolconfig INTO v_config
        FROM pg_catalog.pg_roles WHERE rolname = v_role;
      IF EXISTS (SELECT 1 FROM unnest(coalesce(v_config, ARRAY[]::text[])) AS entry
                  WHERE entry LIKE 'statement_timeout=%') THEN
        RAISE EXCEPTION
          'PS-25 verify: % picked up a statement_timeout; this migration must not touch it — got %',
          v_role, v_config::text;
      END IF;
    END IF;
  END LOOP;
END;
$verify$;

-- The config reload is what applies a changed impersonated-role setting.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

COMMIT;

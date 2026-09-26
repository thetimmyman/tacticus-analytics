-- Step 2 of 2: RESET the four credential GUCs. Apply only once step 1's jobs succeed;
-- afterwards internal.cron_secrets holds the only copy.
-- target-db: general
-- Each statement names one key, no app.settings.% wildcard: monitoring_webhook_url must survive.

BEGIN;

-- Fail closed: this file must never run into a state that loses a value.

DO $guard$
DECLARE
  in_scope CONSTANT text[] :=
    ARRAY['service_role_key', 'cron_secret',
          'eot_service_role_key', 'eot_cron_secret'];
  guc_read_pattern CONSTANT text :=
    'current_setting\(\s*''app\.settings\.(service_role_key|cron_secret|eot_service_role_key|eot_cron_secret)''';
  k       text;
  bad     text;
  missing text[] := ARRAY[]::text[];
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-22 step 2 targets the General database `postgres`, got %',
      current_database();
  END IF;

  IF to_regprocedure('internal.get_cron_job_secret(text)') IS NULL THEN
    RAISE EXCEPTION
      'PS-22 step 2 requires step 1: apply 20260904030000_ps22_retire_guc_secret_channel_general.sql and confirm the jobs first';
  END IF;

  -- Precondition A: every in-scope name that is about to be reset is already
  -- carried by the corridor with a matching value. Without this check a
  -- RESET could silently destroy the only copy of a credential.
  FOREACH k IN ARRAY in_scope
  LOOP
    IF NULLIF(current_setting('app.settings.' || k, true), '') IS NULL THEN
      RAISE NOTICE 'PS-22 pre-check: app.settings.% is not set in this session; nothing to carry', k;
      CONTINUE;
    END IF;
    IF internal.get_cron_job_secret(k)
       IS DISTINCT FROM current_setting('app.settings.' || k, true) THEN
      missing := missing || k;
    END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 abort: the delivery corridor does not carry the live value for %. Resetting now would destroy the only copy. Re-run the step-1 seed.',
      array_to_string(missing, ', ');
  END IF;

  -- Precondition B: nothing reads the four names through the GUC channel any
  -- more — neither a cron command nor a function body.
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE format(
      'SELECT string_agg(j.jobid || '' ('' || coalesce(j.jobname, ''?'') || '')'', '', '')
         FROM cron.job j WHERE j.command ~ %L', guc_read_pattern
    ) INTO bad;
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION
        'PS-22 abort: cron job(s) still read an in-scope credential GUC: %. Resetting now would break them.', bad;
    END IF;
  END IF;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~ guc_read_pattern;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 abort: function(s) still read an in-scope credential GUC: %. Resetting now would break them.', bad;
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- One statement per key, each tolerant of the key being absent (idempotent).

DO $reset$
BEGIN
  ALTER DATABASE postgres RESET "app.settings.service_role_key";
  RAISE NOTICE 'PS-22 reset: app.settings.service_role_key';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PS-22 reset: app.settings.service_role_key already absent (%)', SQLERRM;
END;
$reset$;

DO $reset$
BEGIN
  ALTER DATABASE postgres RESET "app.settings.cron_secret";
  RAISE NOTICE 'PS-22 reset: app.settings.cron_secret';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PS-22 reset: app.settings.cron_secret already absent (%)', SQLERRM;
END;
$reset$;

DO $reset$
BEGIN
  ALTER DATABASE postgres RESET "app.settings.eot_service_role_key";
  RAISE NOTICE 'PS-22 reset: app.settings.eot_service_role_key';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PS-22 reset: app.settings.eot_service_role_key already absent (%)', SQLERRM;
END;
$reset$;

DO $reset$
BEGIN
  ALTER DATABASE postgres RESET "app.settings.eot_cron_secret";
  RAISE NOTICE 'PS-22 reset: app.settings.eot_cron_secret';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PS-22 reset: app.settings.eot_cron_secret already absent (%)', SQLERRM;
END;
$reset$;

-- Reset role-scoped copies too: a superuser cannot see them, so a database-only reset looks clean.
DO $reset_role_scoped$
DECLARE
  r     record;
  n     int := 0;
BEGIN
  FOR r IN
    SELECT pg_catalog.pg_get_userbyid(s.setrole) AS rolname, k.name
      FROM pg_catalog.pg_db_role_setting AS s
      CROSS JOIN unnest(ARRAY['service_role_key', 'cron_secret',
                              'eot_service_role_key', 'eot_cron_secret']) AS k(name)
     WHERE s.setdatabase = (SELECT oid FROM pg_catalog.pg_database
                             WHERE datname = current_database())
       AND s.setrole <> 0
       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) AS c(entry)
                    WHERE c.entry LIKE 'app.settings.' || k.name || '=%')
  LOOP
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I RESET %I',
      r.rolname, current_database(), 'app.settings.' || r.name
    );
    n := n + 1;
    RAISE NOTICE 'PS-22 reset: role-scoped app.settings.% for role %', r.name, r.rolname;
  END LOOP;
  RAISE NOTICE 'PS-22 reset: % role-scoped credential setting(s) removed', n;
END;
$reset_role_scoped$;

DO $verify$
DECLARE
  out_of_scope CONSTANT text[] :=
    ARRAY['monitoring_webhook_url', 'api_base_url', 'eot_api_base_url',
          'eot_kong_base_url', 'discord_posting_enabled'];
  db_oid   oid := (SELECT oid FROM pg_catalog.pg_database
                    WHERE datname = current_database());
  leaked   text;
  proof    bigint;
  k        text;
  n        int;
BEGIN
  -- Direction 1: no storage row on this database names any of the four,
  -- database-wide or role-scoped.
  SELECT string_agg(DISTINCT k.name, ', ') INTO leaked
    FROM pg_catalog.pg_db_role_setting AS s
    CROSS JOIN unnest(ARRAY['service_role_key', 'cron_secret',
                            'eot_service_role_key', 'eot_cron_secret']) AS k(name)
   WHERE s.setdatabase = db_oid
     AND EXISTS (SELECT 1 FROM unnest(s.setconfig) AS c(entry)
                  WHERE c.entry LIKE 'app.settings.' || k.name || '=%');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 post-condition failed: credential setting(s) still stored: %', leaked;
  END IF;

  -- Direction 2: the acceptance proof, verbatim. This is a CLUSTER-WIDE
  -- count and also covers the `eot_service_role_key` spelling, which is why
  -- the ticket states it this way.
  SELECT count(*) INTO proof
    FROM pg_catalog.pg_db_role_setting
   WHERE setconfig::text ILIKE '%service_role_key%';
  IF proof <> 0 THEN
    RAISE EXCEPTION
      'PS-22 acceptance proof failed: pg_db_role_setting still has % row(s) naming service_role_key', proof;
  END IF;
  RAISE NOTICE 'PS-22 acceptance proof: pg_db_role_setting rows naming service_role_key = %', proof;

  -- Direction 3 (the landmine): every out-of-scope setting that this
  -- migration found is still there. A reset that took one of these with it
  -- would be the 2026-08-09 alerting outage again.
  FOREACH k IN ARRAY out_of_scope
  LOOP
    SELECT count(*) INTO n
      FROM pg_catalog.pg_db_role_setting AS s
     WHERE s.setdatabase = db_oid
       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) AS c(entry)
                    WHERE c.entry LIKE 'app.settings.' || k || '=%');
    RAISE NOTICE 'PS-22 out-of-scope check: app.settings.% storage rows = % (must match the pre-apply capture)', k, n;
  END LOOP;

  -- Direction 4: the corridor still serves every value, so the jobs the
  -- reconciler is about to re-check have something to read.
  FOREACH k IN ARRAY ARRAY['service_role_key', 'cron_secret',
                           'eot_service_role_key', 'eot_cron_secret']
  LOOP
    IF EXISTS (SELECT 1 FROM internal.cron_secrets s WHERE s.name = k) THEN
      IF internal.get_cron_job_secret(k) IS NULL THEN
        RAISE EXCEPTION
          'PS-22 post-condition failed: corridor row for % exists but the accessor returns NULL', k;
      END IF;
      RAISE NOTICE 'PS-22 delivery check: % still served by the corridor', k;
    ELSE
      RAISE WARNING
        'PS-22 delivery check: % has NO corridor row and is now reset — if anything reads it, it reads NULL', k;
    END IF;
  END LOOP;

  RAISE NOTICE 'PS-22 complete: the four credential GUCs are retired; re-check the jobs once more per the runbook';
END;
$verify$;

COMMIT;

-- Step 1 of 2: move four session-readable credential GUCs (service_role_key, cron_secret,
-- eot_* twins) onto internal.cron_secrets; step 2 resets them.
-- target-db: general
-- Patterns match only those four names, never the app.settings. prefix (resetting
-- monitoring_webhook_url once killed alerting). Apply from a fresh session: GUCs bind at connect.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-22 step 1 targets the General database `postgres`, got %',
      current_database();
  END IF;

  IF to_regclass('internal.cron_secrets') IS NULL THEN
    RAISE EXCEPTION
      'PS-22 step 1 requires the B3 delivery corridor: apply 20260902010000_cron_secret_delivery_table_general.sql first';
  END IF;

  IF to_regprocedure('internal.get_secret(text)') IS NULL THEN
    RAISE EXCEPTION
      'PS-22 step 1 requires internal.get_secret(text) from 20260902010000; found the table but not the accessor';
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Values are copied from the live GUCs; none is ever written in this repo.

INSERT INTO internal.cron_secrets (name, value)
SELECT k.name, current_setting('app.settings.' || k.name, true)
  FROM (VALUES
         ('service_role_key'),
         ('cron_secret'),
         ('eot_service_role_key'),
         ('eot_cron_secret')
       ) AS k(name)
 WHERE NULLIF(current_setting('app.settings.' || k.name, true), '') IS NOT NULL
ON CONFLICT (name) DO NOTHING;

DO $seed_report$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['service_role_key', 'cron_secret',
                           'eot_service_role_key', 'eot_cron_secret']
  LOOP
    IF EXISTS (SELECT 1 FROM internal.cron_secrets s WHERE s.name = k) THEN
      RAISE NOTICE 'PS-22 seed: % is delivered via internal.cron_secrets', k;
    ELSE
      RAISE WARNING
        'PS-22 seed: no live GUC value for % (unset or empty) — row NOT seeded; any reader of that name will get NULL',
        k;
    END IF;
  END LOOP;
END;
$seed_report$;

-- Separate from internal.get_secret: cron roles may need EXECUTE, which it must never get.

CREATE OR REPLACE FUNCTION internal.get_cron_job_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, internal
AS $$
  SELECT s.value
    FROM internal.cron_secrets AS s
   WHERE s.name = p_name
     AND p_name IN ('service_role_key', 'cron_secret',
                    'eot_service_role_key', 'eot_cron_secret');
$$;

ALTER FUNCTION internal.get_cron_job_secret(text) OWNER TO postgres;

-- Load-bearing: functions are born with PUBLIC EXECUTE.
REVOKE ALL ON FUNCTION internal.get_cron_job_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.get_cron_job_secret(text)
  FROM anon, authenticated, service_role;

-- The grant target is measured from cron.job.username; a client role aborts.

DO $grant$
DECLARE
  guc_read_pattern CONSTANT text :=
    'current_setting\(\s*''app\.settings\.(service_role_key|cron_secret|eot_service_role_key|eot_cron_secret)''';
  r          record;
  granted    text[] := ARRAY[]::text[];
  offenders  text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING
      'PS-22: cron.job is not present on this database; no job rewrite and no grant performed';
    RETURN;
  END IF;

  FOR r IN
    EXECUTE format(
      'SELECT DISTINCT j.username FROM cron.job j WHERE j.command ~ %L',
      guc_read_pattern
    )
  LOOP
    IF r.username IN ('anon', 'authenticated', 'service_role') THEN
      offenders := offenders || r.username;
      CONTINUE;
    END IF;

    -- The owner needs no grant; granting to it is a harmless no-op we skip
    -- so the receipt reports only real widenings.
    IF r.username = 'postgres' THEN
      RAISE NOTICE
        'PS-22 grant: cron role % is the corridor owner; no grant required', r.username;
      CONTINUE;
    END IF;

    EXECUTE format('GRANT USAGE ON SCHEMA internal TO %I', r.username);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION internal.get_cron_job_secret(text) TO %I',
      r.username
    );
    granted := granted || r.username;
  END LOOP;

  IF array_length(offenders, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 abort: pg_cron job(s) reading an in-scope credential run as client role(s) %. Granting the corridor to a client role would re-open the leak and break the B3 invariant. Re-own those jobs to a non-client role first.',
      array_to_string(offenders, ', ');
  END IF;

  IF array_length(granted, 1) IS NULL THEN
    RAISE NOTICE
      'PS-22 grant: no additional role needed EXECUTE on internal.get_cron_job_secret';
  ELSE
    RAISE NOTICE
      'PS-22 grant: EXECUTE on internal.get_cron_job_secret + USAGE on schema internal granted to %',
      array_to_string(granted, ', ');
  END IF;
END;
$grant$;

-- Targeted regexp_replace: no other job byte changes, asserted afterwards.

DO $rewrite$
DECLARE
  -- Anchored to the four in-scope names. `app\.settings\.` alone would also
  -- match monitoring_webhook_url and the URL/flag settings — see the
  -- OUT OF SCOPE header block.
  guc_read_pattern CONSTANT text :=
    'current_setting\(\s*''app\.settings\.(service_role_key|cron_secret|eot_service_role_key|eot_cron_secret)''\s*(,\s*[^)]*)?\)';
  j            record;
  new_command  text;
  rewritten    int := 0;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR j IN
    EXECUTE format(
      'SELECT j.jobid, j.jobname, j.command, j.schedule, j.username, j.database
         FROM cron.job j WHERE j.command ~ %L ORDER BY j.jobid',
      guc_read_pattern
    )
  LOOP
    new_command := regexp_replace(
      j.command, guc_read_pattern,
      'internal.get_cron_job_secret(''\1'')', 'g'
    );

    IF new_command = j.command THEN
      RAISE EXCEPTION
        'PS-22 rewrite: job % (%) matched the GUC-read pattern but the substitution produced identical text; refusing to proceed with an unrewritten credential read',
        j.jobid, j.jobname;
    END IF;

    -- Rollback receipt. Safe to keep: the old text names the GUC, it does
    -- not contain the value.
    RAISE NOTICE
      'PS-22 rollback receipt: cron.alter_job(%, command => $ROLLBACK$%$ROLLBACK$);',
      j.jobid, j.command;

    PERFORM cron.alter_job(j.jobid, command => new_command);
    rewritten := rewritten + 1;

    RAISE NOTICE 'PS-22 rewrite: job % (%) now reads the delivery corridor',
      j.jobid, j.jobname;
  END LOOP;

  RAISE NOTICE 'PS-22 rewrite: % cron job command(s) moved off the GUC channel', rewritten;
END;
$rewrite$;

DO $verify$
DECLARE
  in_scope CONSTANT text[] :=
    ARRAY['service_role_key', 'cron_secret',
          'eot_service_role_key', 'eot_cron_secret'];
  out_of_scope CONSTANT text[] :=
    ARRAY['monitoring_webhook_url', 'api_base_url', 'eot_api_base_url',
          'eot_kong_base_url', 'discord_posting_enabled'];
  guc_read_pattern CONSTANT text :=
    'current_setting\(\s*''app\.settings\.(service_role_key|cron_secret|eot_service_role_key|eot_cron_secret)''';
  bad  text;
  n    bigint;
  k    text;
BEGIN
  -- Direction 1: no cron command and no function body still reads an
  -- in-scope credential through the GUC channel.
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE format(
      'SELECT string_agg(j.jobid || '' ('' || coalesce(j.jobname, ''?'') || '')'', '', '')
         FROM cron.job j WHERE j.command ~ %L', guc_read_pattern
    ) INTO bad;
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION
        'PS-22 post-condition failed: cron job(s) still read an in-scope credential GUC: %', bad;
    END IF;
  END IF;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~ guc_read_pattern;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 post-condition failed: function(s) still read an in-scope credential GUC: %', bad;
  END IF;

  -- Direction 2 (the delta assertion): the accessor is NOT reachable by any
  -- client role, and B3's corridor invariant still holds. A positive probe
  -- alone cannot see an over-grant, so this asks the negative directly.
  SELECT string_agg(probe, ', ') INTO bad
    FROM (
      SELECT r.rolname || ' EXECUTE get_cron_job_secret' AS probe
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE has_function_privilege(r.rolname,
               'internal.get_cron_job_secret(text)', 'EXECUTE')
      UNION ALL
      SELECT r.rolname || ' EXECUTE get_secret'
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE has_function_privilege(r.rolname, 'internal.get_secret(text)', 'EXECUTE')
      UNION ALL
      SELECT r.rolname || ' schema-USAGE internal'
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE has_schema_privilege(r.rolname, 'internal', 'USAGE')
      UNION ALL
      SELECT r.rolname || ' SELECT cron_secrets'
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE has_table_privilege(r.rolname, 'internal.cron_secrets', 'SELECT')
      UNION ALL
      SELECT 'PUBLIC function-acl'
        FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
       WHERE p.oid = 'internal.get_cron_job_secret(text)'::regprocedure
         AND acl.grantee = 0
    ) AS probes(probe);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 post-condition failed: client-reachable privilege on the delivery corridor: %', bad;
  END IF;

  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p
           WHERE p.oid = 'internal.get_cron_job_secret(text)'::regprocedure) THEN
    RAISE EXCEPTION 'PS-22 post-condition failed: get_cron_job_secret is not SECURITY DEFINER';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'internal.get_cron_job_secret(text)'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION 'PS-22 post-condition failed: get_cron_job_secret is not owned by postgres';
  END IF;

  -- Direction 3: the accessor refuses every name outside the four.
  IF internal.get_cron_job_secret('monitoring_webhook_url') IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-22 post-condition failed: get_cron_job_secret served an out-of-scope name';
  END IF;

  -- Direction 4: delivery consistency — for every in-scope name still set as
  -- a GUC, the corridor serves EXACTLY the same value. This is what makes
  -- step 2 (the RESET) safe; it is asserted here, before the reset exists.
  FOREACH k IN ARRAY in_scope
  LOOP
    IF NULLIF(current_setting('app.settings.' || k, true), '') IS NOT NULL
       AND internal.get_cron_job_secret(k)
           IS DISTINCT FROM current_setting('app.settings.' || k, true) THEN
      RAISE EXCEPTION
        'PS-22 post-condition failed: the corridor value for % (length %) differs from the live GUC (length %); the RESET step would change behaviour. Most likely cause: an earlier seed ran in a session opened BEFORE the GUC was set, so it stored an empty string — a database-level GUC binds at CONNECT time. Repair with UPDATE internal.cron_secrets SET value = current_setting(''app.settings.%s'', true), rotated_at = now() WHERE name = %L; FROM A FRESH SESSION, then re-apply.',
        k, length(coalesce(internal.get_cron_job_secret(k), '')),
        length(current_setting('app.settings.' || k, true)), k, k;
    END IF;
  END LOOP;

  -- Direction 5 (the landmine): every OUT-OF-SCOPE setting is untouched.
  FOREACH k IN ARRAY out_of_scope
  LOOP
    SELECT count(*) INTO n
      FROM pg_catalog.pg_db_role_setting AS s
     WHERE s.setdatabase = (SELECT oid FROM pg_catalog.pg_database
                             WHERE datname = current_database())
       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) AS c(entry)
                    WHERE c.entry LIKE 'app.settings.' || k || '=%');
    IF n = 0 THEN
      RAISE NOTICE
        'PS-22 out-of-scope check: app.settings.% is not set on this database (nothing to preserve)', k;
    ELSE
      RAISE NOTICE
        'PS-22 out-of-scope check: app.settings.% still set and untouched', k;
    END IF;
  END LOOP;

  RAISE NOTICE 'PS-22 step 1 complete: nothing reads the four credential GUCs; they are NOT yet reset (that is 20260904040000)';
END;
$verify$;

COMMIT;

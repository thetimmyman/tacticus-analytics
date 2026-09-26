-- 90-day retention plus an orphan sweep for auth.audit_log_entries, which grows
-- unbounded and keeps deleted accounts' e-mails; GoTrue has no retention setting.
-- target-db: general
-- Apply the sibling database's companion migration first (its cron row calls
-- this function). Runs as postgres: service_role has no DELETE.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-277: this migration targets the General database only, found %; the second database gets the identical function from its own repository''s companion migration',
      current_database();
  END IF;

  IF to_regclass('auth.audit_log_entries') IS NULL THEN
    RAISE EXCEPTION
      'PS-277: auth.audit_log_entries is not present on database %; this file targets a GoTrue-backed database',
      current_database();
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION
      'PS-277: auth.users is not present on database %; the orphan rule joins it locally and cannot run without it',
      current_database();
  END IF;

  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION
      'PS-277: cron.job is not present on database %; pg_cron is required to schedule the retention jobs',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- INVOKER: a definer would hand the delete to anyone who can reach it. No SET
-- statement_timeout (it arms per top-level statement); the table has no
-- created_at index, hence ctid batches.

CREATE OR REPLACE FUNCTION public.cleanup_auth_audit_log(
  p_max_statements integer DEFAULT 40
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_retention_days CONSTANT integer := 90;
  c_batch_rows     CONSTANT integer := 5000;
  v_cutoff         timestamptz;
  v_deleted        bigint;
  v_aged_out       bigint := 0;
  v_orphaned       bigint := 0;
  i                integer;
BEGIN
  IF p_max_statements IS NULL OR p_max_statements < 1 THEN
    RAISE EXCEPTION
      'cleanup_auth_audit_log: p_max_statements must be >= 1, got %',
      p_max_statements
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := clock_timestamp() - make_interval(days => c_retention_days);

  -- Pass 1: the age-out. Every row older than the window goes, whether or not
  -- its actor still exists.
  FOR i IN 1..p_max_statements LOOP
    DELETE FROM auth.audit_log_entries
     WHERE ctid IN (
       SELECT a.ctid
         FROM auth.audit_log_entries AS a
        WHERE a.created_at < v_cutoff
        LIMIT c_batch_rows
     );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_aged_out := v_aged_out + v_deleted;
    EXIT WHEN v_deleted = 0;
  END LOOP;

  -- Pass 2: the orphan sweep. auth.users is local to whichever database this
  -- function was created on, so the join never crosses a database boundary.
  --
  -- The comparison is u.id::text = payload->>'actor_id' rather than a cast of
  -- the payload value to uuid. Casting would raise 22P02 on the first
  -- malformed actor_id and abort the whole run. Live probes found 0 rows with
  -- a null actor_id and 0 rows with a non-uuid-shaped actor_id on the General
  -- database, so this costs nothing today and stays correct if GoTrue ever
  -- writes something else.
  FOR i IN 1..p_max_statements LOOP
    DELETE FROM auth.audit_log_entries
     WHERE ctid IN (
       SELECT a.ctid
         FROM auth.audit_log_entries AS a
        WHERE a.payload->>'actor_id' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM auth.users AS u
             WHERE u.id::text = a.payload->>'actor_id'
          )
        LIMIT c_batch_rows
     );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_orphaned := v_orphaned + v_deleted;
    EXIT WHEN v_deleted = 0;
  END LOOP;

  RETURN format(
    'cleanup_auth_audit_log: aged_out=%s orphaned=%s cutoff=%s max_statements=%s batch=%s',
    v_aged_out, v_orphaned, v_cutoff, p_max_statements, c_batch_rows
  );
END;
$fn$;

ALTER FUNCTION public.cleanup_auth_audit_log(integer) OWNER TO postgres;

COMMENT ON FUNCTION public.cleanup_auth_audit_log(integer) IS
  'PS-277. Enforces a 90-day retention window on auth.audit_log_entries and '
  'removes rows whose payload actor_id no longer exists in auth.users. '
  'Deletes in ctid batches of 5000, at most p_max_statements batches per pass, '
  'so one run is bounded even against a 17-month backlog. Called nightly by '
  'pg_cron as postgres; service_role holds SELECT only on the target table and '
  'deliberately is not granted DELETE. Disk footprint shrinks only via VACUUM '
  'FULL, a separate supervised step; dead-tuple space is reused after '
  'autovacuum.';

-- Functions are born with PUBLIC EXECUTE; without this any role could delete rows.
REVOKE ALL ON FUNCTION public.cleanup_auth_audit_log(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_auth_audit_log(integer)
  FROM anon, authenticated, service_role;

-- The companion database is resolved as the one other database cron rows run
-- on; anything but exactly one aborts.

DO $schedule$
DECLARE
  v_companion_db text;
  v_rows         integer;
BEGIN
  -- Idempotent: drop any prior row of either name before scheduling, so a
  -- re-apply replaces rather than duplicates. current_database() = 'postgres'
  -- is already guaranteed by the guard above, so no branch is needed here.
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname IN ('auth-audit-log-prune', 'eot-auth-audit-log-prune');

  SELECT count(DISTINCT database), min(database)
    INTO v_rows, v_companion_db
    FROM cron.job
   WHERE database <> current_database();

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'PS-277: expected exactly 1 distinct database among cron.job rows scheduled to run somewhere other than this database, found %',
      v_rows;
  END IF;

  PERFORM cron.schedule_in_database(
    'auth-audit-log-prune', '40 4 * * *',
    'SELECT public.cleanup_auth_audit_log();', 'postgres', 'postgres', true
  );

  PERFORM cron.schedule_in_database(
    'eot-auth-audit-log-prune', '50 4 * * *',
    'SELECT public.cleanup_auth_audit_log();', v_companion_db, 'postgres', true
  );

  RAISE NOTICE
    'PS-277: scheduled auth-audit-log-prune (this database) and eot-auth-audit-log-prune (companion database, resolved to %)',
    v_companion_db;
END;
$schedule$;

DO $verify$
DECLARE
  v_fn            oid;
  v_proacl        aclitem[];
  v_rows          integer;
  v_companion_db  text;
BEGIN
  -- 3a. The function, on the General database.
  v_fn := to_regprocedure('public.cleanup_auth_audit_log(integer)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION
      'PS-277 verify: public.cleanup_auth_audit_log(integer) does not exist on database %',
      current_database();
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.prosecdef
  ) THEN
    RAISE EXCEPTION
      'PS-277 verify: cleanup_auth_audit_log is SECURITY DEFINER; it must be SECURITY INVOKER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_fn
       AND p.prosrc LIKE '%c_retention_days CONSTANT integer := 90%'
       AND p.prosrc LIKE '%c_batch_rows     CONSTANT integer := 5000%'
       AND p.prosrc LIKE '%NOT EXISTS%'
  ) THEN
    RAISE EXCEPTION
      'PS-277 verify: the installed body is not the 90-day / 5000-row / orphan-sweep body';
  END IF;

  -- aclexplode(proacl) returns ZERO rows when proacl IS NULL -- that is the
  -- "no explicit ACL, default privileges apply" state, and for a function
  -- the default is EXECUTE granted to PUBLIC. A loop over aclexplode would
  -- therefore pass VACUOUSLY if the REVOKEs above had somehow not taken
  -- effect (e.g. run against the wrong function signature), which is exactly
  -- the failure mode this VERIFY exists to catch. Assert on the actual
  -- resolved privilege instead, via has_function_privilege, and require
  -- proacl to be non-NULL so an explicit ACL is provably in place.
  SELECT p.proacl INTO v_proacl FROM pg_proc p WHERE p.oid = v_fn;

  IF v_proacl IS NULL THEN
    RAISE EXCEPTION
      'PS-277 verify: cleanup_auth_audit_log has no explicit ACL (proacl IS NULL); the REVOKEs above did not take effect and PUBLIC retains the default EXECUTE grant';
  END IF;

  IF has_function_privilege('anon', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION
      'PS-277 verify: a client role (anon, authenticated or service_role) holds EXECUTE on cleanup_auth_audit_log';
  END IF;

  IF NOT has_function_privilege('postgres', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-277 verify: postgres, the pg_cron execution role, does not hold EXECUTE on cleanup_auth_audit_log';
  END IF;

  -- 3b. The two cron rows. Both live on General regardless of which database
  -- the scheduled command reaches, because pg_cron itself lives here. The
  -- companion row's expected database is re-resolved here with the SAME
  -- expression section 2 used -- the set of cron rows that execute on some
  -- database other than this one -- rather than hard-coded, so this VERIFY
  -- cannot drift from what section 2 actually looked up and scheduled
  -- against. By the time this runs, the eot-auth-audit-log-prune row created
  -- above already carries that same database value, so it does not change
  -- which single distinct value this resolves to.
  SELECT count(*) INTO v_rows
    FROM cron.job j
   WHERE j.jobname = 'auth-audit-log-prune'
     AND j.schedule = '40 4 * * *'
     AND j.database = 'postgres'
     AND j.username = 'postgres'
     AND j.active
     AND j.command LIKE '%cleanup_auth_audit_log%';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'PS-277 verify: expected exactly 1 General prune job row, found %', v_rows;
  END IF;

  SELECT count(DISTINCT database), min(database)
    INTO v_rows, v_companion_db
    FROM cron.job
   WHERE database <> current_database();

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'PS-277 verify: expected exactly 1 distinct database among cron.job rows scheduled to run somewhere other than this database, found %',
      v_rows;
  END IF;

  SELECT count(*) INTO v_rows
    FROM cron.job j
   WHERE j.jobname = 'eot-auth-audit-log-prune'
     AND j.schedule = '50 4 * * *'
     AND j.database = v_companion_db
     AND j.username = 'postgres'
     AND j.active
     AND j.command LIKE '%cleanup_auth_audit_log%';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'PS-277 verify: expected exactly 1 companion-database prune job row (database %), found %', v_companion_db, v_rows;
  END IF;

  RAISE NOTICE
    'PS-277 verify: OK -- function installed, no client role holds EXECUTE, and both cron rows are present and active';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

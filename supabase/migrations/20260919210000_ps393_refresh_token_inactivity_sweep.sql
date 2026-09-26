-- Revoke refresh tokens idle 180+ days nightly; GoTrue never sweeps them. The
-- backlog is cleared by an operator run, not this migration.
-- target-db: general
-- DEFINER owned by postgres, so the function ACL is the boundary; only service_role executes.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-393: this migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

DO $precondition$
BEGIN
  IF to_regclass('auth.refresh_tokens') IS NULL THEN
    RAISE EXCEPTION
      'PS-393: auth.refresh_tokens does not exist on database %; this migration targets a GoTrue-backed database',
      current_database();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
       AND column_name = 'revoked'
  ) THEN
    RAISE EXCEPTION
      'PS-393: auth.refresh_tokens has no revoked column; the sweep predicate cannot be built';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
       AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION
      'PS-393: auth.refresh_tokens has no updated_at column; the sweep predicate cannot be built';
  END IF;
END;
$precondition$;

-- updated_at is not bumped, so sweeps stay distinguishable from GoTrue activity.

CREATE OR REPLACE FUNCTION public.revoke_stale_refresh_tokens(
  p_max_age interval DEFAULT '180 days'::interval
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_max_age IS NULL OR p_max_age <= interval '0' THEN
    RAISE EXCEPTION
      'revoke_stale_refresh_tokens: p_max_age must be a positive interval, got %',
      p_max_age
      USING ERRCODE = '22023';
  END IF;

  UPDATE auth.refresh_tokens
     SET revoked = true
   WHERE revoked = false
     AND updated_at < now() - p_max_age;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION public.revoke_stale_refresh_tokens(interval) OWNER TO postgres;

COMMENT ON FUNCTION public.revoke_stale_refresh_tokens(interval) IS
  'PS-393. Revokes every auth.refresh_tokens row that is revoked = false and '
  'whose updated_at is older than p_max_age (default 180 days). Returns the '
  'number of rows flipped. SECURITY DEFINER, owned by postgres -- see this '
  'migration''s PRIVILEGE ANALYSIS for why. Called nightly by pg_cron as '
  'postgres, and once by the operator after this migration applies to retire '
  'the pre-existing backlog: SELECT public.revoke_stale_refresh_tokens(); '
  'EXECUTE is revoked from PUBLIC, anon and authenticated.';

-- Functions are born with PUBLIC EXECUTE; it must never be anon-executable.
REVOKE ALL ON FUNCTION public.revoke_stale_refresh_tokens(interval)
  FROM PUBLIC, anon, authenticated;

-- Idempotent by jobname; re-run at another minute on collision. Guarded: replay has no pg_cron.

DO $schedule$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE
      'PS-393: pg_cron is not installed on database % -- revoke_stale_refresh_tokens() is created but NOT scheduled here. This is expected on the pgTAP replay lane and is a hard miss anywhere else.',
      current_database();
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT cron.unschedule(jobid) FROM cron.job
     WHERE jobname = 'refresh-token-inactivity-sweep'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'refresh-token-inactivity-sweep',
      '17 3 * * *',
      'SELECT public.revoke_stale_refresh_tokens();')
  $sql$;

  RAISE NOTICE 'PS-393: scheduled refresh-token-inactivity-sweep on %', current_database();
END;
$schedule$;

-- Never calls the sweep: that would be a live write during apply.

DO $verify$
DECLARE
  v_fn        oid;
  v_proacl    aclitem[];
  v_scheduled boolean;
BEGIN
  v_fn := to_regprocedure('public.revoke_stale_refresh_tokens(interval)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION
      'PS-393 verify: public.revoke_stale_refresh_tokens(interval) does not exist';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION
      'PS-393 verify: revoke_stale_refresh_tokens is not SECURITY DEFINER';
  END IF;

  -- The zero-argument call is what pg_cron issues (and what the operator's
  -- one-off call uses). If the default stops covering the sole parameter the
  -- scheduled sweep fails every run in silence.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_fn AND p.pronargdefaults = p.pronargs
  ) THEN
    RAISE EXCEPTION
      'PS-393 verify: revoke_stale_refresh_tokens() is not callable with zero arguments, so the cron command cannot run';
  END IF;

  SELECT p.proacl INTO v_proacl FROM pg_proc p WHERE p.oid = v_fn;
  IF v_proacl IS NULL THEN
    RAISE EXCEPTION
      'PS-393 verify: revoke_stale_refresh_tokens has no explicit ACL (proacl IS NULL); the REVOKE above did not take effect and PUBLIC retains the default EXECUTE grant';
  END IF;

  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
  THEN
    RAISE EXCEPTION
      'PS-393 verify: anon or authenticated holds EXECUTE on revoke_stale_refresh_tokens';
  END IF;

  IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-393 verify: postgres, the pg_cron execution role, does not hold EXECUTE on revoke_stale_refresh_tokens';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM cron.job
         WHERE jobname = 'refresh-token-inactivity-sweep'
           AND schedule = '17 3 * * *'
           AND active
           AND command LIKE '%revoke_stale_refresh_tokens%'
      )
    $sql$ INTO v_scheduled;
    IF NOT v_scheduled THEN
      RAISE EXCEPTION
        'PS-393 verify: refresh-token-inactivity-sweep is not scheduled -- an unwired sweep is an orphan';
    END IF;
  END IF;
END;
$verify$;

COMMIT;

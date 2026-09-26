-- Daily sweep erasing quarantined Discord identities whose account is gone, via
-- the existing single-row eraser.
-- target-db: general
-- The eraser is live-only, so it is called by name, never redefined; its absence
-- is tolerated where pg_cron is absent (replay).

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-398: this migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

DO $precondition$
BEGIN
  IF to_regclass('public.player_identity_quarantine_pii') IS NULL THEN
    RAISE EXCEPTION
      'PS-398: public.player_identity_quarantine_pii does not exist on database %; this migration has nothing to sweep',
      current_database();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'player_identity_quarantine_pii'
       AND column_name = 'prior_user_id'
  ) THEN
    RAISE EXCEPTION
      'PS-398: public.player_identity_quarantine_pii has no prior_user_id column; the orphan predicate cannot be built';
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION
      'PS-398: auth.users does not exist on database %; this migration targets a GoTrue-backed database',
      current_database();
  END IF;

  -- The replay exception is only for databases without pg_cron (the pgTAP
  -- replay lane), where nothing gets scheduled. Where pg_cron exists this
  -- migration schedules the sweep, and a sweep without its eraser would
  -- report success forever while erasing nothing, so that is fatal.
  IF to_regprocedure('public.erase_player_identity_quarantine_pii(uuid, text)') IS NULL
     AND to_regclass('cron.job') IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-398: public.erase_player_identity_quarantine_pii(uuid, text) is missing on database %, which has pg_cron; refusing to schedule a sweep that would erase nothing',
      current_database();
  END IF;
  IF to_regprocedure('public.erase_player_identity_quarantine_pii(uuid, text)') IS NULL THEN
    RAISE NOTICE
      'PS-398: public.erase_player_identity_quarantine_pii(uuid, text) is not present on database % -- the sweep wrapper is created but will erase nothing until it exists. Expected on the pgTAP replay lane; a hard miss on General.',
      current_database();
  END IF;
END;
$precondition$;

-- Each id in its own subtransaction so one failing gate does not stop the batch.
-- Owned by postgres to satisfy the eraser's current_user gate.

CREATE OR REPLACE FUNCTION public.sweep_orphaned_quarantine_pii()
RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  v_reason text :=
    'PS-398: scheduled sweep of orphaned quarantine PII (prior_user_id has no matching auth.users row)';
  v_row RECORD;
  v_erased integer := 0;
  v_skipped integer := 0;
BEGIN
  IF to_regprocedure('public.erase_player_identity_quarantine_pii(uuid, text)') IS NULL THEN
    RAISE NOTICE
      '[sweep_orphaned_quarantine_pii] public.erase_player_identity_quarantine_pii(uuid, text) is absent on database %; nothing erased this run',
      current_database();
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT q.quarantine_id
      FROM public.player_identity_quarantine_pii q
     WHERE q.prior_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = q.prior_user_id)
     ORDER BY q.quarantine_id
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.erase_player_identity_quarantine_pii(v_row.quarantine_id, v_reason);
      v_erased := v_erased + 1;
    EXCEPTION WHEN OTHERS THEN
      -- A row can legitimately fail here today (unrevoked attestation,
      -- unverified role-scope -- see gates 3-4 in the header) and become
      -- eligible on a later run once that state changes. One bad row must
      -- not stop the rest of the batch.
      v_skipped := v_skipped + 1;
      RAISE WARNING
        '[sweep_orphaned_quarantine_pii] could not erase %: %',
        v_row.quarantine_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE
    '[sweep_orphaned_quarantine_pii] erased=%, skipped=%', v_erased, v_skipped;
  RETURN v_erased;
EXCEPTION WHEN OTHERS THEN
  -- Belt-and-braces: nothing above this point should raise past the
  -- per-row handler, but a sweep that can fail pg_cron silently breaks the
  -- one control standing between this table and an unbounded orphan
  -- backlog. Mirrors record_sync_drain_run's own outer handler.
  RAISE WARNING '[sweep_orphaned_quarantine_pii] sweep error: %', SQLERRM;
  RETURN COALESCE(v_erased, 0);
END;
$$;

ALTER FUNCTION public.sweep_orphaned_quarantine_pii() OWNER TO postgres;

COMMENT ON FUNCTION public.sweep_orphaned_quarantine_pii() IS
  'PS-398. Calls public.erase_player_identity_quarantine_pii(uuid, text) once '
  'per orphaned public.player_identity_quarantine_pii row (prior_user_id set, '
  'no matching auth.users row). Returns the number actually erased; rows that '
  'fail the eraser''s own attestation/role-scope gates are skipped and logged, '
  'not fatal. Never raises to its caller. SECURITY DEFINER, owned by postgres. '
  'Called nightly by pg_cron, and once by the operator after this migration '
  'applies to retire the pre-existing backlog: '
  'SELECT public.sweep_orphaned_quarantine_pii(); '
  'EXECUTE is revoked from PUBLIC, anon and authenticated.';

-- Functions are born with PUBLIC EXECUTE; it must never be anon-executable.
REVOKE ALL ON FUNCTION public.sweep_orphaned_quarantine_pii()
  FROM PUBLIC, anon, authenticated;

-- Idempotent by jobname. Guarded: the replay lane has no pg_cron.

DO $schedule$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE
      'PS-398: pg_cron is not installed on database % -- sweep_orphaned_quarantine_pii() is created but NOT scheduled here. This is expected on the pgTAP replay lane and is a hard miss anywhere else.',
      current_database();
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT cron.unschedule(jobid) FROM cron.job
     WHERE jobname = 'quarantine-pii-orphan-sweep'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'quarantine-pii-orphan-sweep',
      '33 4 * * *',
      'SELECT public.sweep_orphaned_quarantine_pii();')
  $sql$;

  RAISE NOTICE 'PS-398: scheduled quarantine-pii-orphan-sweep on %', current_database();
END;
$schedule$;

-- Never calls the sweep: that would be a live write during apply.

DO $verify$
DECLARE
  v_fn        oid;
  v_proacl    aclitem[];
  v_scheduled boolean;
BEGIN
  v_fn := to_regprocedure('public.sweep_orphaned_quarantine_pii()');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'PS-398 verify: public.sweep_orphaned_quarantine_pii() does not exist';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION 'PS-398 verify: sweep_orphaned_quarantine_pii is not SECURITY DEFINER';
  END IF;

  SELECT p.proacl INTO v_proacl FROM pg_proc p WHERE p.oid = v_fn;
  IF v_proacl IS NULL THEN
    RAISE EXCEPTION
      'PS-398 verify: sweep_orphaned_quarantine_pii has no explicit ACL (proacl IS NULL); the REVOKE above did not take effect and PUBLIC retains the default EXECUTE grant';
  END IF;

  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
  THEN
    RAISE EXCEPTION
      'PS-398 verify: anon or authenticated holds EXECUTE on sweep_orphaned_quarantine_pii';
  END IF;

  IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-398 verify: postgres, the pg_cron execution role, does not hold EXECUTE on sweep_orphaned_quarantine_pii';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM cron.job
         WHERE jobname = 'quarantine-pii-orphan-sweep'
           AND schedule = '33 4 * * *'
           AND active
           AND command LIKE '%sweep_orphaned_quarantine_pii%'
      )
    $sql$ INTO v_scheduled;
    IF NOT v_scheduled THEN
      RAISE EXCEPTION
        'PS-398 verify: quarantine-pii-orphan-sweep is not scheduled -- an unwired sweep is an orphan';
    END IF;
  END IF;
END;
$verify$;

COMMIT;

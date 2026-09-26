-- Drop public.global_leaderboard: it picks the lexically greatest text "Season"
-- and has no working reader. get_public_global_leaderboard is untouched.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'PS-308 requires database postgres, got %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Fail if the view is already gone or has grown a dependent.
DO $pre$
DECLARE
  v_deps integer;
BEGIN
  IF to_regclass('public.global_leaderboard') IS NULL THEN
    RAISE EXCEPTION
      'PS-308: public.global_leaderboard is absent; this migration would silently no-op';
  END IF;

  SELECT count(*) INTO v_deps
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class c   ON c.oid = r.ev_class
   WHERE d.refobjid = 'public.global_leaderboard'::regclass
     AND d.refclassid = 'pg_class'::regclass
     AND c.oid <> 'public.global_leaderboard'::regclass;

  IF v_deps <> 0 THEN
    RAISE EXCEPTION
      'PS-308: % dependent object(s) appeared on public.global_leaderboard since the census; re-run the census before dropping', v_deps;
  END IF;
END;
$pre$;

-- RESTRICT: a dependent means the census is stale and the drop must fail.
DROP VIEW public.global_leaderboard RESTRICT;

DO $verify$
BEGIN
  IF to_regclass('public.global_leaderboard') IS NOT NULL THEN
    RAISE EXCEPTION 'PS-308 verify: public.global_leaderboard still exists after DROP';
  END IF;

  -- The privacy-aware read path the homepage uses must survive untouched.
  IF to_regprocedure('public.get_public_global_leaderboard(integer)') IS NULL THEN
    RAISE EXCEPTION
      'PS-308 verify: public.get_public_global_leaderboard(integer) is missing; the served leaderboard has no read path';
  END IF;

  IF NOT has_function_privilege('anon', 'public.get_public_global_leaderboard(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-308 verify: anon lost EXECUTE on get_public_global_leaderboard(integer)';
  END IF;
END;
$verify$;

COMMIT;

-- Rollback, by hand on postgres: CREATE VIEW public.global_leaderboard WITH (security_invoker='true')
-- from pg_get_viewdef in this file's history, owner postgres; SELECT to analytics_ro,
-- INSERT/UPDATE/DELETE to authenticated, all to service_role, nothing to anon.

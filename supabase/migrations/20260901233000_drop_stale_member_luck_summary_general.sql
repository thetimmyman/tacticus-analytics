-- Drop the uncalled live-only get_guild_member_luck_summary(integer): it lacks the peer gate.
-- target-db: general
-- Roll back only with that gate added.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'stale luck-summary drop (general) requires database postgres, got %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preconditions pass on a fresh database and fail loudly on unexpected drift.
DO $precheck$
DECLARE
  unexpected text;
  cron_caller text;
BEGIN
  -- 1. pg_cron caller check. Dynamic SQL: a static reference to cron.job
  --    fails to PARSE (42P01) on a database that lacks the cron schema
  --    (e.g. a fresh reset), not just at runtime.
  IF to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT string_agg(jobname, ', ')
        FROM cron.job
       WHERE command ~ 'get_guild_member_luck_summary'
    $sql$ INTO cron_caller;
    IF cron_caller IS NOT NULL THEN
      RAISE EXCEPTION
        'stale luck-summary drop: cron job(s) still call it: %', cron_caller;
    END IF;
  END IF;

  -- 2. Overload census. The probe found exactly one overload, (integer).
  --    Any other signature means this migration was written against stale
  --    facts: abort instead of dropping around it.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO unexpected
    FROM pg_catalog.pg_proc AS p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_guild_member_luck_summary'
     AND p.oid <> COALESCE(
           to_regprocedure('public.get_guild_member_luck_summary(integer)'),
           0::oid
         );
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION
      'stale luck-summary drop: unexpected overload(s) present: %', unexpected;
  END IF;

  -- 3. In-database dependency sweep: an app-code census misses callers that
  --    live inside the database itself. No other function body and no view
  --    definition may reference the name.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO unexpected
    FROM pg_catalog.pg_proc AS p
   WHERE p.prosrc LIKE '%get_guild_member_luck_summary%'
     AND p.proname <> 'get_guild_member_luck_summary';
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION
      'stale luck-summary drop: function bodies still reference it: %',
      unexpected;
  END IF;

  SELECT string_agg(format('%I.%I', v.schemaname, v.viewname), ', ')
    INTO unexpected
    FROM pg_catalog.pg_views AS v
   WHERE v.definition LIKE '%get_guild_member_luck_summary%';
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION
      'stale luck-summary drop: view definitions still reference it: %',
      unexpected;
  END IF;
END;
$precheck$;

-- REVOKE errors on a missing function, so guard it on existence.
DO $revoke$
BEGIN
  IF to_regprocedure('public.get_guild_member_luck_summary(integer)')
     IS NOT NULL THEN
    REVOKE ALL
      ON FUNCTION public.get_guild_member_luck_summary(integer)
      FROM PUBLIC, anon, authenticated;
  END IF;
END;
$revoke$;

DROP FUNCTION IF EXISTS public.get_guild_member_luck_summary(integer);

-- The precheck allowed only one overload, so zero remaining means only it was dropped.
DO $verify$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*)::integer INTO remaining
    FROM pg_catalog.pg_proc AS p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_guild_member_luck_summary';
  IF remaining <> 0 THEN
    RAISE EXCEPTION
      'stale luck-summary drop: % overload(s) of get_guild_member_luck_summary remain, expected 0',
      remaining;
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;

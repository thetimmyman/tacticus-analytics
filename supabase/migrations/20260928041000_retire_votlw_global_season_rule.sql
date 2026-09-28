-- Retire the old global "MAX(Season) - 1, score every guild with a row for
-- it" VOTLW rule: guilds/clusters advance on independent calendars, so it
-- could score a guild from a sliver of its own data. Season selection now
-- lives per-guild in calculate-votlw's season-guard, driven by the
-- calculate-votlw-winners pg_cron job (calls the edge function directly,
-- untouched by this migration).
-- target-db: general
BEGIN;

-- No caller (grep: zero references in app/packages/supabase, and it never
-- actually called the edge function — its loop body only RAISE NOTICEd).
-- Kept as a signature-preserving no-op rather than dropped, since an
-- unrelated migration's preflight already pins its existence/ownership.
CREATE OR REPLACE FUNCTION public.calculate_votlw_for_completed_seasons() RETURNS TABLE(seasons_processed integer[], message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $_$
BEGIN
  RETURN QUERY
  SELECT
    ARRAY[]::INTEGER[] AS seasons_processed,
    'Deprecated no-op: VOTLW season selection now runs per guild via the calculate-votlw edge function.' AS message;
END;
$_$;

-- Unschedule any cron job invoking it directly, if one exists on this
-- database; the live calculate-votlw-winners job calls the edge function
-- and is untouched (command does not match calculate_votlw_if_scheduled).
DO $unschedule$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $cron$
      SELECT cron.unschedule(jobid)
        FROM cron.job
       WHERE database = current_database()::name
         AND command ~* 'calculate_votlw_if_scheduled'
    $cron$;
  END IF;
END;
$unschedule$;

-- Broken since it was written (date - date is an integer in Postgres, and
-- EXTRACT() cannot take one): EXTRACT(EPOCH FROM (CURRENT_DATE - DATE ...))
-- errors every time it runs. No caller (grep: zero references anywhere in
-- this repository), so it is dropped outright rather than fixed.
DROP FUNCTION IF EXISTS public.calculate_votlw_if_scheduled();

-- Strip the 'votlw_needed' system_logs write: it used the same retired
-- global rule (MAX(season) across votlw_winners) and nothing reads that log
-- type. The trigger stays attached as a no-op rather than being dropped, to
-- keep this migration signature-preserving like the function above.
CREATE OR REPLACE FUNCTION public.notify_season_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN NEW;
END;
$_$;

DO $verify$
BEGIN
  IF to_regprocedure('public.calculate_votlw_if_scheduled()') IS NOT NULL THEN
    RAISE EXCEPTION 'calculate_votlw_if_scheduled still exists';
  END IF;
  -- Nested, not a single `to_regclass(...) IS NOT NULL AND EXISTS(...)`: a
  -- database with no cron schema (this replay lane) fails to even PARSE a
  -- static reference to cron.job, regardless of runtime short-circuiting.
  -- A nested IF's inner statement is only planned when actually reached.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
       WHERE database = current_database()::name
         AND command ~* 'calculate_votlw_if_scheduled'
    ) THEN
      RAISE EXCEPTION 'a cron job for this database still calls calculate_votlw_if_scheduled';
    END IF;
  END IF;
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

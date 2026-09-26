-- Retire the season retention purge: every season is kept. The sibling database's
-- purge is untouched (unschedule is scoped to current_database()).
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'purge retirement (general) requires database postgres, got %', current_database();
  END IF;
END;
$guard$;

DO $unschedule$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $cron$
      SELECT cron.unschedule(jobid)
        FROM cron.job
       WHERE database = current_database()::name
         AND command ~* 'purge_old_seasons'
    $cron$;
  END IF;
END;
$unschedule$;

DROP FUNCTION IF EXISTS public.purge_old_seasons(integer, integer);

DO $verify$
BEGIN
  IF to_regprocedure('public.purge_old_seasons(integer, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'purge_old_seasons still exists';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
       WHERE database = current_database()::name
         AND command ~* 'purge_old_seasons'
    ) THEN
      RAISE EXCEPTION 'a cron job for this database still calls purge_old_seasons';
    END IF;
  END IF;
END;
$verify$;

COMMIT;

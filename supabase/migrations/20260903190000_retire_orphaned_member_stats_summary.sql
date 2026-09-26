-- Retire unread member_stats_summary from General (its refresh costs ~8 CPU minutes);
-- the sibling database's copy and refresh job must stay.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Unschedule first, or the job fails every morning once its target is gone.
DO $unsched$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed in % — nothing to unschedule', current_database();
  ELSIF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'refresh-member-stats' AND database = 'postgres'
  ) THEN
    PERFORM cron.unschedule('refresh-member-stats');
    RAISE NOTICE 'unscheduled cron job refresh-member-stats (General)';
  ELSE
    RAISE NOTICE 'cron job refresh-member-stats not present; nothing to unschedule';
  END IF;
END
$unsched$;

DROP MATERIALIZED VIEW IF EXISTS public.member_stats_summary;

DO $verify$
BEGIN
  IF to_regclass('public.member_stats_summary') IS NOT NULL THEN
    RAISE EXCEPTION 'member_stats_summary is still present after the drop';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM cron.job
       WHERE jobname = 'refresh-member-stats' AND database = 'postgres'
     ) THEN
    RAISE EXCEPTION 'the General refresh job survived; it would fail nightly';
  END IF;

  -- Positive control: the sibling database's job must NOT have been touched.
  IF to_regclass('cron.job') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM cron.job
       WHERE jobname = 'eot-refresh-member-stats'
         AND database <> current_database()
     ) THEN
    RAISE EXCEPTION 'the downstream refresh job is missing; it must survive';
  END IF;
END
$verify$;

COMMIT;

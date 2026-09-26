-- Drop the three cutover rollback snapshot tables (unreferenced, dumped beforehand).
-- target-db: general

BEGIN;

DROP TABLE IF EXISTS public._ta_off_backup_alert_prefs;
DROP TABLE IF EXISTS public._ta_off_backup_token_reminders;
DROP TABLE IF EXISTS public._ta_off_backup_webhook;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname LIKE '\_ta\_off\_backup%') THEN
    RAISE EXCEPTION 'PS-219 verify: a _ta_off_backup table still exists';
  END IF;
END $$;

COMMIT;

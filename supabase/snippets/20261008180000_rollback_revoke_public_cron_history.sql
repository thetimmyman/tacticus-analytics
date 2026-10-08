-- Restore only the upstream PUBLIC SELECT and DELETE grants removed by
-- this migration. Use a captured ACL instead if the pre-apply ACL differed.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $rollback$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Cron history privilege rollback requires database postgres';
  END IF;
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid AND e.extname = 'pg_cron'
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = to_regclass('cron.job_run_details') AND d.deptype = 'e'
        AND d.refclassid = 'pg_extension'::regclass
    ) THEN
      RAISE EXCEPTION 'Expected the pg_cron-owned history table';
    END IF;
    EXECUTE 'GRANT SELECT, DELETE ON TABLE cron.job_run_details TO PUBLIC';
  END IF;
END;
$rollback$;
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20261008180000' AND name = 'revoke_public_cron_history';
COMMIT;

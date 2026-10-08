-- target-db: general
-- Cron history is maintained by its owner. Keep named reader grants and RLS,
-- but do not let every database role inherit access to job commands or logs.
-- Rollback: supabase/snippets/20261008180000_rollback_revoke_public_cron_history.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Cron history privilege migration requires database postgres';
  END IF;
END;
$guard$;

DO $privileges$
BEGIN
  -- Require installation first: recording a no-op would let a later extension
  -- install recreate upstream PUBLIC grants without replaying this migration.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Install pg_cron before the history privilege migration'
      USING ERRCODE = '42704';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid
      AND d.deptype = 'e' AND d.refclassid = 'pg_extension'::regclass
    JOIN pg_extension e ON e.oid = d.refobjid AND e.extname = 'pg_cron'
    WHERE c.oid = to_regclass('cron.job_run_details') AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'Expected the pg_cron-owned history table';
  END IF;
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM PUBLIC';
  -- A grant made through another grantor must not leave a partially hardened
  -- table marked as migrated. Refuse it without changing named grants.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) acl
    WHERE c.oid = to_regclass('cron.job_run_details') AND acl.grantee = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE a.attrelid = to_regclass('cron.job_run_details') AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC history privileges remain; inspect their grantors';
  END IF;
END;
$privileges$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20261008180000', 'revoke_public_cron_history');
COMMIT;

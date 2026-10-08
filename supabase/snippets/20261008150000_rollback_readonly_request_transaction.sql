-- Restore the previous readonly Deployment hook and verify its reads first.
-- Removing this function while the Deployment still selects it denies reads.
-- This deliberately restores the previous promotion write gap.
BEGIN;
DO $rollback$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Readonly request rollback requires database postgres';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('postgrest_readonly.pre_request()')
      AND md5(p.prosrc) = 'e770c3aed00eb0ee96ee7daed5ab214e'
      AND NOT p.prosecdef AND p.provolatile = 'v'
      AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND pg_get_userbyid(p.proowner) = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261008150000' AND name = 'readonly_request_transaction'
  ) THEN
    RAISE EXCEPTION 'Readonly request protection drifted; inspect before rollback';
  END IF;
END;
$rollback$;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION postgrest_readonly.pre_request();
-- RESTRICT is intentional: do not remove later objects or dependents.
DROP SCHEMA postgrest_readonly RESTRICT;
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20261008150000' AND name = 'readonly_request_transaction';
NOTIFY pgrst, 'reload schema';
COMMIT;

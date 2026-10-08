-- Operator-only: restores the exact pre-apply body/comment, including its old
-- claim trust. Inspect that captured state before deliberately undoing the fix.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $rollback$
DECLARE
  v_statements text[];
  v_statement text;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Policy caller rollback requires database postgres';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid=to_regprocedure('public._pm_caller_policy_rows()'))
      IS DISTINCT FROM 'a2e677619ca9c0a8f67c6cef2f727a99' THEN
    RAISE EXCEPTION 'Policy caller helper changed after apply; inspect before rollback';
  END IF;
  SELECT statements INTO v_statements
  FROM supabase_migrations.schema_migrations
  WHERE version='20261008001000' AND name='policy_rows_trusted_caller';
  IF cardinality(v_statements) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Policy caller rollback pre-state is missing';
  END IF;
  FOREACH v_statement IN ARRAY v_statements LOOP
    EXECUTE v_statement;
  END LOOP;
  DELETE FROM supabase_migrations.schema_migrations WHERE version='20261008001000';
END;
$rollback$;
NOTIFY pgrst, 'reload schema';
COMMIT;

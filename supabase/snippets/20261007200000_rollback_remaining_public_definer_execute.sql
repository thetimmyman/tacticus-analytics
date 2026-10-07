-- Restore the exact target PUBLIC grants only for a confirmed regression.
-- This reopens direct-login execution. Capture and compare pre/post ACLs;
-- explicit API grants are untouched. The ledger includes operator-supplied
-- legacy targets without publishing their identifiers in repository source.
-- The nullable ledger compatibility column is retained for other migrations.
-- target-db: general
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $restore$
DECLARE
  v_statements text[];
  v_statement text;
  v_match text[];
  v_fn regprocedure;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Rollback targets General (postgres); refusing %', current_database();
  END IF;
  SELECT statements INTO v_statements
  FROM supabase_migrations.schema_migrations
  WHERE version='20261007200000' AND name='revoke_remaining_public_definer_execute';
  IF v_statements IS NULL THEN
    RAISE EXCEPTION 'Rollback requires the recorded target statements; use the pre-apply ACL snapshot if unavailable';
  END IF;
  FOREACH v_statement IN ARRAY v_statements LOOP
    v_match := regexp_match(v_statement, '^REVOKE EXECUTE ON FUNCTION (.+) FROM PUBLIC$');
    IF v_match IS NULL THEN
      RAISE EXCEPTION 'Rollback target statement has unexpected shape';
    END IF;
    v_fn := to_regprocedure(v_match[1]);
    IF v_fn IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.oid=v_fn AND n.nspname='public' AND p.prosecdef
    ) THEN
      RAISE EXCEPTION 'Rollback target is missing or no longer a public definer: %', v_match[1];
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_fn);
  END LOOP;
END;
$restore$;
DELETE FROM supabase_migrations.schema_migrations WHERE version='20261007200000';
COMMIT;
NOTIFY pgrst, 'reload schema';

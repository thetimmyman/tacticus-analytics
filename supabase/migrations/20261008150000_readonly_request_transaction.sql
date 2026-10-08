-- target-db: general
-- Enforce the readonly endpoint on every request, including pooled sessions
-- whose standby has been promoted. Primary-facing PostgREST keeps its hook.
-- Install this migration before selecting postgrest_readonly.pre_request.
-- Rollback: supabase/snippets/20261008150000_rollback_readonly_request_transaction.sql
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Readonly request protection requires database postgres';
  END IF;
END;
$guard$;
SET LOCAL lock_timeout = '5s';

-- This schema is exclusively owned by this migration. Refuse collisions
-- rather than changing an existing schema or function's owner or grants.
DO $objects$
BEGIN
  IF to_regnamespace('postgrest_readonly') IS NOT NULL
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                WHERE version = '20261008150000') THEN
    RAISE EXCEPTION 'Readonly request protection already exists; inspect before applying';
  END IF;
  IF to_regprocedure('public.enforce_request_user_ban()') IS NULL THEN
    RAISE EXCEPTION 'The existing request ban hook is required';
  END IF;
END;
$objects$;

CREATE SCHEMA postgrest_readonly;
REVOKE ALL ON SCHEMA postgrest_readonly FROM PUBLIC;
GRANT USAGE ON SCHEMA postgrest_readonly TO PUBLIC;

CREATE FUNCTION postgrest_readonly.pre_request()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog
AS $function$
BEGIN
  -- PostgREST starts the transaction and evaluates request settings before
  -- this hook. A read-only transaction cannot become writable after that
  -- first query, including inside an RPC or a security-definer function.
  IF pg_catalog.current_setting('transaction_read_only') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25006',
      MESSAGE = 'Read-only endpoint requires a read-only transaction';
  END IF;
  PERFORM public.enforce_request_user_ban();
END;
$function$;
-- This invoker hook reads transaction state only; it confers no data access.
-- PUBLIC supports every existing JWT role without broadening older ACLs.
GRANT EXECUTE ON FUNCTION postgrest_readonly.pre_request() TO PUBLIC;
COMMENT ON FUNCTION postgrest_readonly.pre_request() IS
  'Require a read-only transaction before an endpoint query; readonly deployments only.';

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20261008150000', 'readonly_request_transaction');
NOTIFY pgrst, 'reload schema';
COMMIT;

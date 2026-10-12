-- target-db: general
-- General service roles belong on the primary-facing API, not the readonly API.
-- Replace the existing hook in place, preserving its OID, owner and grants.
-- Rollback: supabase/snippets/20261008200000_rollback_readonly_caller_boundary.sql
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Readonly caller protection requires database postgres';
  END IF;
END;
$guard$;
SET LOCAL lock_timeout = '5s';

DO $objects$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure('postgrest_readonly.pre_request()')
      AND md5(p.prosrc) = 'e770c3aed00eb0ee96ee7daed5ab214e'
      AND NOT p.prosecdef AND p.provolatile = 'v' AND p.prokind = 'f'
      AND p.prorettype = 'void'::regtype AND l.lanname = 'plpgsql'
      AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND pg_get_userbyid(p.proowner) = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261008150000' AND name = 'readonly_request_transaction'
  ) OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008200000') THEN
    RAISE EXCEPTION 'Readonly request protection drifted; inspect before applying';
  END IF;
END;
$objects$;

CREATE OR REPLACE FUNCTION postgrest_readonly.pre_request()
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
  -- PostgREST has already selected the effective database role. JWT claim
  -- spelling is not authority here; primary-facing service access is unchanged.
  IF CURRENT_USER = 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Role is not permitted on the read-only endpoint';
  END IF;
  PERFORM public.enforce_request_user_ban();
END;
$function$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20261008200000', 'readonly_caller_boundary');
NOTIFY pgrst, 'reload schema';
COMMIT;

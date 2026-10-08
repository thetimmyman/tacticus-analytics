-- Restore the predecessor hook in place. No Deployment configuration changes.
-- This deliberately restores general service-role access on the readonly API.
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
      AND md5(p.prosrc) = '39c082aaf03179ccb312859665256fbb'
      AND NOT p.prosecdef AND p.provolatile = 'v' AND p.prokind = 'f'
      AND p.prorettype = 'void'::regtype AND l.lanname = 'plpgsql'
      AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND pg_get_userbyid(p.proowner) = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261008200000' AND name = 'readonly_caller_boundary'
  ) THEN
    RAISE EXCEPTION 'Readonly request protection drifted; inspect before rollback';
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
  PERFORM public.enforce_request_user_ban();
END;
$function$;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20261008200000' AND name = 'readonly_caller_boundary';
NOTIFY pgrst, 'reload schema';
COMMIT;

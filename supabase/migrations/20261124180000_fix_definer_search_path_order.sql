-- target-db: general
-- Two SECURITY DEFINER functions pin search_path with public first, so a hostile
-- object created in public (a function named coalesce, now or make_interval)
-- shadows the pg_catalog builtin the body actually resolves. Re-pin with
-- pg_catalog first; both bodies schema-qualify every table and column, so no
-- other resolution changes.

-- Rollback: ALTER each function back to SET search_path = public, pg_catalog.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

ALTER FUNCTION public.get_public_stats_live()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.record_player_api_key_auth_failure(text, integer, integer, integer)
  SET search_path = pg_catalog, public;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Direct SQL logins control request.jwt* settings. Resolve the actual caller
-- before consulting a subject; keep EXECUTE so shared RLS reads still complete.
-- target-db: general
-- Rollback: supabase/snippets/20261008001000_rollback_policy_rows_trusted_caller.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Policy caller protection requires database postgres';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('public._pm_caller_policy_rows()')
      AND p.prosecdef AND p.provolatile='s' AND l.lanname='plpgsql'
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.proconfig=ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Policy caller helper is missing or its attributes drifted';
  END IF;
END;
$guard$;

CREATE TEMP TABLE policy_rows_pre ON COMMIT DROP AS
SELECT p.proowner, p.proacl, p.proconfig, p.prorettype, p.proretset,
       pg_get_functiondef(p.oid) AS definition,
       obj_description(p.oid, 'pg_proc') AS description
FROM pg_proc p WHERE p.oid='public._pm_caller_policy_rows()'::regprocedure;

-- Preserve the first pre-state across repeat execution. Only the operator can
-- read/write this ledger; the rollback restores that exact definition/comment.
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
SELECT '20261008001000', 'policy_rows_trusted_caller', ARRAY[
  definition,
  format('COMMENT ON FUNCTION public._pm_caller_policy_rows() IS %L', description)
] FROM policy_rows_pre
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION public._pm_caller_policy_rows()
RETURNS TABLE(player_id text, user_id uuid, guild_code text,
              cluster_code character varying, role public.app_role,
              is_current boolean, is_app_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_role text;
BEGIN
  -- SECURITY DEFINER changes current_user, but not the selected SQL role.
  -- PostgreSQL checks SET ROLE privileges; JWT/custom settings do not confer it.
  -- Role identifiers are case/space sensitive; do not normalize an alias.
  v_caller_role := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  );
  IF v_caller_role IS NULL
     OR v_caller_role NOT IN ('authenticated', 'service_role') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT mapping.player_id, mapping.user_id, mapping.guild_code,
         mapping.cluster_code, mapping.role, mapping.is_current,
         mapping.is_app_admin
  FROM public.player_mapping mapping
  WHERE mapping.user_id = (SELECT auth.uid());
END;
$function$;

COMMENT ON FUNCTION public._pm_caller_policy_rows() IS
  'Own subject membership rows for authenticated/service SQL callers; empty for other callers. '
  'EXECUTE remains available to shared policies. SECURITY DEFINER and PL/pgSQL prevent RLS recursion.';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM policy_rows_pre pre JOIN pg_proc p
      ON p.oid='public._pm_caller_policy_rows()'::regprocedure
    WHERE p.proowner=pre.proowner AND p.proacl IS NOT DISTINCT FROM pre.proacl
      AND p.proconfig IS NOT DISTINCT FROM pre.proconfig
      AND p.prorettype=pre.prorettype AND p.proretset=pre.proretset
      AND p.prosecdef AND p.provolatile='s'
  ) THEN
    RAISE EXCEPTION 'Policy caller protection changed the helper contract';
  END IF;
END;
$verify$;
NOTIFY pgrst, 'reload schema';
COMMIT;

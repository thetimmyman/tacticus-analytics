-- has_active_users(text) stops answering anon: it was a guild-occupancy oracle.
-- target-db: general
-- REVOKE plus an in-body session guard that survives a stray re-grant; converted
-- to plpgsql only so the guard is expressible.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.has_active_users(p_guild_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_role TEXT;
  v_result BOOLEAN;
BEGIN
  -- PS-317 guard. Read the caller's role the way PS-253 and PS-285 read it.
  v_role := lower(trim(COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  )));

  -- service_role is the server's own identity and legitimately carries no
  -- auth.uid(); it passes. Every other caller -- anon above all, which after
  -- this migration also holds no EXECUTE -- must present a session. IS NULL is
  -- NULL-safe by construction: unlike `<>` it cannot evaluate to NULL and have
  -- PL/pgSQL skip the whole guard.
  IF v_role IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- The pre-PS-317 body, unchanged.
  SELECT EXISTS (
    SELECT 1 FROM player_mapping
    WHERE player_mapping.guild_code = p_guild_code
    AND player_mapping.is_current = true
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.has_active_users(text) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.has_active_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_users(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_active_users(text) IS
  'PS-317: raises 42501 unless the caller is service_role or has a session (auth.uid() '
  'IS NOT NULL). anon holds no EXECUTE and neither does PUBLIC. Was an anon-reachable '
  'SECURITY DEFINER occupancy oracle over player_mapping: it discriminated a real guild '
  'code from a fake one for an unauthenticated caller. No reader anywhere in the '
  'application, the catalogue or pg_stat_statements; the grant is a gate, not a removal.';

DO $verify$
DECLARE
  v_fn CONSTANT regprocedure := 'public.has_active_users(text)'::regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) AS a
    WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PS-317 verify: PUBLIC still holds EXECUTE on has_active_users(text)';
  END IF;

  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-317 verify: anon still holds EXECUTE on has_active_users(text)';
  END IF;

  -- Not a lockout: both retained roles are asserted positively, so a later
  -- hand that "finished the job" by revoking everything fails here.
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-317 verify: authenticated lost EXECUTE on has_active_users(text) (this is a gate, not a removal)';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-317 verify: service_role lost EXECUTE on has_active_users(text)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn::oid AND p.prosecdef) THEN
    RAISE EXCEPTION 'PS-317 verify: has_active_users(text) is no longer SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn::oid AND p.proconfig IS NOT NULL) THEN
    RAISE EXCEPTION 'PS-317 verify: has_active_users(text) lost its pinned search_path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn::oid AND p.provolatile = 's') THEN
    RAISE EXCEPTION 'PS-317 verify: has_active_users(text) is no longer STABLE';
  END IF;

  -- The body really is the guarded one, and it still carries the predicate.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_fn::oid
      AND p.prosrc LIKE '%42501%'
      AND p.prosrc LIKE '%auth.uid()%'
      AND p.prosrc LIKE '%player_mapping%'
      AND p.prosrc LIKE '%is_current%'
  ) THEN
    RAISE EXCEPTION 'PS-317 verify: has_active_users(text) is not carrying the guarded body, or lost its predicate';
  END IF;

  RAISE NOTICE 'PS-317 verify: OK -- anon and PUBLIC lose EXECUTE, authenticated and service_role retain it, the body refuses a caller with no session, predicate intact';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

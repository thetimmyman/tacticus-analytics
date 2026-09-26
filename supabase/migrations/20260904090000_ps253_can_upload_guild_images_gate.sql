-- Make can_upload_guild_images(uuid) self-only and revoke anon EXECUTE: as a
-- SECURITY DEFINER taking the subject as a parameter, it was an authority oracle.
-- target-db: general
-- The in-body guard survives a future GRANT and blocks third-party probes; the REVOKE stops anon.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_upload_guild_images(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role text;
BEGIN
  -- PS-253. Mirrors can_author_playbooks' caller guards so the two cannot
  -- drift: reachable only as authenticated/service_role, and self-only when
  -- authenticated (no probing another user's authority).
  v_role := lower(trim(COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  )));
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- IS DISTINCT FROM, not <>, per scripts/security/check-null-skippable-auth-guards.mjs:
  -- a NULL on the RIGHT of <> propagates NULL and the IF is skipped. The two
  -- IS NULL disjuncts are KEPT, not made redundant -- dropping them would let
  -- two NULLs compare EQUAL and authorise an unauthenticated caller against an
  -- unowned row. This is the one place the guard deliberately reads better than
  -- can_author_playbooks, which still carries the <> form.
  IF v_role = 'authenticated'
    AND (
      auth.uid() IS NULL
      OR p_user_id IS NULL
      OR p_user_id IS DISTINCT FROM auth.uid()
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- The pre-PS-253 predicate, unchanged.
  RETURN EXISTS (
    SELECT 1
    FROM public.player_mapping AS pm
    WHERE pm.user_id = p_user_id
      AND (
        pm.is_app_admin = true
        OR pm.role::text IN ('leader', 'officer', 'Leader', 'Officer')
      )
  );
END;
$function$;

ALTER FUNCTION public.can_upload_guild_images(uuid) OWNER TO postgres;

-- PUBLIC too, so no future role inherits EXECUTE.
REVOKE EXECUTE ON FUNCTION public.can_upload_guild_images(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_guild_images(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_upload_guild_images(uuid) IS
  'PS-253: self-only authority check. Raises 42501 unless the caller is service_role, '
  'or is authenticated and p_user_id = auth.uid(). anon holds no EXECUTE. '
  'Was an anon-reachable SECURITY DEFINER oracle over player_mapping authority.';

DO $verify$
DECLARE
  v_fn CONSTANT regprocedure := 'public.can_upload_guild_images(uuid)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-253 verify: anon still holds EXECUTE on public.can_upload_guild_images(uuid)';
  END IF;

  -- PUBLIC is not a role, so has_function_privilege() cannot be asked about
  -- it; read the ACL directly. grantee = 0 is the PUBLIC entry.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p, aclexplode(p.proacl) AS a
    WHERE p.oid = v_fn::oid
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'PS-253 verify: PUBLIC still holds EXECUTE on public.can_upload_guild_images(uuid)';
  END IF;

  -- The writers that must SURVIVE. A migration that only takes privileges away
  -- would pass the two checks above by deleting the function outright.
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-253 verify: authenticated lost EXECUTE on public.can_upload_guild_images(uuid)';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-253 verify: service_role lost EXECUTE on public.can_upload_guild_images(uuid)';
  END IF;

  -- The body really is the guarded one, and it is still a definer function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_fn::oid
      AND p.prosecdef
      AND p.prosrc LIKE '%42501%'
      AND p.prosrc LIKE '%auth.uid()%'
  ) THEN
    RAISE EXCEPTION
      'PS-253 verify: can_upload_guild_images is not the guarded SECURITY DEFINER body';
  END IF;

  RAISE NOTICE 'PS-253 verify: OK -- anon and PUBLIC hold no EXECUTE; authenticated and service_role retain it; body raises 42501 off auth.uid()';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

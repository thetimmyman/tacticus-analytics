-- Close seven anon-executable SECURITY DEFINER authority oracles over
-- player_mapping: two are guarded, five lose client EXECUTE with bodies untouched.
-- target-db: general
-- get_application_with_messages' guard is NULL-skippable, so the ACL is its only
-- barrier: fix the guard before any re-grant.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- anon keeps EXECUTE: TO public policies call this as the querying role. Only NULL
-- passes for non-authenticated callers, so no uuid probing. search_path stays
-- live because the body is unqualified.
CREATE OR REPLACE FUNCTION public.can_view_playbook(
  p_cluster_code character varying,
  p_guild_code text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user_cluster VARCHAR;
  v_user_guild TEXT;
  v_role TEXT;
BEGIN
  -- PS-285 guard. Read the caller's role the way PS-253 and
  -- can_author_playbooks read it, so the three cannot drift.
  v_role := lower(trim(COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  )));

  -- An authenticated caller may only ask about ITSELF. IS DISTINCT FROM, not
  -- <>, per scripts/security/check-null-skippable-auth-guards.mjs: a NULL on
  -- either side of <> propagates NULL and PL/pgSQL skips the whole IF. The two
  -- IS NULL disjuncts are KEPT, not made redundant -- without them two NULLs
  -- would compare EQUAL and authorise a caller with no session.
  IF v_role = 'authenticated'
    AND (
      auth.uid() IS NULL
      OR p_user_id IS NULL
      OR p_user_id IS DISTINCT FROM auth.uid()
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- Anything that is neither authenticated nor service_role -- anon above all
  -- -- may pass only NULL. That is the single value the two `TO public` RLS
  -- policies on boss_playbook_tactics and boss_playbook_team_requirements ever
  -- supply for such a caller, because they pass (SELECT auth.uid()). Naming a
  -- uuid is what made this function an authority oracle; naming one now
  -- raises. The anon read path through those policies is unaffected.
  IF v_role NOT IN ('authenticated', 'service_role')
    AND p_user_id IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- The pre-PS-285 body, unchanged.
  IF p_cluster_code IS NULL THEN
    RETURN TRUE;
  END IF;
  SELECT gc.cluster_code, pm.guild_code
  INTO v_user_cluster, v_user_guild
  FROM player_mapping pm
  JOIN guild_config gc ON gc.guild_code = pm.guild_code
  WHERE pm.user_id = p_user_id
    AND pm.is_current = true
  LIMIT 1;
  IF v_user_cluster IS NULL OR v_user_cluster <> p_cluster_code THEN
    RETURN FALSE;
  END IF;
  IF p_guild_code IS NULL THEN
    RETURN TRUE;
  END IF;
  RETURN v_user_guild = p_guild_code;
END;
$function$;

ALTER FUNCTION public.can_view_playbook(character varying, text, uuid) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.can_view_playbook(character varying, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_playbook(character varying, text, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.can_view_playbook(character varying, text, uuid) IS
  'PS-285: self-only for authenticated; anon and other roles may pass only a NULL p_user_id, '
  'which is all the TO public RLS policies on boss_playbook_tactics and '
  'boss_playbook_team_requirements ever supply. anon KEEPS EXECUTE on purpose -- RLS policy '
  'expressions run with the querying role''s privileges, so revoking it would break a live '
  'unauthenticated read path. Was an anon-reachable authority oracle over player_mapping.';

-- Its only policy is TO authenticated, so anon can reach it only as an RPC.
CREATE OR REPLACE FUNCTION public.can_view_assigned_playbook(
  p_boss_id text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_matches BOOLEAN;
  v_role TEXT;
BEGIN
  -- PS-285 guard, the PS-253 shape verbatim. The one live caller is the
  -- SELECT policy on boss_playbook_replays, declared TO authenticated, which
  -- passes (SELECT auth.uid()) -- the caller's own id -- so the self-only rule
  -- is already what that call site satisfies.
  v_role := lower(trim(COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  )));
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- IS DISTINCT FROM, not <>; the IS NULL disjuncts are load-bearing. See the
  -- note on can_view_playbook above.
  IF v_role = 'authenticated'
    AND (
      auth.uid() IS NULL
      OR p_user_id IS NULL
      OR p_user_id IS DISTINCT FROM auth.uid()
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  -- The pre-PS-285 body, unchanged.
  IF p_user_id IS NULL OR p_boss_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM player_mapping pm
    WHERE pm.user_id = p_user_id
      AND pm.is_current = true
      AND (pm.primary_boss = p_boss_id OR pm.secondary_boss = p_boss_id)
  ) INTO v_matches;

  RETURN COALESCE(v_matches, FALSE);
END;
$function$;

ALTER FUNCTION public.can_view_assigned_playbook(text, uuid) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.can_view_assigned_playbook(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_assigned_playbook(text, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_view_assigned_playbook(text, uuid) IS
  'PS-285: self-only authority check. Raises 42501 unless the caller is service_role, or is '
  'authenticated and p_user_id = auth.uid(). anon holds no EXECUTE; its only caller is the '
  'TO authenticated SELECT policy on boss_playbook_replays. Was an anon-reachable oracle.';

-- No readers, so revoke rather than invent a guard.
REVOKE EXECUTE ON FUNCTION public.has_current_guild_membership(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guild_restricts_playbook_access(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_guild_restricts_playbooks(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_user_assigned_to_boss(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_application_with_messages(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_current_guild_membership(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.guild_restricts_playbook_access(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_guild_restricts_playbooks(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_user_assigned_to_boss(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_application_with_messages(uuid) TO service_role;

COMMENT ON FUNCTION public.has_current_guild_membership(text, uuid) IS
  'PS-285: no reader anywhere. EXECUTE revoked from PUBLIC, anon and authenticated; '
  'service_role retained. Was an anon-reachable SECURITY DEFINER membership oracle.';
COMMENT ON FUNCTION public.guild_restricts_playbook_access(uuid) IS
  'PS-285: no reader anywhere. EXECUTE revoked from PUBLIC, anon and authenticated; '
  'service_role retained. Was an anon-reachable SECURITY DEFINER guild-policy oracle.';
COMMENT ON FUNCTION public.user_guild_restricts_playbooks(uuid) IS
  'PS-285: no reader anywhere. EXECUTE revoked from PUBLIC, anon and authenticated; '
  'service_role retained. Was an anon-reachable SECURITY DEFINER guild-policy oracle.';
COMMENT ON FUNCTION public.is_user_assigned_to_boss(text, uuid) IS
  'PS-285: no reader anywhere. EXECUTE revoked from PUBLIC, anon and authenticated; '
  'service_role retained. Was an anon-reachable SECURITY DEFINER assignment oracle.';
COMMENT ON FUNCTION public.get_application_with_messages(uuid) IS
  'PS-285: no reader anywhere; not present in the application repository at all. EXECUTE '
  'revoked from PUBLIC, anon and authenticated; service_role retained. Its in-body guard is '
  'NULL-skippable for a caller with no session, so it returned another party''s application '
  'row and messages to anon. If this is ever re-granted, FIX THE BODY IN THE SAME CHANGE.';

DO $verify$
DECLARE
  v_fn regprocedure;
  v_name text;
  v_revoked_from_authenticated CONSTANT text[] := ARRAY[
    'public.has_current_guild_membership(text, uuid)',
    'public.guild_restricts_playbook_access(uuid)',
    'public.user_guild_restricts_playbooks(uuid)',
    'public.is_user_assigned_to_boss(text, uuid)',
    'public.get_application_with_messages(uuid)'
  ];
  v_all CONSTANT text[] := v_revoked_from_authenticated || ARRAY[
    'public.can_view_playbook(character varying, text, uuid)',
    'public.can_view_assigned_playbook(text, uuid)'
  ];
BEGIN
  -- Common to all seven: anon holds no EXECUTE except on can_view_playbook,
  -- PUBLIC holds none at all, service_role keeps it, and each is still a
  -- SECURITY DEFINER function rather than having been dropped or downgraded.
  FOREACH v_name IN ARRAY v_all LOOP
    v_fn := v_name::regprocedure;

    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) AS a
      WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PS-285 verify: PUBLIC still holds EXECUTE on %', v_name;
    END IF;

    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-285 verify: service_role lost EXECUTE on % (this is a gate, not a removal)', v_name;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn::oid AND p.prosecdef) THEN
      RAISE EXCEPTION 'PS-285 verify: % is no longer SECURITY DEFINER', v_name;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn::oid AND p.proconfig IS NOT NULL) THEN
      RAISE EXCEPTION 'PS-285 verify: % lost its pinned search_path', v_name;
    END IF;
  END LOOP;

  -- The five with no reader: anon AND authenticated are both gone.
  FOREACH v_name IN ARRAY v_revoked_from_authenticated LOOP
    v_fn := v_name::regprocedure;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-285 verify: anon still holds EXECUTE on %', v_name;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-285 verify: authenticated still holds EXECUTE on %', v_name;
    END IF;
  END LOOP;

  -- can_view_playbook: anon KEEPS EXECUTE. Asserted positively, because a
  -- later hand that "finished the job" by revoking it would break a live
  -- unauthenticated read of boss_playbook_tactics and boss_playbook_team_requirements.
  IF NOT has_function_privilege('anon', 'public.can_view_playbook(character varying, text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-285 verify: anon lost EXECUTE on can_view_playbook -- the TO public RLS policies on the boss_playbook_* tables need it';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.can_view_playbook(character varying, text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-285 verify: authenticated lost EXECUTE on can_view_playbook';
  END IF;

  -- can_view_assigned_playbook: anon gone, authenticated kept for its policy.
  IF has_function_privilege('anon', 'public.can_view_assigned_playbook(text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-285 verify: anon still holds EXECUTE on can_view_assigned_playbook';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.can_view_assigned_playbook(text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-285 verify: authenticated lost EXECUTE on can_view_assigned_playbook -- its SELECT policy on boss_playbook_replays needs it';
  END IF;

  -- The two guarded bodies really are the guarded ones.
  FOREACH v_name IN ARRAY ARRAY[
    'public.can_view_playbook(character varying, text, uuid)',
    'public.can_view_assigned_playbook(text, uuid)'
  ] LOOP
    v_fn := v_name::regprocedure;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = v_fn::oid
        AND p.prosrc LIKE '%42501%'
        AND p.prosrc LIKE '%auth.uid()%'
        AND p.prosrc LIKE '%IS DISTINCT FROM%'
    ) THEN
      RAISE EXCEPTION 'PS-285 verify: % is not carrying the guarded body', v_name;
    END IF;
  END LOOP;

  -- The five untouched bodies must NOT have grown a guard: this migration
  -- deliberately did not edit them, and a body change there would be an
  -- unreviewed authority decision.
  FOREACH v_name IN ARRAY v_revoked_from_authenticated LOOP
    v_fn := v_name::regprocedure;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn::oid AND p.prosrc LIKE '%42501%') THEN
      RAISE EXCEPTION 'PS-285 verify: % gained a 42501 guard; this migration must only change its ACL', v_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'PS-285 verify: OK -- 6 of 7 lose anon EXECUTE, can_view_playbook keeps it behind a NULL-only guard, PUBLIC is gone from all 7, service_role retained, no body edited except the two guarded';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

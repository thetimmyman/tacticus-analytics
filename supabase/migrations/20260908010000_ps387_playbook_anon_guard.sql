-- Stop anon reading boss playbooks via can_view_playbook's NULL-cluster early
-- return and a USING (true) policy on boss_playbook_tactics_history.
-- target-db: general
-- Guard on p_user_id, not auth.uid(), so service_role can act for a user. Not a
-- REVOKE (the ps285 suite pins anon EXECUTE), nor a NULL-cluster deny (hides the global tier).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Live body plus one marked block; search_path stays live since the body is unqualified.
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

  -- PS-387. THE ONE INSERTION. An anonymous subject may view nothing.
  --
  -- RETURN FALSE, not RAISE: pgTAP ps285 test 16 asserts an anon caller may
  -- CALL this with a NULL subject (lives_ok) and test 18 asserts the anon
  -- SELECT through the policy still runs. A raise would turn both into errors
  -- and turn an ordinary anon page load into a 500 instead of an empty list.
  -- Denying by value keeps the read path alive and empties it.
  --
  -- The guard reads p_user_id, the SUBJECT, not auth.uid(). See the header:
  -- the two are the same value at every live call site, but the parameter
  -- form leaves a service_role call made on behalf of a named user working.
  --
  -- Placed AHEAD of the NULL-cluster early return below, which is the branch
  -- that returns TRUE unconditionally and is what leaked the global tier.
  IF p_user_id IS NULL THEN
    RETURN FALSE;
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

COMMENT ON FUNCTION public.can_view_playbook(character varying, text, uuid) IS
  'PS-285: self-only for authenticated; anon and other roles may pass only a NULL p_user_id, '
  'which is all the TO public RLS policies on boss_playbook_tactics and '
  'boss_playbook_team_requirements ever supply. anon KEEPS EXECUTE on purpose -- RLS policy '
  'expressions run with the querying role''s privileges, so revoking it would break a live '
  'unauthenticated read path. Was an anon-reachable authority oracle over player_mapping. '
  'PS-387: a NULL subject now returns FALSE before the NULL-cluster early return, so the '
  'global fallback tier is visible to sessions and not to the internet. The guard reads the '
  'p_user_id PARAMETER, not auth.uid(), so a service_role call naming a real subject still works.';

-- Owner and ACL are not restated; CREATE OR REPLACE preserves them.

-- History inherits the parent tactic's visibility; the cast pins the overload.
DROP POLICY "Everyone can view boss_playbook_tactics_history"
  ON public.boss_playbook_tactics_history;

CREATE POLICY "Viewers of the parent tactic can view its history"
  ON public.boss_playbook_tactics_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.boss_playbook_tactics t
      WHERE t.id = boss_playbook_tactics_history.tactics_id
        AND public.can_view_playbook(
              (t.cluster_code)::character varying,
              t.guild_code,
              (SELECT auth.uid())
            )
    )
  );

COMMENT ON POLICY "Viewers of the parent tactic can view its history"
  ON public.boss_playbook_tactics_history IS
  'PS-387: replaces "Everyone can view boss_playbook_tactics_history", which was USING (true) '
  'and served all 31 revisions to the anon key. History is now exactly as visible as the tactic '
  'it belongs to, and can never be more permissive than it. Orphans are invisible, but the FK is '
  'ON DELETE CASCADE so there are none.';

-- Structural only; row counts are live data.
DO $verify$
DECLARE
  v_qual TEXT;
  v_src TEXT;
BEGIN
  -- The old fail-open policy is gone and the new one is present, once.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'boss_playbook_tactics_history'
       AND policyname = 'Everyone can view boss_playbook_tactics_history'
  ) THEN
    RAISE EXCEPTION 'PS-387 verify: the USING (true) history policy is still present';
  END IF;

  SELECT qual INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'boss_playbook_tactics_history'
     AND policyname = 'Viewers of the parent tactic can view its history';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'PS-387 verify: the replacement history policy was not created';
  END IF;

  -- Not just "a policy exists": it must actually resolve through the parent.
  IF v_qual NOT ILIKE '%can_view_playbook%' OR v_qual NOT ILIKE '%boss_playbook_tactics%' THEN
    RAISE EXCEPTION 'PS-387 verify: the replacement history policy does not resolve through the parent tactic: %', v_qual;
  END IF;
  IF v_qual = 'true' THEN
    RAISE EXCEPTION 'PS-387 verify: the replacement history policy is still USING (true)';
  END IF;

  -- The exactly-one control: SELECT on this table must be governed by one
  -- policy, or a surviving permissive sibling would OR the fix away.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'boss_playbook_tactics_history'
         AND cmd = 'SELECT') <> 1 THEN
    RAISE EXCEPTION 'PS-387 verify: boss_playbook_tactics_history has more than one SELECT policy; a permissive sibling would OR this fix away';
  END IF;

  -- The subject guard is in the function body, ahead of the NULL-cluster
  -- branch. Position is asserted, not just presence: after it, the branch is
  -- unreachable for a NULL subject; before it, the fix does nothing.
  SELECT prosrc INTO v_src
    FROM pg_proc
   WHERE oid = 'public.can_view_playbook(character varying, text, uuid)'::regprocedure;

  IF v_src NOT LIKE '%IF p_user_id IS NULL THEN%' THEN
    RAISE EXCEPTION 'PS-387 verify: can_view_playbook has no NULL-subject guard';
  END IF;
  IF position('IF p_user_id IS NULL THEN' in v_src)
       > position('IF p_cluster_code IS NULL THEN' in v_src) THEN
    RAISE EXCEPTION 'PS-387 verify: the NULL-subject guard sits AFTER the NULL-cluster early return, so it cannot close the leak';
  END IF;

  -- PS-285 must survive intact. Its two guards are the reason an anon caller
  -- can only ever reach the new guard with a NULL subject.
  IF v_src NOT LIKE '%42501%' THEN
    RAISE EXCEPTION 'PS-387 verify: the PS-285 authority guards were dropped from can_view_playbook';
  END IF;

  -- Grants unchanged: this migration is not a REVOKE, and ps285 tests 6 and 18
  -- fail if it becomes one.
  IF NOT has_function_privilege('anon', 'public.can_view_playbook(character varying, text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-387 verify: anon lost EXECUTE on can_view_playbook -- the TO public RLS policies need it and ps285 test 6 pins it';
  END IF;
  IF NOT has_table_privilege('anon', 'public.boss_playbook_tactics_history', 'SELECT') THEN
    RAISE EXCEPTION 'PS-387 verify: anon lost SELECT on boss_playbook_tactics_history -- this fix is a policy change, not a REVOKE';
  END IF;
  IF NOT has_table_privilege('anon', 'public.boss_playbook_team_requirements', 'SELECT') THEN
    RAISE EXCEPTION 'PS-387 verify: anon lost SELECT on boss_playbook_team_requirements -- this fix is a policy change, not a REVOKE';
  END IF;

  RAISE NOTICE 'PS-387 verify: OK -- NULL subject denied ahead of the NULL-cluster branch, history resolves through its parent tactic, PS-285 guards and every grant intact';
END
$verify$;

COMMIT;

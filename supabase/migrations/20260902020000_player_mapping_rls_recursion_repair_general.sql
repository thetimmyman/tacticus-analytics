-- Make the seven _pm_caller* helpers plpgsql so the planner can never inline them into
-- a player_mapping policy and recurse. Bodies, owner and ACL unchanged.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'player_mapping recursion repair (General) requires database postgres, got %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Pre-state, so 3a can assert only prolang changed; live-only helpers may be absent.
CREATE TEMP TABLE _pmr_pre_helpers ON COMMIT DROP AS
SELECT p.proname::text                  AS proname,
       p.pronargs                       AS nargs,
       pg_get_userbyid(p.proowner)      AS owner_name,
       p.proacl::text                   AS acl_text,
       p.proconfig                      AS config,
       p.prorettype                     AS rettype,
       p.proretset                      AS retset,
       p.prosecdef                      AS secdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('_pm_caller_can_manage_player_meta',
                    '_pm_caller_cluster_guild_codes',
                    '_pm_caller_guild_codes',
                    '_pm_caller_is_app_admin',
                    '_pm_caller_is_competitive_reader',
                    '_pm_caller_mapping_rows',
                    '_pm_caller_policy_rows');

DO $pre$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(req.proname, ', ') INTO v_missing
  FROM (VALUES ('_pm_caller_can_manage_player_meta'),
               ('_pm_caller_cluster_guild_codes'),
               ('_pm_caller_guild_codes'),
               ('_pm_caller_is_app_admin'),
               ('_pm_caller_mapping_rows')) AS req(proname)
  WHERE NOT EXISTS (SELECT 1 FROM _pmr_pre_helpers pre
                    WHERE pre.proname = req.proname);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'pre-check FAILED: lineage player_mapping helper(s) missing: %', v_missing;
  END IF;
END;
$pre$;

-- Bodies are the live definitions verbatim in the equivalent plpgsql RETURN form.

CREATE OR REPLACE FUNCTION public._pm_caller_guild_codes()
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT guild_code
  FROM public.player_mapping
  WHERE user_id = (SELECT auth.uid())
    AND is_current = true
    AND guild_code IS NOT NULL;
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_guild_codes() IS
  'Returns the set of guild_codes the calling auth.uid() belongs to. '
  'SECURITY DEFINER bypasses RLS to prevent recursion when used inside a '
  'player_mapping SELECT policy. LANGUAGE plpgsql so the body can never be '
  'inlined into the calling policy''s plan under any future attribute edit.';

CREATE OR REPLACE FUNCTION public._pm_caller_cluster_guild_codes()
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT gc2.guild_code
  FROM public.guild_config gc2
  WHERE gc2.cluster_id IS NOT NULL
    AND gc2.cluster_id IN (
      SELECT gc.cluster_id
      FROM public.guild_config gc
      JOIN public.player_mapping pm ON pm.guild_code = gc.guild_code
      WHERE pm.user_id = (SELECT auth.uid())
        AND pm.is_current = true
        AND gc.cluster_id IS NOT NULL
    );
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_cluster_guild_codes() IS
  'guild_codes sharing a cluster with any guild the calling auth.uid() '
  'belongs to. SECURITY DEFINER for RLS recursion safety; resolves via '
  'guild_config.cluster_id. LANGUAGE plpgsql so the body can never be '
  'inlined into the calling policy''s plan under any future attribute edit.';

CREATE OR REPLACE FUNCTION public._pm_caller_is_app_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM public.player_mapping
    WHERE user_id = (SELECT auth.uid())
      AND is_app_admin = true
      AND is_current = true
  );
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_is_app_admin() IS
  'True if the calling auth.uid() has is_app_admin=true on a current '
  'player_mapping row. SECURITY DEFINER for RLS recursion safety. LANGUAGE '
  'plpgsql so the body can never be inlined into the calling policy''s plan '
  'under any future attribute edit.';

CREATE OR REPLACE FUNCTION public._pm_caller_mapping_rows()
RETURNS TABLE(user_id uuid, guild_code text, cluster_code character varying,
              role public.app_role, is_current boolean, is_app_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT pm.user_id, pm.guild_code, pm.cluster_code, pm.role,
         pm.is_current, pm.is_app_admin
  FROM public.player_mapping pm
  WHERE pm.user_id = (SELECT auth.uid());
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_mapping_rows() IS
  'The calling auth.uid()''s own player_mapping rows, for policies on OTHER '
  'tables that need caller guild/role context without granting them '
  'player_mapping SELECT. SECURITY DEFINER for RLS recursion safety. '
  'LANGUAGE plpgsql so the body can never be inlined into a calling '
  'policy''s plan under any future attribute edit.';

CREATE OR REPLACE FUNCTION public._pm_caller_policy_rows()
RETURNS TABLE(player_id text, user_id uuid, guild_code text,
              cluster_code character varying, role public.app_role,
              is_current boolean, is_app_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT mapping.player_id, mapping.user_id, mapping.guild_code,
         mapping.cluster_code, mapping.role, mapping.is_current,
         mapping.is_app_admin
  FROM public.player_mapping mapping
  WHERE mapping.user_id = (SELECT auth.uid());
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_policy_rows() IS
  'The calling auth.uid()''s own player_mapping rows including player_id, '
  'for policy use. SECURITY DEFINER for RLS recursion safety. LANGUAGE '
  'plpgsql so the body can never be inlined into a calling policy''s plan '
  'under any future attribute edit.';

CREATE OR REPLACE FUNCTION public._pm_caller_can_manage_player_meta(
  p_target_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.player_mapping AS pm_caller
    JOIN public.player_mapping AS pm_target
      ON pm_caller.guild_code = pm_target.guild_code
    WHERE pm_caller.user_id = auth.uid()
      AND pm_caller.is_current = true
      AND lower(pm_caller.role::text) IN ('officer', 'leader')
      AND pm_target.user_id = p_target_user_id
      AND pm_target.is_current = true
  );
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_can_manage_player_meta(uuid) IS
  'True if the calling auth.uid() is a current officer/leader in a guild the '
  'target user is currently mapped to. SECURITY DEFINER for RLS recursion '
  'safety. LANGUAGE plpgsql so the body can never be inlined into a calling '
  'policy''s plan under any future attribute edit.';

CREATE OR REPLACE FUNCTION public._pm_caller_is_competitive_reader()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN public._pm_caller_is_app_admin()
      OR EXISTS (
           SELECT 1
           FROM public._pm_caller_mapping_rows() m
           WHERE m.is_current
             AND lower(m.role::text) IN ('officer', 'leader')
         );
END;
$fn$;

COMMENT ON FUNCTION public._pm_caller_is_competitive_reader() IS
  'True if the calling auth.uid() is an app admin or a current '
  'officer/leader. SECURITY DEFINER for RLS recursion safety. LANGUAGE '
  'plpgsql so the body can never be inlined into a calling policy''s plan '
  'under any future attribute edit.';

-- Live ACL for helpers this migration created on a fresh replay; a no-op on production.
DO $acl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _pmr_pre_helpers
                 WHERE proname = '_pm_caller_is_competitive_reader') THEN
    REVOKE ALL ON FUNCTION public._pm_caller_is_competitive_reader()
      FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public._pm_caller_is_competitive_reader()
      TO authenticated, service_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _pmr_pre_helpers
                 WHERE proname = '_pm_caller_policy_rows') THEN
    REVOKE ALL ON FUNCTION public._pm_caller_policy_rows() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public._pm_caller_policy_rows()
      TO anon, authenticated, service_role;
    IF to_regrole('command_center_rpc_owner') IS NOT NULL THEN
      GRANT EXECUTE ON FUNCTION public._pm_caller_policy_rows()
        TO command_center_rpc_owner;
    END IF;
    IF to_regrole('analytics_ro') IS NOT NULL THEN
      GRANT EXECUTE ON FUNCTION public._pm_caller_policy_rows()
        TO analytics_ro;
    END IF;
  END IF;
END;
$acl$;

DO $verify$
DECLARE
  v_bad          integer;
  v_names        text;
  v_smoke_role   text;
  v_smoke_result text;
  v_count        bigint;
BEGIN
  -- 3a. Helpers that existed before this transaction: LANGUAGE flipped to
  --     plpgsql; SECURITY DEFINER, STABLE, search_path pin, return shape,
  --     OWNER and ACL all byte-identical to the pre-census.
  SELECT count(*), string_agg(pre.proname, ', ') INTO v_bad, v_names
  FROM _pmr_pre_helpers pre
  JOIN pg_proc p ON p.proname = pre.proname AND p.pronargs = pre.nargs
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE NOT (
        p.prokind = 'f'
    AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
    AND p.prosecdef
    AND p.provolatile = 's'
    AND p.proconfig IS NOT DISTINCT FROM pre.config
    AND p.prorettype = pre.rettype
    AND p.proretset  = pre.retset
    AND pg_get_userbyid(p.proowner) = pre.owner_name
    AND p.proacl::text IS NOT DISTINCT FROM pre.acl_text
  );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'post-condition FAILED: helper(s) did not convert cleanly (language/secdef/volatility/search_path/owner/ACL/return-shape drift): %',
      v_names;
  END IF;

  -- 3a-bis. All seven helpers (whether pre-existing or first created here) are
  --     plpgsql STABLE SECURITY DEFINER, and PUBLIC cannot execute the
  --     restricted-audience ones.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_bad, v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.proname LIKE '\_pm\_caller%'
    AND NOT (
          p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND p.prosecdef
      AND p.provolatile = 's'
      AND p.proconfig IS NOT NULL
    );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'post-condition FAILED: _pm_caller helper(s) not plpgsql STABLE SECURITY DEFINER with a pinned search_path: %',
      v_names;
  END IF;

  SELECT count(*), string_agg(p.proname, ', ') INTO v_bad, v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.proname IN ('_pm_caller_is_competitive_reader',
                      '_pm_caller_policy_rows',
                      '_pm_caller_can_manage_player_meta',
                      '_pm_caller_mapping_rows')
    AND (p.proacl IS NULL  -- default function ACL grants PUBLIC EXECUTE
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'post-condition FAILED: PUBLIC holds EXECUTE on restricted-audience _pm_caller helper(s): %',
      v_names;
  END IF;

  -- 3b. The recursion invariant: NO policy on player_mapping may read
  --     player_mapping as a base relation, in USING or WITH CHECK.
  SELECT count(*), string_agg(polname, ', ') INTO v_bad, v_names
  FROM pg_policy
  WHERE polrelid = 'public.player_mapping'::regclass
    AND (   pg_get_expr(polqual, polrelid)      ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
         OR pg_get_expr(polwithcheck, polrelid) ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'post-condition FAILED: % player_mapping policy(ies) read player_mapping as a base relation (42P17 class): %',
      v_bad, v_names;
  END IF;

  -- 3c. Policy census: the survivors are a subset of the five names in the
  --     live capture, and the two load-bearing ones are present. This
  --     migration creates and drops no policy, so any other name here means
  --     the database changed since the capture — review it, do not force.
  SELECT count(*), string_agg(polname, ', ') INTO v_bad, v_names
  FROM pg_policy
  WHERE polrelid = 'public.player_mapping'::regclass
    AND polname NOT IN ('Service role full access',
                        'command_center_rpc_owner_select_permit',
                        'command_center_rpc_owner_select_restrict',
                        'player_mapping_scoped_read',
                        'users_manage_own_record');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'post-condition FAILED: % unexpected policy(ies) on player_mapping: % — extend the reviewed survivor set deliberately, do not force the apply',
      v_bad, v_names;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid = 'public.player_mapping'::regclass
                   AND polname = 'player_mapping_scoped_read') THEN
    RAISE EXCEPTION 'post-condition FAILED: player_mapping_scoped_read is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid = 'public.player_mapping'::regclass
                   AND polname = 'users_manage_own_record') THEN
    RAISE EXCEPTION 'post-condition FAILED: users_manage_own_record is missing';
  END IF;

  -- 3d. RLS posture unchanged: enabled AND forced, as captured live.
  IF NOT EXISTS (SELECT 1 FROM pg_class
                 WHERE oid = 'public.player_mapping'::regclass
                   AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION
      'post-condition FAILED: player_mapping RLS posture drifted (expected enabled + forced)';
  END IF;

  -- 3e. Functional read-path smoke through the policy machinery, run AS the
  --     role player_mapping_scoped_read is bound to. A read-path smoke is
  --     deliberate: fixture INSERTs would trip provenance/attestation
  --     triggers on this table. 42P17 fires in the rewriter, BEFORE
  --     executor-stage ACL checks, so a 42501 privilege denial still proves
  --     the policy expansion completed and is accepted with a NOTICE; any
  --     other error aborts the transaction.
  SELECT r.rolname INTO v_smoke_role
  FROM pg_policy pol
  JOIN pg_roles r ON r.oid = ANY (pol.polroles)
  WHERE pol.polrelid = 'public.player_mapping'::regclass
    AND pol.polname = 'player_mapping_scoped_read'
  LIMIT 1;
  IF v_smoke_role IS NULL THEN
    v_smoke_role := 'authenticated';  -- polroles = PUBLIC
  END IF;

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  EXECUTE format('SET LOCAL ROLE %I', v_smoke_role);
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.player_mapping WHERE user_id = (SELECT auth.uid()) AND is_current = true'
      INTO v_count;
    v_smoke_result := format('completed (%s rows) as %s', v_count, v_smoke_role);
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_smoke_result := format(
        'policy expansion completed as %s; executor-stage privilege denial (42501) — not the 42P17 rewrite-stage defect',
        v_smoke_role);
  END;
  EXECUTE 'RESET ROLE';

  RAISE NOTICE
    'player_mapping recursion repair (General) verified — 7 helpers plpgsql with unchanged owner/ACL/search_path, no self-referential policy, survivors within the captured set, smoke %',
    v_smoke_result;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

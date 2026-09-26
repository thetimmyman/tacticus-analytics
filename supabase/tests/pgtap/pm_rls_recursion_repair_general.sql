BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- No player_mapping policy reads player_mapping as a base relation (42P17). Probes
-- are read-only with a random auth.uid(), so the suite runs live.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260902020000'
    AND name = 'player_mapping_rls_recursion_repair_general'
) AS pmr_not_applied \gset

\if :pmr_not_applied
SELECT plan(20);
SELECT * FROM skip(
  20,
  'this database predates the player_mapping recursion repair (General); apply 20260902020000 and re-run'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(20);

CREATE TEMP TABLE _pmr_helpers ON COMMIT DROP AS
SELECT p.proname::text AS proname,
       l.lanname::text AS lang,
       p.prosecdef     AS secdef,
       p.provolatile   AS volatility,
       p.proconfig     AS config,
       p.proacl        AS acl
FROM pg_proc p
JOIN pg_language  l ON l.oid = p.prolang
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE '\_pm\_caller%';

SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public']
   FROM _pmr_helpers WHERE proname = '_pm_caller_guild_codes'),
  'A1: _pm_caller_guild_codes is plpgsql STABLE SECURITY DEFINER, search_path=public'
);
SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public']
   FROM _pmr_helpers WHERE proname = '_pm_caller_cluster_guild_codes'),
  'A2: _pm_caller_cluster_guild_codes is plpgsql STABLE SECURITY DEFINER, search_path=public'
);
SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public']
   FROM _pmr_helpers WHERE proname = '_pm_caller_is_app_admin'),
  'A3: _pm_caller_is_app_admin is plpgsql STABLE SECURITY DEFINER, search_path=public'
);
SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public, pg_temp']
   FROM _pmr_helpers WHERE proname = '_pm_caller_mapping_rows'),
  'A4: _pm_caller_mapping_rows is plpgsql STABLE SECURITY DEFINER, search_path=public,pg_temp'
);
SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public, pg_temp']
   FROM _pmr_helpers WHERE proname = '_pm_caller_policy_rows'),
  'A5: _pm_caller_policy_rows is plpgsql STABLE SECURITY DEFINER, search_path=public,pg_temp'
);
SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public, pg_temp']
   FROM _pmr_helpers WHERE proname = '_pm_caller_can_manage_player_meta'),
  'A6: _pm_caller_can_manage_player_meta is plpgsql STABLE SECURITY DEFINER, search_path=public,pg_temp'
);
SELECT ok(
  (SELECT lang = 'plpgsql' AND secdef AND volatility = 's'
          AND config = ARRAY['search_path=public, pg_temp']
   FROM _pmr_helpers WHERE proname = '_pm_caller_is_competitive_reader'),
  'A7: _pm_caller_is_competitive_reader is plpgsql STABLE SECURITY DEFINER, search_path=public,pg_temp'
);

SELECT ok(
  (SELECT bool_and(has_function_privilege(r, f, 'EXECUTE'))
   FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
   CROSS JOIN unnest(ARRAY['public._pm_caller_guild_codes()',
                           'public._pm_caller_cluster_guild_codes()',
                           'public._pm_caller_is_app_admin()']) AS f),
  'B1: anon/authenticated/service_role can EXECUTE the three policy-qual helpers'
);
SELECT ok(
  has_function_privilege('authenticated', 'public._pm_caller_can_manage_player_meta(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._pm_caller_can_manage_player_meta(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._pm_caller_can_manage_player_meta(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public._pm_caller_is_competitive_reader()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._pm_caller_is_competitive_reader()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._pm_caller_is_competitive_reader()', 'EXECUTE'),
  'B2: can_manage_player_meta/is_competitive_reader execute for authenticated+service_role, NOT anon'
);
SELECT ok(
  (SELECT bool_and(has_function_privilege(r, f, 'EXECUTE'))
   FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
   CROSS JOIN unnest(ARRAY['public._pm_caller_mapping_rows()',
                           'public._pm_caller_policy_rows()']) AS f)
  AND NOT EXISTS (
    SELECT 1 FROM _pmr_helpers h
    WHERE h.proname IN ('_pm_caller_mapping_rows', '_pm_caller_policy_rows',
                        '_pm_caller_can_manage_player_meta',
                        '_pm_caller_is_competitive_reader')
      AND (h.acl IS NULL
           OR EXISTS (SELECT 1 FROM aclexplode(h.acl) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))),
  'B3: mapping_rows/policy_rows execute for anon+authenticated+service_role; no restricted helper grants PUBLIC'
);

SELECT is(
  (SELECT count(*)::int
   FROM pg_policy
   WHERE polrelid = 'public.player_mapping'::regclass
     AND polname NOT IN ('Service role full access',
                         'command_center_rpc_owner_select_permit',
                         'command_center_rpc_owner_select_restrict',
                         'player_mapping_scoped_read',
                         'users_manage_own_record')),
  0,
  'C1: no policy outside the five reviewed survivors exists on player_mapping'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policy p
          WHERE p.polrelid = 'public.player_mapping'::regclass
            AND p.polname = 'player_mapping_scoped_read'
            AND p.polcmd = 'r'
            AND (SELECT array_agg(pg_get_userbyid(r)::text ORDER BY pg_get_userbyid(r)::text)
                 FROM unnest(p.polroles) AS r) = ARRAY['authenticated']),
  'C2: player_mapping_scoped_read exists, FOR SELECT, bound to authenticated'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policy p
          WHERE p.polrelid = 'public.player_mapping'::regclass
            AND p.polname = 'users_manage_own_record'
            AND p.polcmd = '*'),
  'C3: users_manage_own_record exists and is FOR ALL'
);
SELECT is(
  (SELECT count(*)::int
   FROM pg_policy
   WHERE polrelid = 'public.player_mapping'::regclass
     AND (   pg_get_expr(polqual, polrelid)      ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
          OR pg_get_expr(polwithcheck, polrelid) ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M')),
  0,
  'C4: no player_mapping policy reads player_mapping as a base relation (42P17 recursion class)'
);
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_class WHERE oid = 'public.player_mapping'::regclass),
  'C5: player_mapping RLS is enabled AND forced, as captured live'
);

-- Recursion fails every policy-evaluated statement, so completion plus zero rows is
-- the acceptance pair; results park in GUCs for assertion after RESET ROLE.

CREATE FUNCTION pg_temp._pmr_probe() RETURNS void
LANGUAGE plpgsql
AS $probe$
DECLARE
  v bigint;
  b boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v FROM public.player_mapping;
  PERFORM set_config('pmr.scoped_rows', v::text, true);
  SELECT count(*) INTO v FROM public._pm_caller_guild_codes();
  PERFORM set_config('pmr.guild_codes', v::text, true);
  SELECT count(*) INTO v FROM public._pm_caller_cluster_guild_codes();
  PERFORM set_config('pmr.cluster_codes', v::text, true);
  SELECT count(*) INTO v FROM public._pm_caller_mapping_rows();
  PERFORM set_config('pmr.mapping_rows', v::text, true);
  SELECT count(*) INTO v FROM public._pm_caller_policy_rows();
  PERFORM set_config('pmr.policy_rows', v::text, true);
  SELECT public._pm_caller_is_app_admin() INTO b;
  PERFORM set_config('pmr.is_admin', b::text, true);
  SELECT public._pm_caller_is_competitive_reader() INTO b;
  PERFORM set_config('pmr.competitive', b::text, true);
  SELECT public._pm_caller_can_manage_player_meta(gen_random_uuid()) INTO b;
  PERFORM set_config('pmr.can_manage', b::text, true);
  EXECUTE 'RESET ROLE';
END;
$probe$;

SELECT lives_ok(
  'SELECT pg_temp._pmr_probe()',
  'D1: authenticated policy-path read + all seven helpers COMPLETE (the recursion defect would fail this regardless of data)'
);

SELECT is(
  current_setting('pmr.scoped_rows', true),
  '0',
  'D2: an unknown auth.uid() sees zero player_mapping rows through the scoped-read policy — completion did not become a leak'
);
SELECT ok(
  current_setting('pmr.guild_codes', true) = '0'
  AND current_setting('pmr.cluster_codes', true) = '0',
  'D3: guild_codes/cluster_guild_codes are empty for an unknown auth.uid()'
);
SELECT ok(
  current_setting('pmr.mapping_rows', true) = '0'
  AND current_setting('pmr.policy_rows', true) = '0',
  'D4: mapping_rows/policy_rows are empty for an unknown auth.uid()'
);
SELECT ok(
  current_setting('pmr.is_admin', true) = 'false'
  AND current_setting('pmr.competitive', true) = 'false'
  AND current_setting('pmr.can_manage', true) = 'false',
  'D5: is_app_admin/is_competitive_reader/can_manage_player_meta are all false for an unknown auth.uid()'
);

SELECT * FROM finish();
ROLLBACK;
\endif

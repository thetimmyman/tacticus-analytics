BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- Server-only RPCs are service_role-only; browser RPCs gate to own guild, same cluster or app admin.
-- Service role comes from the database role, never JWT claims; p_cluster_code is compat-only.

SELECT plan(54);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260801120000'
      AND name = 'wi4450_sensitive_rpc_boundaries'
  ),
  1,
  'the WI-4450 sensitive-RPC migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_player_stats_comprehensive(text,text,text)'::regprocedure,
      'public.get_war_player_stats(text,text)'::regprocedure,
      'public.get_war_stats(text,text)'::regprocedure,
      'public.get_cluster_battle_data_for_cluster(text,text)'::regprocedure,
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
  ),
  8,
  'all eight exact Workstream B regprocedures exist'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname IN (
        'get_player_stats_comprehensive',
        'get_war_player_stats',
        'get_war_stats',
        'get_cluster_battle_data_for_cluster',
        'get_player_performance_in_cluster',
        'get_season_token_stats',
        'get_season_token_stats_batch',
        'get_player_performance_summary'
      )
  ),
  8,
  'no alternate overload remains callable for any Workstream B RPC name'
);

SELECT is(
  (
    SELECT function.pronargdefaults
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure
  ),
  1::smallint,
  'season token stats retains one trailing default'
);

SELECT ok(
  (
    SELECT
      function.pronargdefaults = 1
      AND pg_catalog.pg_get_expr(function.proargdefaults, 0)
        LIKE '%Legendary%'
      AND pg_catalog.pg_get_expr(function.proargdefaults, 0)
        LIKE '%Mythic%'
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
  ),
  'performance summary retains the Legendary/Mythic rarity default'
);

SELECT is(
  (
    SELECT function.pronargdefaults
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_cluster_battle_data_for_cluster(text,text)'::regprocedure
  ),
  1::smallint,
  'the service-only cluster battle RPC retains its season default'
);

SELECT is(
  (
    SELECT function.proargnames::text[]
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure
  ),
  ARRAY[
    'p_guild_code',
    'p_season',
    'p_include_cluster',
    'context',
    'guild_code',
    'cluster_code',
    'season',
    'tokens_possible',
    'tokens_spent',
    'tokens_remaining',
    'tokens_per_player_cap',
    'ratio_spent',
    'updated_at',
    'players'
  ]::text[],
  'season token stats retains exact argument and output names'
);

SELECT is(
  (
    SELECT function.proargnames::text[]
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
  ),
  ARRAY[
    'p_guild_code',
    'p_season',
    'p_rarities',
    'user_id',
    'display_name',
    'avg_vs_cluster',
    'avg_vs_guild',
    'avg_vs_cluster_boss_only',
    'avg_vs_guild_boss_only',
    'bosses_played',
    'boss_hits',
    'prime_hits',
    'primes_played',
    'total_battles'
  ]::text[],
  'performance summary retains exact argument and output names'
);

SELECT is(
  (
    SELECT function.proargnames::text[]
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure
  ),
  ARRAY[
    'p_user_id',
    'p_guild_code',
    'p_cluster_code',
    'p_season',
    'player_name',
    'guild_code',
    'total_damage',
    'battle_count',
    'vs_guild_pct',
    'vs_cluster_pct',
    'guild_rank',
    'total_players_in_guild',
    'cluster_rank',
    'total_players_in_cluster'
  ]::text[],
  'cluster performance retains exact argument and output names'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_language AS language
      ON language.oid = function.prolang
    WHERE function.oid IN (
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND language.lanname = 'sql'
      AND function.provolatile = 's'::"char"
      AND function.prosecdef
  ),
  2,
  'both SQL analytics RPCs remain SQL, STABLE, and SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT
      language.lanname = 'plpgsql'
      AND function.provolatile = 'v'::"char"
      AND function.prosecdef
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_language AS language
      ON language.oid = function.prolang
    WHERE function.oid =
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure
  ),
  'season token stats remains volatile PL/pgSQL SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT
      language.lanname = 'plpgsql'
      AND function.provolatile = 'v'::"char"
      AND NOT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_language AS language
      ON language.oid = function.prolang
    WHERE function.oid =
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure
  ),
  'cluster performance remains volatile PL/pgSQL SECURITY INVOKER'
);

SELECT is(
  (
    SELECT function.proconfig
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure
  ),
  ARRAY['search_path=public, auth']::text[],
  'season token stats retains its fixed public/auth search path'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND function.proconfig = ARRAY['search_path=public']::text[]
  ),
  2,
  'both SQL analytics RPCs retain their fixed public search path'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%_pm_caller_guild_codes%'
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%_pm_caller_cluster_guild_codes%'
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%_pm_caller_is_app_admin%'
  ),
  4,
  'every retained browser RPC uses all three existing WI-630 scope helpers'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%current_setting(%role%'
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%session_user%'
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%service_role%'
  ),
  4,
  'every retained browser RPC derives the service bypass from the effective database role'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%caller_authorization AS MATERIALIZED%'
  ),
  2,
  'both SQL analytics RPCs materialize caller authorization once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%CROSS JOIN caller_authorization%'
      AND pg_catalog.pg_get_functiondef(function.oid)
        LIKE '%WHERE caller_scope.allowed%'
  ),
  2,
  'both SQL analytics result projections are gated by caller authorization'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure
    )
      AND pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(function.oid),
        '_pm_caller_guild_codes'
      ) > 0
      AND pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(function.oid),
        'RETURN QUERY'
      ) > pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(function.oid),
        '_pm_caller_guild_codes'
      )
  ),
  2,
  'both PL/pgSQL RPCs authorize before their first result query'
);

SELECT is(
  (
    SELECT (
      pg_catalog.length(definition)
      - pg_catalog.length(
        pg_catalog.replace(definition, 'p_cluster_code', '')
      )
    ) / pg_catalog.length('p_cluster_code')
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure
    ) AS source
  ),
  1,
  'p_cluster_code remains only as the compatibility argument and never selects scope'
);

SELECT ok(
  (
    SELECT
      pg_catalog.strpos(definition, 'FROM public.guild_config AS gc') > 0
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(definition, 'FROM public.guild_config AS gc')
      AND definition LIKE
        '%gc.cluster_code = v_target_cluster_code%'
      AND definition LIKE
        '%AND gc.cluster_id = v_target_cluster_id%'
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure
    ) AS source
  ),
  'cluster performance derives the comparison cluster from the target guild before results'
);

SELECT ok(
  (
    SELECT
      (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_season_token_stats(text,integer,boolean)'::regprocedure
      ) LIKE '%pm.cluster_code = v_cluster_code%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_season_token_stats(text,integer,boolean)'::regprocedure
      ) NOT LIKE '%v_cluster_id%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_season_token_stats(text,integer,boolean)'::regprocedure
      ) NOT LIKE '%token_burn_state%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_season_token_stats(text,integer,boolean)'::regprocedure
      ) NOT LIKE '%burned_tokens%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_season_token_stats(text,integer,boolean)'::regprocedure
      ) LIKE '%tokens_spent_raw%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_player_performance_summary(text,text,text[])'::regprocedure
      ) LIKE
        '%gc.cluster_code = (SELECT cluster_code FROM guild_cluster)%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_player_performance_summary(text,text,text[])'::regprocedure
      ) NOT LIKE '%cluster_id%'
      AND (
        SELECT pg_catalog.pg_get_functiondef(function.oid)
        FROM pg_catalog.pg_proc AS function
        WHERE function.oid =
          'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure
      ) LIKE '%gc.cluster_id = v_target_cluster_id%'
  ),
  'only cluster performance changes cluster derivation; other analytics retain their existing calculations'
);

SELECT ok(
  (
    SELECT
      pg_catalog.strpos(definition, '_pm_caller_guild_codes') > 0
      AND pg_catalog.strpos(definition, 'p_guild_code is required')
        > pg_catalog.strpos(definition, '_pm_caller_guild_codes')
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(definition, '_pm_caller_guild_codes')
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_season_token_stats(text,integer,boolean)'::regprocedure
    ) AS source
  ),
  'season token authorization precedes validation and private result queries'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND pg_catalog.pg_get_functiondef(function.oid)
        !~* '\m(INSERT|UPDATE|DELETE|MERGE|EXECUTE|TRUNCATE)\M'
  ),
  4,
  'all four rewritten RPC bodies remain static and read-only'
);

SELECT set_eq(
  $actual$
    SELECT
      function.oid::regprocedure::text || '|' ||
      COALESCE(grantee.rolname, 'PUBLIC')::text
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = acl.grantee
    WHERE function.oid IN (
      'public.get_player_stats_comprehensive(text,text,text)'::regprocedure,
      'public.get_war_player_stats(text,text)'::regprocedure,
      'public.get_war_stats(text,text)'::regprocedure,
      'public.get_cluster_battle_data_for_cluster(text,text)'::regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
  $actual$,
  $expected$
    VALUES
      ('get_player_stats_comprehensive(text,text,text)|service_role'::text),
      ('get_war_player_stats(text,text)|service_role'::text),
      ('get_war_stats(text,text)|service_role'::text),
      ('get_cluster_battle_data_for_cluster(text,text)|service_role'::text)
  $expected$,
  'the four server RPCs have exact service_role-only non-owner ACLs'
);

SELECT set_eq(
  $actual$
    SELECT
      function.oid::regprocedure::text || '|' ||
      COALESCE(grantee.rolname, 'PUBLIC')::text
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = acl.grantee
    WHERE function.oid IN (
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
  $actual$,
  $expected$
    VALUES
      ('get_player_performance_in_cluster(text,text,text,text)|authenticated'::text),
      ('get_player_performance_in_cluster(text,text,text,text)|service_role'::text),
      ('get_season_token_stats(text,integer,boolean)|authenticated'::text),
      ('get_season_token_stats(text,integer,boolean)|service_role'::text),
      ('get_season_token_stats_batch(text,text[])|authenticated'::text),
      ('get_season_token_stats_batch(text,text[])|service_role'::text),
      ('get_player_performance_summary(text,text,text[])|authenticated'::text),
      ('get_player_performance_summary(text,text,text[])|service_role'::text)
  $expected$,
  'the four browser RPCs have exact authenticated/service_role non-owner ACLs'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    WHERE function.oid IN (
      'public.get_player_stats_comprehensive(text,text,text)'::regprocedure,
      'public.get_war_player_stats(text,text)'::regprocedure,
      'public.get_war_stats(text,text)'::regprocedure,
      'public.get_cluster_battle_data_for_cluster(text,text)'::regprocedure,
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  0,
  'PUBLIC has no execute path to any Workstream B RPC'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (
      VALUES
        ('public.get_player_stats_comprehensive(text,text,text)'),
        ('public.get_war_player_stats(text,text)'),
        ('public.get_war_stats(text,text)'),
        ('public.get_cluster_battle_data_for_cluster(text,text)'),
        ('public.get_player_performance_in_cluster(text,text,text,text)'),
        ('public.get_season_token_stats(text,integer,boolean)'),
        ('public.get_season_token_stats_batch(text,text[])'),
        ('public.get_player_performance_summary(text,text,text[])')
    ) AS signatures(signature)
    WHERE pg_catalog.has_function_privilege(
      'anon',
      signatures.signature,
      'EXECUTE'
    )
  ),
  0,
  'anon cannot execute any Workstream B RPC'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (
      VALUES
        ('public.get_player_stats_comprehensive(text,text,text)'),
        ('public.get_war_player_stats(text,text)'),
        ('public.get_war_stats(text,text)'),
        ('public.get_cluster_battle_data_for_cluster(text,text)')
    ) AS signatures(signature)
    WHERE pg_catalog.has_function_privilege(
      'authenticated',
      signatures.signature,
      'EXECUTE'
    )
  ),
  0,
  'authenticated cannot execute any server-only RPC'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (
      VALUES
        ('public.get_player_performance_in_cluster(text,text,text,text)'),
        ('public.get_season_token_stats(text,integer,boolean)'),
        ('public.get_season_token_stats_batch(text,text[])'),
        ('public.get_player_performance_summary(text,text,text[])')
    ) AS signatures(signature)
    WHERE pg_catalog.has_function_privilege(
      'authenticated',
      signatures.signature,
      'EXECUTE'
    )
  ),
  4,
  'authenticated retains all four caller-bound browser RPCs'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (
      VALUES
        ('public.get_player_stats_comprehensive(text,text,text)'),
        ('public.get_war_player_stats(text,text)'),
        ('public.get_war_stats(text,text)'),
        ('public.get_cluster_battle_data_for_cluster(text,text)'),
        ('public.get_player_performance_in_cluster(text,text,text,text)'),
        ('public.get_season_token_stats(text,integer,boolean)'),
        ('public.get_season_token_stats_batch(text,text[])'),
        ('public.get_player_performance_summary(text,text,text[])')
    ) AS signatures(signature)
    WHERE pg_catalog.has_function_privilege(
      'service_role',
      signatures.signature,
      'EXECUTE'
    )
  ),
  8,
  'service_role retains all eight approved RPC contracts'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    WHERE function.oid IN (
      'public.get_player_stats_comprehensive(text,text,text)'::regprocedure,
      'public.get_war_player_stats(text,text)'::regprocedure,
      'public.get_war_stats(text,text)'::regprocedure,
      'public.get_cluster_battle_data_for_cluster(text,text)'::regprocedure,
      'public.get_player_performance_in_cluster(text,text,text,text)'::regprocedure,
      'public.get_season_token_stats(text,integer,boolean)'::regprocedure,
      'public.get_season_token_stats_batch(text,text[])'::regprocedure,
      'public.get_player_performance_summary(text,text,text[])'::regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND acl.is_grantable
  ),
  0,
  'no Workstream B execute grant carries grant option'
);

ALTER TABLE auth.users DISABLE TRIGGER USER;
-- sync_guild_cluster_id would repair the deliberately corrupt guild row.
ALTER TABLE public.guild_config DISABLE TRIGGER USER;
ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  extensions.throws_ok(text, character, text, text)
  TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$
    SELECT public.get_player_stats_comprehensive(
      'W4450R-A1',
      '4450',
      'WI-4450 RPC Own'
    )
  $sql$,
  '42501',
  NULL,
  'authenticated direct execution of player stats is denied by the ACL'
);

SELECT throws_ok(
  $sql$
    SELECT *
    FROM public.get_war_player_stats('wi4450-war', 'W4450R-A1')
  $sql$,
  '42501',
  NULL,
  'authenticated direct execution of war player stats is denied by the ACL'
);

SELECT throws_ok(
  $sql$
    SELECT *
    FROM public.get_war_stats('wi4450-war', 'W4450R-A1')
  $sql$,
  '42501',
  NULL,
  'authenticated direct execution of war stats is denied by the ACL'
);

SELECT throws_ok(
  $sql$
    SELECT *
    FROM public.get_cluster_battle_data_for_cluster('W4450RA', '4450')
  $sql$,
  '42501',
  NULL,
  'authenticated direct execution of raw cluster battle data is denied by the ACL'
);
RESET ROLE;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('44504000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-own@example.test'),
  ('44504000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-same@example.test'),
  ('44504000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-cross@example.test'),
  ('44504000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-admin@example.test'),
  ('44504000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-former@example.test'),
  ('44504000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-unmapped@example.test'),
  ('44504000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-clusterless@example.test');

INSERT INTO public.clusters (
  id,
  cluster_code,
  display_name,
  created_at,
  is_active
)
VALUES
  ('44504000-0000-0000-0000-0000000000a0', 'W4450RA', 'WI-4450 RPC Cluster A', now(), true),
  ('44504000-0000-0000-0000-0000000000b0', 'W4450RB', 'WI-4450 RPC Cluster B', now(), true);

INSERT INTO public.guild_config (
  id,
  guild_code,
  guild_id,
  guild_tag,
  display_name,
  cluster_code,
  cluster_id,
  is_cluster,
  created_at,
  enabled,
  token_offender_threshold
)
VALUES
  (-445041, 'W4450R-A1', 'wi4450-rpc-a1', 'W45RA1', 'WI-4450 RPC Guild A1', 'W4450RA', '44504000-0000-0000-0000-0000000000a0', true, now(), true, 4),
  (-445042, 'W4450R-A2', 'wi4450-rpc-a2', 'W45RA2', 'WI-4450 RPC Guild A2', 'W4450RA', '44504000-0000-0000-0000-0000000000a0', true, now(), true, 4),
  (-445043, 'W4450R-B1', 'wi4450-rpc-b1', 'W45RB1', 'WI-4450 RPC Guild B1', 'W4450RB', '44504000-0000-0000-0000-0000000000b0', true, now(), true, 4),
  (-445044, 'W4450R-C1', 'wi4450-rpc-c1', 'W45RC1', 'WI-4450 RPC Clusterless Guild', NULL, NULL, false, now(), true, 4),
  (-445045, 'W4450R-X1', 'wi4450-rpc-x1', 'W45RX1', 'WI-4450 RPC Inconsistent Guild', 'W4450RA', '44504000-0000-0000-0000-0000000000b0', true, now(), true, 4);

INSERT INTO public.player_mapping (
  id,
  user_id,
  player_id,
  display_name,
  guild_code,
  cluster_code,
  cluster_id,
  role,
  is_current,
  is_active,
  protected,
  is_app_admin,
  created_at,
  updated_at
)
VALUES
  (-445041, '44504000-0000-0000-0000-000000000001', 'w4450r-player-a1', 'WI-4450 RPC Own', 'W4450R-A1', 'W4450RA', '44504000-0000-0000-0000-0000000000a0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-445042, '44504000-0000-0000-0000-000000000002', 'w4450r-player-a2', 'WI-4450 RPC Same', 'W4450R-A2', 'FORGED', '44504000-0000-0000-0000-0000000000b0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-445043, '44504000-0000-0000-0000-000000000003', 'w4450r-player-b1', 'WI-4450 RPC Cross', 'W4450R-B1', 'W4450RB', '44504000-0000-0000-0000-0000000000b0', 'leader'::public.app_role, true, true, false, false, now(), now()),
  (-445044, '44504000-0000-0000-0000-000000000004', 'w4450r-admin-b1', 'WI-4450 RPC Admin', 'W4450R-B1', 'W4450RB', '44504000-0000-0000-0000-0000000000b0', 'member'::public.app_role, true, true, false, true, now(), now()),
  (-445045, '44504000-0000-0000-0000-000000000005', 'w4450r-former-a1', 'WI-4450 RPC Former', 'W4450R-A1', 'W4450RA', '44504000-0000-0000-0000-0000000000a0', 'officer'::public.app_role, false, false, false, true, now(), now()),
  (-445047, '44504000-0000-0000-0000-000000000007', 'w4450r-player-c1', 'WI-4450 RPC Clusterless', 'W4450R-C1', NULL, NULL, 'member'::public.app_role, true, true, false, false, now(), now());

INSERT INTO public."EOT_GR_data" (
  id,
  "Guild",
  "Season",
  "displayName",
  "Name",
  "damageType",
  "damageDealt",
  tier,
  "set",
  "completedOn",
  "encounterId",
  rarity,
  "userId",
  "encounterIndex",
  "maxHp",
  "remainingHp",
  cluster_code
)
OVERRIDING SYSTEM VALUE
VALUES
  (-445041, 'W4450R-A1', '4450', 'WI-4450 RPC Own', 'WI-4450 Boss', 'Battle', 100, 5, 1, '2026-07-28 12:00:00+00', 0, 'Legendary', 'w4450r-player-a1', 0, 1000, 900, 'W4450RA'),
  (-445042, 'W4450R-A2', '4450', 'WI-4450 RPC Same', 'WI-4450 Boss', 'Battle', 200, 5, 1, '2026-07-28 12:01:00+00', 0, 'Legendary', 'w4450r-player-a2', 0, 1000, 800, 'W4450RA'),
  (-445043, 'W4450R-B1', '4450', 'WI-4450 RPC Cross', 'WI-4450 Boss', 'Battle', 300, 5, 1, '2026-07-28 12:02:00+00', 0, 'Legendary', 'w4450r-player-b1', 0, 1000, 700, 'W4450RB'),
  (-445044, 'W4450R-A1', '4450', 'WI-4450 RPC Own', 'WI-4450 Epic Boss', 'Battle', 50, 4, 1, '2026-07-28 12:03:00+00', 0, 'Epic', 'w4450r-player-a1', 0, 500, 450, 'W4450RA'),
  (-445045, 'W4450R-C1', '4450', 'WI-4450 RPC Clusterless', 'WI-4450 Boss', 'Battle', 150, 5, 1, '2026-07-28 12:04:00+00', 0, 'Legendary', 'w4450r-player-c1', 0, 1000, 850, NULL),
  (-445046, 'W4450R-X1', '4450', 'WI-4450 RPC Inconsistent', 'WI-4450 Boss', 'Battle', 1000, 5, 1, '2026-07-28 12:05:00+00', 0, 'Legendary', 'w4450r-player-x1', 0, 1000, 0, 'W4450RA');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  0,
  'an authenticated request without a subject gets zero rows from all browser RPCs'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000006', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  0,
  'a valid authenticated subject without player_mapping gets zero rows from all browser RPCs'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  0,
  'an inactive-only former officer/app-admin gets zero rows from all browser RPCs'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  4,
  'a current member retains all four browser RPCs for the own guild'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_player_performance_summary('W4450R-A1', '4450')
  ),
  1,
  'the performance-summary default rarity call shape is preserved'
);

SELECT results_eq(
  $actual$
    SELECT context
    FROM public.get_season_token_stats('W4450R-A1', 4450)
  $actual$,
  $expected$
    VALUES ('guild'::text)
  $expected$,
  'the season-token default still omits the optional cluster row'
);

SELECT is(
  (
    SELECT tokens_spent
    FROM public.get_season_token_stats_batch(
      'W4450R-A1',
      ARRAY['4450']
    )
    WHERE user_id = 'w4450r-player-a1'
  ),
  2,
  'batch token participation remains all-rarity and includes the Epic battle'
);

SELECT results_eq(
  $actual$
    SELECT context
    FROM public.get_season_token_stats('W4450R-A1', 4450, true)
  $actual$,
  $expected$
    VALUES ('guild'::text), ('cluster'::text)
  $expected$,
  'the include-cluster call shape retains guild and server-derived cluster rows'
);

SELECT ok(
  (
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(token_stats.players) AS player
      WHERE player ->> 'player_id' = 'w4450r-player-x1'
    )
    FROM public.get_season_token_stats('W4450R-A1', 4450, true)
      AS token_stats
    WHERE token_stats.context = 'cluster'
  ),
  'the cluster token payload retains its existing cluster-code calculation semantics'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  4,
  'a current same-cluster member retains all four browser RPCs for the target guild'
);

SELECT is(
  (
    SELECT total_players_in_cluster
    FROM public.get_player_performance_in_cluster(
      'w4450r-player-a1',
      'W4450R-A1',
      'CALLER-SPOOFED-CLUSTER',
      '4450'
    )
  ),
  2,
  'cluster performance uses the target guild server cluster instead of p_cluster_code'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000007', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-C1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-C1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-C1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-c1', 'W4450R-C1', 'FORGED', '4450'))
  )::integer,
  4,
  'a current clusterless member retains all four own-guild browser RPCs'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'W4450RA', '4450'))
  )::integer,
  0,
  'a current cross-cluster leader has no global bypass'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'W4450RA', '4450'))
  )::integer,
  0,
  'a forged service-role JWT claim cannot widen an authenticated database role'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  4,
  'a current server-owned app-admin mapping retains all four target-guild RPCs'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'FORGED', '4450'))
  )::integer,
  4,
  'effective service_role without an end-user JWT retains all four browser RPCs'
);

SELECT throws_ok(
  $sql$
    SELECT *
    FROM public.get_season_token_stats(NULL, 4450, false)
  $sql$,
  'P0001',
  'p_guild_code is required',
  'authorized service calls retain the existing required-guild validation'
);
RESET ROLE;

UPDATE public.player_mapping
SET is_current = false
WHERE user_id = '44504000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44504000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    (SELECT count(*) FROM public.get_season_token_stats('W4450R-A1', 4450, false))
    + (SELECT count(*) FROM public.get_season_token_stats_batch('W4450R-A1', ARRAY['4450']))
    + (SELECT count(*) FROM public.get_player_performance_summary('W4450R-A1', '4450', ARRAY['Legendary']))
    + (SELECT count(*) FROM public.get_player_performance_in_cluster('w4450r-player-a1', 'W4450R-A1', 'W4450RA', '4450'))
  )::integer,
  0,
  'membership removal immediately denies all four browser RPCs'
);
RESET ROLE;

ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
ALTER TABLE public.guild_config ENABLE TRIGGER USER;
ALTER TABLE auth.users ENABLE TRIGGER USER;

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT * FROM finish();
ROLLBACK;

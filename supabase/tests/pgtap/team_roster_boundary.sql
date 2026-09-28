BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- End users need exactly one current server-owned mapping: member self, officer/leader own guild or
-- same server-derived cluster, admin and service_role any. Everything else fails closed.

SELECT plan(44);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260801020000'
      AND name = 'wi4450_team_roster_boundary'
  ),
  1,
  'the team-roster boundary migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'get_guild_team_roster'
      AND pg_catalog.oidvectortypes(function.proargtypes) = 'text, text[]'
  ),
  1,
  'the exact get_guild_team_roster(text,text[]) contract exists once'
);

SELECT is(
  (
    SELECT pg_catalog.oidvectortypes(function.proargtypes)
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  'text, text[]',
  'the input argument types and order are unchanged'
);

SELECT is(
  (
    SELECT function.proargnames::text[]
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  ARRAY[
    'p_guild_code',
    'p_unit_ids',
    'player_display_name',
    'guild_role',
    'unit_id',
    'hero_display_name',
    'category',
    'web_icon_url',
    'stars',
    'progression_index',
    'rarity',
    'rank_name',
    'xp_level',
    'active_ability_level',
    'passive_ability_level',
    'synced_at'
  ]::text[],
  'the input and 14 output column names retain their exact order'
);

SELECT is(
  (
    SELECT ARRAY(
      SELECT pg_catalog.format_type(
        function.proallargtypes[arg_position],
        NULL
      )
      FROM pg_catalog.generate_subscripts(
        function.proallargtypes,
        1
      ) AS positions(arg_position)
      ORDER BY arg_position
    )
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  ARRAY[
    'text',
    'text[]',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'integer',
    'integer',
    'text',
    'text',
    'integer',
    'integer',
    'integer',
    'timestamp with time zone'
  ]::text[],
  'the input and 14 output column types retain their exact order'
);

SELECT is(
  (
    SELECT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  true,
  'the roster projection remains SECURITY DEFINER'
);

SELECT is(
  (
    SELECT function.proconfig
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the definer function has an empty fixed search path'
);

SELECT is(
  (
    SELECT language.lanname
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_language AS language
      ON language.oid = function.prolang
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  'plpgsql',
  'the roster projection remains PL/pgSQL'
);

SELECT is(
  (
    SELECT pg_catalog.pg_get_userbyid(function.proowner)
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  'postgres',
  'the roster projection retains the postgres owner'
);

SELECT is(
  (
    SELECT function.provolatile
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  'v'::"char",
  'the roster projection retains volatile semantics'
);

SELECT ok(
  (
    SELECT pg_catalog.pg_get_functiondef(function.oid)
      !~* '\m(INSERT|UPDATE|DELETE|MERGE|EXECUTE|TRUNCATE)\M'
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.get_guild_team_roster(text,text[])'::regprocedure
  ),
  'the function body is static and read-only'
);

SELECT ok(
  (
    SELECT
      pg_catalog.strpos(definition, 'v_uid := auth.uid()') > 0
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(definition, 'v_uid := auth.uid()')
      AND pg_catalog.strpos(definition, 'v_mapping_count <> 1') > 0
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(definition, 'v_mapping_count <> 1')
      AND pg_catalog.strpos(definition, 'v_caller_role NOT IN') > 0
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(definition, 'v_caller_role NOT IN')
      AND pg_catalog.strpos(definition, 'v_self_only := true') > 0
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(definition, 'v_self_only := true')
      AND pg_catalog.strpos(
        definition,
        'v_caller_cluster_id IS DISTINCT FROM v_target_cluster_id'
      ) > 0
      AND pg_catalog.strpos(definition, 'RETURN QUERY')
        > pg_catalog.strpos(
          definition,
          'v_caller_cluster_id IS DISTINCT FROM v_target_cluster_id'
        )
      AND (
        (
          pg_catalog.length(definition)
          - pg_catalog.length(
            pg_catalog.replace(definition, 'RETURN QUERY', '')
          )
        ) / pg_catalog.length('RETURN QUERY')
      ) = 1
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
    ) AS source
  ),
  'authorization completes before the single roster result query'
);

SELECT ok(
  (
    SELECT
      definition LIKE '%FROM public.player_mapping AS pm%'
      AND definition LIKE '%FROM public.guild_config AS gc%'
      AND definition LIKE '%CROSS JOIN public.hero_mappings AS hm%'
      AND definition LIKE '%FROM public.player_roster AS r%'
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
    ) AS source
  ),
  'all application relations are schema-qualified under the empty search path'
);

SELECT ok(
  (
    SELECT
      definition LIKE '%r.player_mapping_id = pm.id%'
      AND definition LIKE '%r.player_mapping_id IS NULL%'
      AND definition LIKE '%r.user_id = pm.user_id%'
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
    ) AS source
  ),
  'the player-mapping and user-id fallback remains present'
);

SELECT ok(
  (
    SELECT
      definition LIKE '%r.synced_at DESC NULLS LAST%'
      AND definition LIKE
        '%((r.player_mapping_id = pm.id) IS TRUE) DESC%'
      AND definition LIKE '%LIMIT 1%'
    FROM (
      SELECT pg_catalog.pg_get_functiondef(function.oid) AS definition
      FROM pg_catalog.pg_proc AS function
      WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
    ) AS source
  ),
  'the newest-row and exact-mapping tie-break remains present'
);

SELECT set_eq(
  $actual$
    SELECT COALESCE(grantee.rolname, 'PUBLIC')::text
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = acl.grantee
    WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
  $actual$,
  $expected$
    VALUES ('authenticated'::text), ('service_role'::text)
  $expected$,
  'only authenticated and service_role have non-owner EXECUTE grants'
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
    WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
      AND acl.is_grantable
  ),
  0,
  'no EXECUTE grant carries grant option'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    WHERE function.oid =
        'public.get_guild_team_roster(text,text[])'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the roster projection'
);

SELECT is(
  pg_catalog.has_function_privilege(
    'anon',
    'public.get_guild_team_roster(text,text[])',
    'EXECUTE'
  ),
  false,
  'anon cannot execute the roster projection'
);

SELECT is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_guild_team_roster(text,text[])',
    'EXECUTE'
  ),
  true,
  'authenticated retains caller-bound roster access'
);

SELECT is(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.get_guild_team_roster(text,text[])',
    'EXECUTE'
  ),
  true,
  'service_role retains trusted roster access'
);

ALTER TABLE auth.users DISABLE TRIGGER USER;
ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('44500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@example.test'),
  ('44500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'peer@example.test'),
  ('44500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'officer@example.test'),
  ('44500000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test'),
  ('44500000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'former@example.test'),
  ('44500000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unmapped@example.test'),
  ('44500000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clusterless@example.test'),
  ('44500000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'same-cluster@example.test'),
  ('44500000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cross-cluster@example.test'),
  ('44500000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo-role@example.test');

INSERT INTO public.clusters (
  id,
  cluster_code,
  display_name,
  created_at,
  is_active
)
VALUES
  ('44500000-0000-0000-0000-0000000000a0', 'W4450A', 'Test Cluster A', now(), true),
  ('44500000-0000-0000-0000-0000000000b0', 'W4450B', 'Test Cluster B', now(), true);

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
  (-445001, 'TW4450-A1', 'tw4450-guild-a1', 'W45A1', 'Test Guild A1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', true, now(), true, 4),
  (-445002, 'TW4450-A2', 'tw4450-guild-a2', 'W45A2', 'Test Guild A2', 'W4450A', '44500000-0000-0000-0000-0000000000a0', true, now(), true, 4),
  (-445003, 'TW4450-B1', 'tw4450-guild-b1', 'W45B1', 'Test Guild B1', 'W4450B', '44500000-0000-0000-0000-0000000000b0', true, now(), true, 4),
  (-445004, 'TW4450-C1', 'tw4450-guild-c1', 'W45C1', 'Test Guild C1', NULL, NULL, false, now(), true, 4);

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
-- Deliberately stale or forged cluster fields: authority comes from guild_config only.
VALUES
  (-445001, '44500000-0000-0000-0000-000000000001', 'tw4450-member', 'Test Member', 'TW4450-A1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', 'Member'::public.app_role, true, true, false, false, now(), now()),
  (-445002, '44500000-0000-0000-0000-000000000002', 'tw4450-peer', 'Test Peer', 'TW4450-A1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-445003, '44500000-0000-0000-0000-000000000003', 'tw4450-officer', 'Test Officer', 'TW4450-A1', 'W4450B', '44500000-0000-0000-0000-0000000000b0', 'Officer'::public.app_role, true, true, false, false, now(), now()),
  (-445004, '44500000-0000-0000-0000-000000000004', 'tw4450-admin', 'Test Admin', 'TW4450-A1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', 'member'::public.app_role, true, true, false, true, now(), now()),
  (-445005, '44500000-0000-0000-0000-000000000005', 'tw4450-former', 'Test Former Officer', 'TW4450-A1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', 'officer'::public.app_role, false, false, false, true, now(), now()),
  (-445007, '44500000-0000-0000-0000-000000000007', 'tw4450-clusterless', 'Test Clusterless Officer', 'TW4450-C1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', 'officer'::public.app_role, true, true, false, false, now(), now()),
  (-445008, '44500000-0000-0000-0000-000000000008', 'tw4450-same-cluster', 'Test Same Cluster', 'TW4450-A2', 'W4450B', '44500000-0000-0000-0000-0000000000b0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-445009, '44500000-0000-0000-0000-000000000009', 'tw4450-cross-cluster', 'Test Cross Cluster', 'TW4450-B1', 'W4450B', '44500000-0000-0000-0000-0000000000b0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-445010, '44500000-0000-0000-0000-00000000000a', 'tw4450-demo-role', 'Test Demo Role', 'TW4450-A1', 'W4450A', '44500000-0000-0000-0000-0000000000a0', 'demo'::public.app_role, true, true, false, false, now(), now());

INSERT INTO public.hero_mappings (
  id,
  unit_id,
  display_name,
  category,
  web_icon_url
)
VALUES
  (
    -445001,
    'tw4450-hero',
    'Test Hero',
    'Hero',
    'https://example.invalid/tw4450-hero.png'
  ),
  (
    -445002,
    'tw4450-alpha-hero',
    'Test Alpha Hero',
    'Hero',
    'https://example.invalid/tw4450-alpha-hero.png'
  );

INSERT INTO public.player_roster (
  id,
  user_id,
  player_mapping_id,
  hero_mapping_id,
  rank_name,
  stars,
  progression_index,
  rarity,
  xp_level,
  active_ability_level,
  passive_ability_level,
  synced_at
)
VALUES
  (
    -445001,
    NULL,
    -445001,
    -445001,
    'Stone I',
    6,
    11,
    'Legendary',
    35,
    44,
    43,
    '2026-07-28 12:00:00+00'
  ),
  (
    -445002,
    '44500000-0000-0000-0000-000000000001',
    NULL,
    -445001,
    'Stone I',
    5,
    10,
    'Epic',
    34,
    42,
    41,
    '2026-07-28 12:00:00+00'
  ),
  (
    -445003,
    '44500000-0000-0000-0000-000000000002',
    NULL,
    -445001,
    'Iron III',
    4,
    9,
    'Epic',
    33,
    40,
    39,
    '2026-07-28 11:00:00+00'
  );

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      NULL,
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'a null guild fails closed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster('TW4450-A1', NULL)
  ),
  0,
  'a null unit-id array fails closed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY[]::text[]
    )
  ),
  0,
  'an empty unit-id array fails closed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-MISSING',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'an unresolved target guild fails closed'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'an authenticated request without a subject fails closed'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000006', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'an authenticated user without a current mapping fails closed'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'a non-current stale app-admin/officer mapping fails closed'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-00000000000a', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'an unrecognized current application role fails closed'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT results_eq(
  $actual$
    SELECT
      player_display_name,
      guild_role,
      unit_id,
      stars
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  $actual$,
  $expected$
    VALUES (
      'Test Member'::text,
      'Member'::text,
      'tw4450-hero'::text,
      6::integer
    )
  $expected$,
  'an ordinary member sees only self in the own guild and the exact mapping row wins the fallback tie'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A2',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'an ordinary member cannot read a foreign guild in the same cluster'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-B1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'a forged service-role JWT claim cannot widen an authenticated member'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub',
    '44500000-0000-0000-0000-000000000001',
    'role',
    'authenticated',
    'user_metadata',
    pg_catalog.jsonb_build_object(
      'is_app_admin',
      true,
      'role',
      'leader'
    ),
    'app_metadata',
    pg_catalog.jsonb_build_object(
      'is_app_admin',
      true,
      'role',
      'service_role'
    )
  )::text,
  true
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-B1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'forged user/app metadata cannot widen a server-mapped member'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT results_eq(
  $actual$
    SELECT
      player_display_name,
      unit_id,
      stars,
      progression_index
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  $actual$,
  $expected$
    VALUES (
      'Test Peer'::text,
      'tw4450-hero'::text,
      4::integer,
      9::integer
    )
  $expected$,
  'a member with only the user-id fallback still sees the retained roster row'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT results_eq(
  $actual$
    SELECT player_display_name || '|' || hero_display_name
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero', 'tw4450-alpha-hero']
    )
  $actual$,
  $expected$
    VALUES
      ('Test Admin|Test Alpha Hero'::text),
      ('Test Admin|Test Hero'::text),
      ('Test Demo Role|Test Alpha Hero'::text),
      ('Test Demo Role|Test Hero'::text),
      ('Test Member|Test Alpha Hero'::text),
      ('Test Member|Test Hero'::text),
      ('Test Officer|Test Alpha Hero'::text),
      ('Test Officer|Test Hero'::text),
      ('Test Peer|Test Alpha Hero'::text),
      ('Test Peer|Test Hero'::text)
  $expected$,
  'a normalized current officer sees the full own guild in player-then-hero display order'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A2',
      ARRAY['tw4450-hero']
    )
  ),
  1,
  'a current officer sees a foreign guild in the same non-null cluster'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-B1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'a current officer cannot read a guild in another cluster'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000007', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'a clusterless officer cannot widen into a foreign guild'
);
RESET ROLE;

UPDATE public.player_mapping
SET role = 'Leader'::public.app_role
WHERE id = -445003;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A2',
      ARRAY['tw4450-hero']
    )
  ),
  1,
  'a normalized current leader sees a foreign guild in the same non-null cluster'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-B1',
      ARRAY['tw4450-hero']
    )
  ),
  1,
  'a current app-admin sees the full valid target guild'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-B1',
      ARRAY['tw4450-hero']
    )
  ),
  1,
  'the effective service database role sees the full valid target guild'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-B1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'a direct postgres session without an authenticated subject is not treated as service_role'
);


ALTER TABLE public.player_mapping
  DROP CONSTRAINT unique_current_user_profile;

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
VALUES (
  -445099,
  '44500000-0000-0000-0000-000000000001',
  'tw4450-member-duplicate',
  'Test Duplicate Member',
  'TW4450-B1',
  'W4450B',
  '44500000-0000-0000-0000-0000000000b0',
  'leader'::public.app_role,
  true,
  true,
  false,
  false,
  now(),
  now()
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'duplicate current mappings fail closed instead of selecting authority'
);
RESET ROLE;

DELETE FROM public.player_mapping
WHERE id = -445099;

ALTER TABLE public.player_mapping
  ADD CONSTRAINT unique_current_user_profile
  EXCLUDE USING btree (user_id WITH =)
  WHERE (is_current IS TRUE AND user_id IS NOT NULL);

DELETE FROM public.player_mapping
WHERE id = -445001;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44500000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_guild_team_roster(
      'TW4450-A1',
      ARRAY['tw4450-hero']
    )
  ),
  0,
  'membership removal revokes roster access immediately'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT finish();
ROLLBACK;

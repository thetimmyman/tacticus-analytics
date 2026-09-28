BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(42);

CREATE TEMP TABLE tw4352_expected_contracts (
  signature text PRIMARY KEY,
  grants text[] NOT NULL
);

INSERT INTO tw4352_expected_contracts (signature, grants)
VALUES
  ('check_feature_access(uuid,text)', ARRAY['authenticated', 'service_role']),
  ('get_features_with_access(uuid)', ARRAY['service_role']),
  ('get_user_access_levels(uuid)', ARRAY['authenticated', 'service_role']),
  ('can_edit_playbooks(uuid)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_current_boss_status_v1(text,text)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_member_season_forecast_v1(text,integer)', ARRAY['authenticated']),
  ('get_command_center_officer_season_forecast_v1(text,integer)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_guild_season_summary_v1(text,text)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_self_roster_v1(text[])', ARRAY['authenticated']),
  ('get_command_center_officer_roster_v1(text,text[])', ARRAY['authenticated', 'service_role']),
  ('get_command_center_self_boss_performance_v1(text,text,text,integer[])', ARRAY['authenticated']),
  ('get_command_center_officer_boss_performance_v1(text,text,integer[],text,text,integer[])', ARRAY['authenticated', 'service_role']),
  ('get_command_center_self_performance_summary_v1(text)', ARRAY['authenticated']),
  ('get_command_center_officer_performance_summary_v1(text,text,integer[])', ARRAY['authenticated', 'service_role']),
  ('get_command_center_self_team_usage_v1(text,text,text)', ARRAY['authenticated']),
  ('get_command_center_officer_team_usage_v1(text,text,integer[],text,text)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_officer_token_summary_v1(text,text)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_self_token_usage_v1(text)', ARRAY['authenticated']),
  ('get_command_center_officer_token_usage_v1(text,text)', ARRAY['authenticated', 'service_role']),
  ('get_command_center_member_token_state_v1(text)', ARRAY['authenticated']),
  ('get_guild_bombs_available(text)', ARRAY['service_role']),
  ('get_command_center_cluster_guild_metadata_v1()', ARRAY['authenticated']),
  ('get_command_center_guild_members_v1()', ARRAY['authenticated']);

CREATE TEMP TABLE tw4352_expected_sources (relation_name text PRIMARY KEY);

INSERT INTO tw4352_expected_sources (relation_name)
VALUES
  ('EOT_GR_data'),
  ('feature_access_grants'),
  ('feature_releases'),
  ('guild_config'),
  ('hero_mappings'),
  ('meta_teams'),
  ('player_mapping'),
  ('player_roster'),
  ('token_burn_state'),
  ('upcoming_season_assignments');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260730210000'
  ),
  'the command-center RPC authority migration (part 2) is recorded'
);

SELECT is(
  (
    SELECT ROW(
      r.rolcanlogin,
      r.rolinherit,
      r.rolsuper,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolreplication,
      r.rolbypassrls
    )::text
    FROM pg_roles AS r
    WHERE r.rolname = 'command_center_rpc_owner'
  ),
  '(f,f,f,f,f,f,f)',
  'the command-center owner is a non-login, non-inheriting, non-privileged role'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM tw4352_expected_contracts AS expected
    JOIN pg_proc AS p
      ON p.oid = ('public.' || expected.signature)::regprocedure
  ),
  23,
  'all 23 narrow command-center contracts exist'
);

SELECT set_eq(
  $actual$
    SELECT
      p.oid::regprocedure::text
      || '|'
      || coalesce(grantee.rolname, 'PUBLIC')
    FROM tw4352_expected_contracts AS expected
    JOIN pg_proc AS p
      ON p.oid = ('public.' || expected.signature)::regprocedure
    CROSS JOIN LATERAL aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) AS acl
    LEFT JOIN pg_roles AS grantee
      ON grantee.oid = acl.grantee
    WHERE acl.privilege_type = 'EXECUTE'
      AND coalesce(grantee.rolname, 'PUBLIC') <> 'command_center_rpc_owner'
  $actual$,
  $expected$
    SELECT expected.signature || '|' || granted_role
    FROM tw4352_expected_contracts AS expected
    CROSS JOIN LATERAL unnest(expected.grants) AS granted_role
  $expected$,
  'all 23 RPCs expose only their exact authenticated/service role matrix'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM tw4352_expected_contracts AS expected
    JOIN pg_proc AS p
      ON p.oid = ('public.' || expected.signature)::regprocedure
    JOIN pg_language AS language
      ON language.oid = p.prolang
    WHERE pg_get_userbyid(p.proowner) <> 'command_center_rpc_owner'
      OR p.prosecdef IS NOT TRUE
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR language.lanname <> 'plpgsql'
      OR p.provolatile <> 's'
      OR p.proparallel <> 'u'
      OR EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
        WHERE acl.is_grantable
      )
  ),
  0,
  'all narrow RPCs have exact volatility, fixed search paths, and no grant option'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM tw4352_expected_sources AS expected
    JOIN pg_class AS c
      ON c.oid = ('public.' || quote_ident(expected.relation_name))::regclass
    WHERE c.relrowsecurity IS NOT TRUE
      OR c.relforcerowsecurity IS NOT TRUE
  ),
  0,
  'all 10 source relations have RLS enabled and forced'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policy AS policy
    JOIN pg_class AS c
      ON c.oid = policy.polrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN (SELECT relation_name FROM tw4352_expected_sources)
      AND 'command_center_rpc_owner'::regrole::oid = ANY (policy.polroles)
      AND policy.polname LIKE 'command_center_rpc_owner_%'
  ),
  20,
  'the owner has the exact paired read/write RLS policy inventory'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM tw4352_expected_sources AS source
    CROSS JOIN (
      VALUES ('anon'), ('authenticated'), ('service_role')
    ) AS role_name(name)
    WHERE has_table_privilege(
      role_name.name,
      'public.' || quote_ident(source.relation_name),
      'SELECT'
    )
  ),
  0,
  'API roles have no direct source-table SELECT corridor'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM tw4352_expected_contracts AS expected
    JOIN pg_proc AS p
      ON p.oid = ('public.' || expected.signature)::regprocedure
    WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0,
  'anon cannot execute any narrow command-center RPC'
);

ALTER TABLE auth.users DISABLE TRIGGER USER;
ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('43520000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@example.test'),
  ('43520000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'officer@example.test'),
  ('43520000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'projection@example.test');

INSERT INTO public.guild_config (
  guild_code,
  display_name,
  enabled,
  cluster_code
)
VALUES
  ('TW4352-TAP-A', 'Test Guild A', true, 'TW4352-TAP-A'),
  ('TW4352-TAP-B', 'Test Guild B', true, 'TW4352-TAP-B'),
  ('TW4352-TAP-C', 'Test Projection Guild', true, 'TW4352-TAP-C');

INSERT INTO public.player_mapping (
  user_id,
  player_id,
  display_name,
  guild_code,
  cluster_code,
  role,
  is_current,
  is_active,
  last_sync_bombs
)
VALUES
  ('43520000-0000-0000-0000-000000000001', 'TW4352-TAP-MEMBER', 'Test Member', 'TW4352-TAP-A', 'TW4352-TAP-A', 'member', true, true, 1),
  ('43520000-0000-0000-0000-000000000002', 'TW4352-TAP-OFFICER', 'Test Officer', 'TW4352-TAP-A', 'TW4352-TAP-A', 'officer', true, true, 2),
  ('43520000-0000-0000-0000-000000000003', 'TW4352-TAP-PROJECTION', 'Test Projection', 'TW4352-TAP-C', 'TW4352-TAP-C', 'member', true, true, 1);

UPDATE public.player_mapping
SET
  last_sync_tokens = 2,
  last_sync_bombs = 1,
  last_sync_at = statement_timestamp() - interval '14 hours',
  next_token_seconds = 3600,
  next_bomb_seconds = 64800
WHERE player_id = 'TW4352-TAP-PROJECTION';

INSERT INTO public.feature_releases (
  feature_key,
  display_name,
  description,
  release_stage,
  icon,
  route,
  value_proposition,
  sort_order
)
VALUES (
  'tw4352-pgtap-feature',
  'Test Feature',
  'Persisted feature metadata',
  'alpha',
  'star',
  '/tw4352',
  'Proves exact metadata projection',
  4352
);

INSERT INTO public.feature_access_grants (
  user_id,
  access_level
)
VALUES (
  '43520000-0000-0000-0000-000000000001',
  'alpha_tester'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_cluster_guild_metadata_v1() $$,
  '42501',
  NULL,
  'an ordinary member cannot call the officer cluster projection'
);

RESET ROLE;
ALTER TABLE public.player_mapping
  DROP CONSTRAINT unique_current_user_profile;
INSERT INTO public.player_mapping (
  user_id,
  player_id,
  display_name,
  guild_code,
  cluster_code,
  role,
  is_current,
  is_active
)
VALUES (
  '43520000-0000-0000-0000-000000000001',
  'TW4352-TAP-MEMBER-DUPLICATE',
  'Test Duplicate Member',
  'TW4352-TAP-B',
  'TW4352-TAP-B',
  'member',
  true,
  true
);

SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_self_roster_v1(ARRAY['TW4352-H1']) $$,
  '42501',
  NULL,
  'self roster rejects duplicate active current mappings'
);

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_self_performance_summary_v1('100') $$,
  '42501',
  NULL,
  'self performance rejects duplicate active current mappings'
);

RESET ROLE;
DELETE FROM public.player_mapping
WHERE player_id = 'TW4352-TAP-MEMBER-DUPLICATE';
ALTER TABLE public.player_mapping
  ADD CONSTRAINT unique_current_user_profile
  EXCLUDE USING btree (user_id WITH =)
  WHERE (is_current IS TRUE AND user_id IS NOT NULL);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'service_role')
  )::text,
  true
);
SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_cluster_guild_metadata_v1() $$,
  '42501',
  NULL,
  'a forged service-role metadata claim cannot widen an ordinary member'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated')::text,
  true
);
SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT public.check_feature_access(NULL, 'tw4352-pgtap-feature') $$,
  '42501',
  NULL,
  'feature access rejects authenticated requests without a subject'
);

SELECT throws_ok(
  $$ SELECT public.get_user_access_levels(NULL) $$,
  '42501',
  NULL,
  'access levels reject authenticated requests without a subject'
);

SELECT throws_ok(
  $$ SELECT public.can_edit_playbooks(NULL) $$,
  '42501',
  NULL,
  'playbook eligibility rejects authenticated requests without a subject'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-00000000ffff',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_self_roster_v1(ARRAY['TW4352-H1']) $$,
  '42501',
  NULL,
  'self roster rejects an authenticated subject without a current mapping'
);

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_self_performance_summary_v1('100') $$,
  '42501',
  NULL,
  'self performance rejects an authenticated subject without a current mapping'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_command_center_cluster_guild_metadata_v1()
  ),
  1,
  'an officer receives only the enabled guild in the derived cluster'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_command_center_guild_members_v1()
  ),
  2,
  'an officer receives the two active current members in the derived guild'
);

SELECT is(
  (
    SELECT bool_and(member.guild_code = 'TW4352-TAP-A')
    FROM public.get_command_center_guild_members_v1() AS member
  ),
  true,
  'the officer member projection cannot cross the derived guild boundary'
);

RESET ROLE;
SET ROLE service_role;

SELECT is(
  (
    SELECT
      feature.display_name
      || ':'
      || feature.description
      || ':'
      || feature.icon
      || ':'
      || feature.route
      || ':'
      || feature.value_proposition
      || ':'
      || feature.sort_order::text
    FROM public.get_features_with_access(
      '43520000-0000-0000-0000-000000000001'
    ) AS feature
    WHERE feature.feature_key = 'tw4352-pgtap-feature'
  ),
  'Test Feature:Persisted feature metadata:star:/tw4352:Proves exact metadata projection:4352',
  'feature access returns persisted metadata through one set-wise projection'
);

SELECT is(
  (
    SELECT bombs_available::text || ':' || roster_size::text
    FROM public.get_guild_bombs_available('TW4352-TAP-A')
  ),
  '2:2',
  'the service-only bombs projection returns the projected available count and roster size'
);

RESET ROLE;

UPDATE public.player_mapping
SET
  last_sync_tokens = CASE
    WHEN player_id = 'TW4352-TAP-MEMBER' THEN 1
    ELSE 2
  END,
  last_sync_bombs = CASE
    WHEN player_id = 'TW4352-TAP-MEMBER' THEN 0
    ELSE 1
  END,
  last_sync_at = statement_timestamp() - interval '2 hours',
  next_token_seconds = 3600,
  next_bomb_seconds = 7200
WHERE player_id IN ('TW4352-TAP-MEMBER', 'TW4352-TAP-OFFICER');

INSERT INTO public.hero_mappings (unit_id, display_name)
VALUES
  ('TW4352-H1', 'Aunshi'),
  ('TW4352-H2', 'Ragnar'),
  ('TW4352-M1', 'Biovore');

INSERT INTO public.meta_teams (
  team_name,
  is_meta,
  sort_order,
  trigger_heroes,
  match_type
)
VALUES (
  'Test Meta Pair',
  true,
  -4352,
  '["Aunshi", "Ragnar"]'::jsonb,
  'all'
);

INSERT INTO public.token_burn_state (
  guild_code,
  season,
  player_id,
  burned_tokens,
  time_over_cap_seconds
)
VALUES
  ('TW4352-TAP-A', '100', 'TW4352-TAP-MEMBER', 1, 120),
  ('TW4352-TAP-A', '100', 'TW4352-TAP-OFFICER', 0, 0);

INSERT INTO public."EOT_GR_data" (
  "Guild",
  "Season",
  "displayName",
  "Name",
  "damageType",
  "damageDealt",
  "loopIndex",
  tier,
  set,
  "startedOn",
  "completedOn",
  timestamp,
  "encounterId",
  rarity,
  "userId",
  "encounterIndex",
  "encounterType",
  "heroDetails",
  "machineOfWarDetails",
  type,
  "maxHp",
  "remainingHp"
)
VALUES
  (
    'TW4352-TAP-A', '100', 'Test Member', 'Boss A', 'Battle',
    100, 0, 1, 0, statement_timestamp() - interval '5 hours',
    statement_timestamp() - interval '5 hours',
    statement_timestamp() - interval '5 hours', 0, 'Legendary',
    'TW4352-TAP-MEMBER', 0, 'Boss',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Boss', 1000, 900
  ),
  (
    'TW4352-TAP-A', '100', 'Test Officer', 'Boss A', 'Battle',
    200, 0, 1, 0, statement_timestamp() - interval '4 hours',
    statement_timestamp() - interval '4 hours',
    statement_timestamp() - interval '4 hours', 0, 'Legendary',
    'TW4352-TAP-OFFICER', 0, 'Boss',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Boss', 1000, 800
  ),
  (
    'TW4352-TAP-A', '100', 'Test Member', 'Boss A', 'Battle',
    120, 1, 1, 0, statement_timestamp() - interval '3 hours',
    statement_timestamp() - interval '3 hours',
    statement_timestamp() - interval '3 hours', 0, 'Legendary',
    'TW4352-TAP-MEMBER', 0, 'Boss',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Boss', 1000, 880
  ),
  (
    'TW4352-TAP-A', '100', 'Test Officer', 'Boss A', 'Battle',
    220, 1, 1, 0, statement_timestamp() - interval '2 hours',
    statement_timestamp() - interval '2 hours',
    statement_timestamp() - interval '2 hours', 0, 'Legendary',
    'TW4352-TAP-OFFICER', 0, 'Boss',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Boss', 1000, 780
  ),
  (
    'TW4352-TAP-A', '100', 'Test Member', 'Boss A', 'Battle',
    140, 2, 1, 0, statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour', 0, 'Legendary',
    'TW4352-TAP-MEMBER', 0, 'Boss',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Boss', 1000, 860
  ),
  (
    'TW4352-TAP-A', '100', 'Test Officer', 'Prime A', 'Battle',
    80, 2, 1, 0, statement_timestamp() - interval '50 minutes',
    statement_timestamp() - interval '50 minutes',
    statement_timestamp() - interval '50 minutes', 1, 'Legendary',
    'TW4352-TAP-OFFICER', 1, 'Prime',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Prime', 500, 420
  ),
  (
    'TW4352-TAP-A', '100', 'Test Officer', 'Prime B', 'Battle',
    90, 2, 1, 0, statement_timestamp() - interval '40 minutes',
    statement_timestamp() - interval '40 minutes',
    statement_timestamp() - interval '40 minutes', 2, 'Legendary',
    'TW4352-TAP-OFFICER', 2, 'Prime',
    '[{"unitId":"TW4352-H1"},{"unitId":"TW4352-H2"}]',
    '{"unitId":"TW4352-M1"}', 'Prime', 500, 410
  ),
  (
    'TW4352-TAP-A', '100', 'Test Member', 'Boss A', 'Bomb',
    0, 2, 1, 0, statement_timestamp() - interval '30 minutes',
    statement_timestamp() - interval '30 minutes',
    statement_timestamp() - interval '30 minutes', 0, 'Legendary',
    'TW4352-TAP-MEMBER', 0, 'Boss',
    '[]', NULL, 'Boss', 1000, 860
  ),
  (
    'TW4352-TAP-C', '100', 'Test Projection', 'Boss A', 'Battle',
    100, 0, 1, 0, statement_timestamp() - interval '13 hours 30 minutes',
    statement_timestamp() - interval '13 hours 30 minutes',
    statement_timestamp() - interval '13 hours 30 minutes', 0, 'Legendary',
    'TW4352-TAP-PROJECTION', 0, 'Boss',
    '[]', NULL, 'Boss', 1000, 900
  );

INSERT INTO public.upcoming_season_assignments (
  guild_code,
  season_number,
  player_id,
  display_name,
  token_allocations,
  uses_flexible_tokens,
  total_tokens_allocated
)
VALUES (
  'TW4352-TAP-A',
  '100',
  'TW4352-TAP-OFFICER',
  'Test Officer',
  '{"Boss A":3,"Boss B":0}'::jsonb,
  true,
  3
);

CREATE TEMP TABLE tw4352_fixture_mappings AS
SELECT id, player_id
FROM public.player_mapping
WHERE player_id IN ('TW4352-TAP-MEMBER', 'TW4352-TAP-OFFICER');
GRANT SELECT ON tw4352_fixture_mappings TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT is(
  public.can_edit_playbooks(
    '43520000-0000-0000-0000-000000000001'
  ),
  true,
  'an active alpha tester retains playbook edit eligibility'
);

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_self_roster_v1(ARRAY[repeat('é', 65)]) $$,
  '22023',
  NULL,
  'self roster rejects a unit ID above the 128-byte UTF-8 bound'
);

SELECT ok(
  (
    SELECT
      jsonb_typeof(forecast -> 'season') = 'object'
      AND jsonb_typeof(forecast -> 'tokens') = 'object'
      AND jsonb_typeof(forecast -> 'bombs') = 'object'
      AND jsonb_array_length(forecast -> 'per_player') = 1
      AND NOT ((forecast -> 'per_player' -> 0) ? 'display_name')
    FROM (
      SELECT public.get_command_center_member_season_forecast_v1(
        'TW4352-TAP-A',
        100
      ) AS forecast
    ) AS observed
  ),
  'member forecast has the contracted envelope and only the caller row'
);

SELECT is(
  (
    SELECT team.meta_team
    FROM public.get_command_center_self_team_usage_v1(
      '100',
      'Boss A',
      'L1'
    ) AS team
    LIMIT 1
  ),
  'Test Meta Pair',
  'self team usage resolves mapped display names and ordered meta matching'
);

SELECT ok(
  (
    SELECT
      usage.tokens_available BETWEEN 0 AND 3
      AND usage.max_possible BETWEEN 0 AND 28
    FROM public.get_command_center_self_token_usage_v1('100') AS usage
  ),
  'self token usage enforces the live three-token cap and bounded season max'
);

SELECT ok(
  (
    SELECT
      state.tokens_available BETWEEN 0 AND 3
      AND state.player_mapping_id IS NOT NULL
      AND state.data_source IN ('live', 'calculated')
    FROM public.get_command_center_member_token_state_v1('100') AS state
  ),
  'member token state returns the stable mapping projection without PII'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.get_command_center_self_boss_performance_v1(
      '100',
      'Boss A',
      'Legendary',
      ARRAY[0]
    ) AS performance
    WHERE abs(performance.player_vs_guild_avg) > 0
  ),
  'self boss performance computes a non-placeholder guild comparison'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_officer_roster_v1('TW4352-TAP-A', ARRAY[repeat('é', 65)]) $$,
  '22023',
  NULL,
  'officer roster rejects a unit ID above the 128-byte UTF-8 bound'
);

SELECT ok(
  (
    SELECT
      jsonb_typeof(forecast -> 'season') = 'object'
      AND jsonb_array_length(forecast -> 'per_player') = 2
      AND (forecast -> 'per_player' -> 0) ? 'display_name'
    FROM (
      SELECT public.get_command_center_officer_season_forecast_v1(
        'TW4352-TAP-A',
        100
      ) AS forecast
    ) AS observed
  ),
  'officer forecast returns the full bounded guild envelope'
);

SELECT is(
  (
    SELECT count(DISTINCT team.player_mapping_id)::integer
    FROM public.get_command_center_officer_team_usage_v1(
      'TW4352-TAP-A',
      '100',
      ARRAY[
        (
          SELECT id
          FROM tw4352_fixture_mappings
          WHERE player_id = 'TW4352-TAP-MEMBER'
        ),
        (
          SELECT id
          FROM tw4352_fixture_mappings
          WHERE player_id = 'TW4352-TAP-OFFICER'
        )
      ],
      'Boss A',
      'L1'
    ) AS team
  ),
  2,
  'officer team usage returns only the two explicitly requested mappings'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.get_command_center_officer_boss_performance_v1(
      'TW4352-TAP-A',
      '100',
      ARRAY[
        (
          SELECT id
          FROM tw4352_fixture_mappings
          WHERE player_id = 'TW4352-TAP-MEMBER'
        ),
        (
          SELECT id
          FROM tw4352_fixture_mappings
          WHERE player_id = 'TW4352-TAP-OFFICER'
        )
      ],
      'Boss A',
      'Legendary',
      ARRAY[0]
    ) AS performance
    WHERE performance.vs_guild_pct <> 100
  ),
  'officer boss performance is calculated rather than hard-coded to 100'
);

SELECT is(
  (
    SELECT status.lifecycle_state || ':' || status.alive_primes::text
    FROM public.get_command_center_current_boss_status_v1(
      'TW4352-TAP-A',
      '100'
    ) AS status
    WHERE status.encounter_id = 0
  ),
  'warded:2',
  'current boss status derives warded lifecycle state from two live primes'
);

SELECT is(
  (
    SELECT summary.total_battles
    FROM public.get_command_center_guild_season_summary_v1(
      'TW4352-TAP-A',
      '100'
    ) AS summary
  ),
  7,
  'guild season summary counts Battle rows by damage type'
);

SELECT is(
  (
    SELECT
      summary.bosses_assigned::text
      || ':'
      || summary.max_tokens_allowed::text
    FROM public.get_command_center_officer_token_summary_v1(
      'TW4352-TAP-A',
      '100'
    ) AS summary
  ),
  '1:3',
  'officer token summary counts positive flexible allocations with the configured maximum'
);

RESET ROLE;
SET ROLE service_role;

SELECT is(
  (
    SELECT bombs_available::text || ':' || roster_size::text
    FROM public.get_guild_bombs_available('TW4352-TAP-A')
  ),
  '1:2',
  'guild bomb availability honors the authoritative recent Bomb cooldown'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT ok(
  (
    SELECT usage.tokens_available = 3
    FROM public.get_command_center_self_token_usage_v1('100') AS usage
  )
  AND
  (
    SELECT state.tokens_available = 3
    FROM public.get_command_center_member_token_state_v1('100') AS state
  ),
  'token projections replay post-snapshot spends chronologically through cap pauses'
);

RESET ROLE;
UPDATE public.player_mapping
SET display_name = repeat('x', 263000)
WHERE player_id = 'TW4352-TAP-MEMBER';

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '43520000-0000-0000-0000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_guild_members_v1() $$,
  '54000',
  NULL,
  'guild members fails before returning an over-budget UTF-8 response'
);

RESET ROLE;
UPDATE public.player_mapping
SET display_name = 'Test Member'
WHERE player_id = 'TW4352-TAP-MEMBER';

INSERT INTO public.guild_config (
  guild_code,
  display_name,
  enabled,
  cluster_code
)
SELECT
  'TW4352-TAP-A-' || lpad(series::text, 2, '0'),
  'Test Overflow Guild ' || series,
  true,
  'TW4352-TAP-A'
FROM generate_series(1, 50) AS series;

SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_cluster_guild_metadata_v1() $$,
  '54000',
  NULL,
  'cluster metadata fails before returning more than 50 guilds'
);

RESET ROLE;
INSERT INTO public.player_mapping (
  player_id,
  display_name,
  guild_code,
  cluster_code,
  role,
  is_current,
  is_active
)
SELECT
  'TW4352-TAP-EXTRA-' || lpad(series::text, 3, '0'),
  'Test Extra Member ' || series,
  'TW4352-TAP-A',
  'TW4352-TAP-A',
  'member',
  true,
  true
FROM generate_series(1, 254) AS series;

SET ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.get_command_center_guild_members_v1() $$,
  '54000',
  NULL,
  'guild members fails before returning more than 255 rows'
);

RESET ROLE;
SELECT finish();
ROLLBACK;

-- Fixtures are written as the suite role; behavioral calls run as authenticated with JWT claims.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT plan(27);

SELECT is(
  (
    SELECT count(*)::integer
      FROM supabase_migrations.schema_migrations
     WHERE version = '20260925070000'
       AND name = 'port_war_room_readiness'
  ),
  1,
  'the War Room readiness migration is recorded exactly once'
);

SELECT has_function(
  'public',
  'get_guild_war_hero_usage',
  ARRAY['text']::text[],
  'the hero-usage RPC exists with the guild-code signature'
);

SELECT has_function(
  'public',
  'get_war_room_team_readiness',
  ARRAY['text', 'integer']::text[],
  'the team-readiness RPC exists with the documented signature'
);

SELECT ok(
  (
    SELECT bool_and(
      p.prosecdef
        AND p.provolatile = 's'
        AND p.proconfig IS NOT NULL
    )
    FROM pg_proc AS p
    WHERE p.oid IN (
      'public.get_guild_war_hero_usage(text)'::regprocedure,
      'public.get_war_room_team_readiness(text,integer)'::regprocedure
    )
  ),
  'both readiness RPCs are STABLE SECURITY DEFINER with pinned settings'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.get_guild_war_hero_usage(text)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.get_war_room_team_readiness(text,integer)', 'EXECUTE'
  ),
  'anon cannot execute either War Room RPC'
);

SELECT ok(
  has_function_privilege(
    'authenticated', 'public.get_guild_war_hero_usage(text)', 'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.get_war_room_team_readiness(text,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'public.get_guild_war_hero_usage(text)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.get_war_room_team_readiness(text,integer)',
    'EXECUTE'
  ),
  'the TA authenticated and service roles can execute both RPCs'
);

-- Identity triggers are off only for synthetic auth fixtures.
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email, aud, role)
VALUES
  (
    '00000000-0000-4000-8000-000000009101',
    'wready-member@example.invalid',
    'authenticated',
    'authenticated'
  ),
  (
    '00000000-0000-4000-8000-000000009102',
    'wready-other@example.invalid',
    'authenticated',
    'authenticated'
  ),
  (
    '00000000-0000-4000-8000-000000009103',
    'wready-none@example.invalid',
    'authenticated',
    'authenticated'
  );
ALTER TABLE auth.users ENABLE TRIGGER USER;

INSERT INTO public.guild_config (id, guild_code, display_name)
VALUES
  (910001, 'WREADY-A', 'War Room Readiness A'),
  (910002, 'WREADY-B', 'War Room Readiness B');

ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
INSERT INTO public.player_mapping (
  id, player_id, display_name, user_id, guild_code, role, is_current, is_active
)
VALUES
  (
    910101,
    'WREADY-MEMBER',
    'War Room Member',
    '00000000-0000-4000-8000-000000009101',
    'WREADY-A',
    'member'::public.app_role,
    true,
    true
  ),
  (
    910102,
    'WREADY-OTHER',
    'War Room Other Guild',
    '00000000-0000-4000-8000-000000009102',
    'WREADY-B',
    'leader'::public.app_role,
    true,
    true
  ),
  (
    910103,
    'WREADY-NONE',
    'War Room No Membership',
    '00000000-0000-4000-8000-000000009103',
    NULL,
    'member'::public.app_role,
    true,
    true
  );
ALTER TABLE public.player_mapping ENABLE TRIGGER USER;

INSERT INTO public.hero_mappings (id, unit_id, display_name, category)
VALUES
  (910001, 'wready-alpha', 'Alpha', 'Hero'),
  (910002, 'wready-beta', 'Beta', 'Hero'),
  (910003, 'wready-gamma', 'Gamma', 'Hero'),
  (910004, 'wready-delta', 'Delta', 'Hero'),
  (910005, 'wready-omega', 'Omega', 'MOW');

INSERT INTO public.player_roster (
  id, user_id, hero_mapping_id, rank_name, stars, xp_level,
  active_ability_level, passive_ability_level
)
VALUES
  (
    910201,
    '00000000-0000-4000-8000-000000009101',
    910001,
    'Gold I',
    6,
    80,
    10,
    8
  ),
  (
    910202,
    '00000000-0000-4000-8000-000000009101',
    910002,
    'Silver I',
    5,
    60,
    9,
    7
  ),
  (
    910203,
    '00000000-0000-4000-8000-000000009101',
    910003,
    'Gold II',
    7,
    90,
    10,
    9
  ),
  (
    910204,
    '00000000-0000-4000-8000-000000009101',
    910004,
    'Gold III',
    3,
    40,
    6,
    5
  );

INSERT INTO public.guild_war_meta_teams (
  id, guild_code, name, side, priority, notes, heroes
)
VALUES
  (
    '00000000-0000-4000-8000-000000009201',
    'WREADY-A',
    'Ready line',
    'offense',
    1,
    'All required fielded units are at the floor',
    '[
      {"unitId":"wready-alpha","role":"core"},
      {"unitId":"wready-beta","role":"core"},
      {"unitId":"wready-gamma","role":"flex"},
      {"unitId":"wready-delta","role":"flex"},
      {"unitId":"wready-omega","role":"mow"}
    ]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000009202',
    'WREADY-A',
    'Missing unit line',
    'defense',
    2,
    'The caller does not own the second core',
    '[
      {"unitId":"wready-alpha","role":"core"},
      {"unitId":"wready-missing","role":"core"}
    ]'::jsonb
  );

GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_war_room_team_readiness('WREADY-A', 9)),
  2::bigint,
  'a current guild member receives readiness for both shared teams'
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_war_room_team_readiness('WREADY-B', 9)),
  0::bigint,
  'a current member cannot read another guild readiness'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009103',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009103","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_war_room_team_readiness('WREADY-A', 9)),
  0::bigint,
  'an unmapped caller receives no readiness rows'
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_guild_war_hero_usage('WREADY-A')),
  0::bigint,
  'an unmapped caller receives no usage rows'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',
  true
);

-- Silver I (index 9) is the gear floor; the MoW never lowers it.
SELECT is(
  (SELECT floor_rank_index
     FROM public.get_war_room_team_readiness('WREADY-A', 9)
    WHERE team_id = '00000000-0000-4000-8000-000000009201'),
  9,
  'readiness uses the lowest rank among the caller fielded five'
);

SELECT is(
  (SELECT floor_rank_name
     FROM public.get_war_room_team_readiness('WREADY-A', 9)
    WHERE team_id = '00000000-0000-4000-8000-000000009201'),
  'Silver I'::text,
  'readiness maps the floor index back to the rank name'
);

SELECT ok(
  (
    SELECT ready
      FROM public.get_war_room_team_readiness('WREADY-A', 9)
     WHERE team_id = '00000000-0000-4000-8000-000000009201'
  ),
  'a team with every fielded unit at or above the floor is ready'
);

SELECT is(
  (SELECT weakest_unit_id
     FROM public.get_war_room_team_readiness('WREADY-A', 9)
    WHERE team_id = '00000000-0000-4000-8000-000000009201'),
  'wready-beta'::text,
  'the weakest fielded unit is the lowest-ranked owned hero'
);

SELECT is(
  (SELECT count(*)
     FROM public.get_war_room_team_readiness('WREADY-A', 9) AS readiness
     CROSS JOIN LATERAL jsonb_array_elements(readiness.missing_units) AS missing
    WHERE readiness.team_id = '00000000-0000-4000-8000-000000009201'),
  0::bigint,
  'a ready team has no missing or below-floor fielded units'
);

SELECT is(
  (SELECT count(*)
     FROM public.get_war_room_team_readiness('WREADY-A', 9) AS readiness
     CROSS JOIN LATERAL jsonb_array_elements(readiness.missing_units) AS missing
    WHERE readiness.team_id = '00000000-0000-4000-8000-000000009202'
      AND missing ->> 'unitId' = 'wready-missing'
      AND (missing ->> 'owned')::boolean = false),
  1::bigint,
  'an unowned fielded core is reported as missing'
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_guild_war_hero_usage('WREADY-A')),
  0::bigint,
  'usage is empty before the guild has an active war'
);

-- Attempts use units_used, battles attacker_units_json; an event in both counts once.
RESET ROLE;

INSERT INTO public.guild_war_matches (
  id, war_id, guild_code, opponent_guild_name, war_status, war_start_date
)
VALUES (
  '00000000-0000-4000-8000-000000009301',
  'WREADY-WAR-1',
  'WREADY-A',
  'Readiness Opponent',
  'active',
  now() - interval '1 hour'
);

INSERT INTO public.guild_war_zones (
  id, war_id, guild_code, zone_number, zone_type, zone_status
)
VALUES (
  '00000000-0000-4000-8000-000000009302',
  'WREADY-WAR-1',
  'WREADY-A',
  1,
  'offense',
  'in_progress'
);

INSERT INTO public.guild_war_player_attempts (
  id, war_id, zone_id, guild_code, player_id, player_name, attempt_number,
  attempt_status, event_id, units_used, is_guild_member
)
VALUES
  (
    '00000000-0000-4000-8000-000000009303',
    'WREADY-WAR-1',
    '00000000-0000-4000-8000-000000009302',
    'WREADY-A',
    'WREADY-P1',
    'Attempt Player',
    1,
    'completed',
    '00000000-0000-4000-8000-000000009311',
    '[
      {"unitId":"wready-alpha","remainingHPAfter":100},
      {"unitId":"wready-beta"}
    ]'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000009304',
    'WREADY-WAR-1',
    '00000000-0000-4000-8000-000000009302',
    'WREADY-A',
    'WREADY-P3',
    'Duplicate Player',
    3,
    'completed',
    NULL,
    '[{"unitId":"wready-alpha","remainingHPAfter":100}]'::jsonb,
    true
  );

INSERT INTO public.guild_war_battles (
  id, war_id, zone_id, guild_code, event_id, attacker_player_id,
  attacker_player_name, attempt_number, attempt_status, attacker_units_json,
  is_guild_member
)
VALUES
  (
    '00000000-0000-4000-8000-000000009305',
    'WREADY-WAR-1',
    '00000000-0000-4000-8000-000000009302',
    'WREADY-A',
    '00000000-0000-4000-8000-000000009312',
    'WREADY-P2',
    'Battle Player',
    2,
    'completed',
    '[{"unitId":"wready-gamma","remainingHPAfter":100}]'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000009306',
    'WREADY-WAR-1',
    '00000000-0000-4000-8000-000000009302',
    'WREADY-A',
    NULL,
    'WREADY-P3',
    'Duplicate Player',
    3,
    'completed',
    '[{"unitId":"wready-alpha","remainingHPAfter":100}]'::jsonb,
    true
  );

-- The writers use different UUIDs for one Loki source id; the natural key dedupes.
INSERT INTO public.guild_war_player_attempts (
  id, war_id, zone_id, guild_code, player_id, player_name, attempt_number,
  attempt_status, event_id, units_used, is_guild_member, attacker_team_index
)
VALUES (
  '00000000-0000-4000-8000-000000009307',
  'WREADY-WAR-1',
  '00000000-0000-4000-8000-000000009302',
  'WREADY-A',
  'WREADY-P5',
  'Generated Id Player',
  5,
  'completed',
  '00000000-0000-4000-8000-000000009314',
  '[{"unitId":"wready-delta","remainingHPAfter":100}]'::jsonb,
  true,
  1
);

INSERT INTO public.guild_war_battles (
  id, war_id, zone_id, guild_code, event_id, attacker_player_id,
  attacker_player_name, attempt_number, attempt_status, attacker_units_json,
  is_guild_member, attacker_team_index
)
VALUES (
  '00000000-0000-4000-8000-000000009308',
  'WREADY-WAR-1',
  '00000000-0000-4000-8000-000000009302',
  'WREADY-A',
  '00000000-0000-4000-8000-000000009315',
  'WREADY-P5',
  'Generated Id Player',
  5,
  'completed',
  '[{"unitId":"wready-delta","remainingHPAfter":100}]'::jsonb,
  true,
  1
);

-- A null membership value is not evidence of a guild attack.
INSERT INTO public.guild_war_battles (
  id, war_id, zone_id, guild_code, event_id, attacker_player_id,
  attacker_player_name, attempt_number, attempt_status, attacker_units_json,
  is_guild_member, attacker_team_index
)
VALUES (
  '00000000-0000-4000-8000-000000009309',
  'WREADY-WAR-1',
  '00000000-0000-4000-8000-000000009302',
  'WREADY-A',
  '00000000-0000-4000-8000-000000009316',
  'WREADY-P6',
  'Unknown Membership',
  1,
  'completed',
  '[{"unitId":"wready-null-member"}]'::jsonb,
  NULL,
  1
);

-- Loki stores the MoW beside the attacker units, not inside that array.
UPDATE public.guild_war_battles
   SET battle_summary = '{"attacker":{"machineOfWar":{"unitId":"wready-omega"}}}'::jsonb
 WHERE id = '00000000-0000-4000-8000-000000009305';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_guild_war_hero_usage('WREADY-A')),
  6::bigint,
  'usage returns one row per active-war hero and player'
);

SELECT is(
  (SELECT COALESCE(sum(times_fielded), 0)::integer
     FROM public.get_guild_war_hero_usage('WREADY-A')
    WHERE unit_id = 'wready-alpha'),
  2,
  'attempts-only data counts once and the shared battle is not double-counted'
);

SELECT is(
  (SELECT COALESCE(sum(times_fielded), 0)::integer
     FROM public.get_guild_war_hero_usage('WREADY-A')
    WHERE unit_id = 'wready-gamma'),
  1,
  'battles-only attacker_units_json contributes hero usage'
);

SELECT is(
  (SELECT COALESCE(sum(times_died), 0)::integer
     FROM public.get_guild_war_hero_usage('WREADY-A')
    WHERE unit_id = 'wready-beta'),
  1,
  'an omitted after-HP value is a death when a teammate supplies after-HP evidence'
);

SELECT is(
  (SELECT COALESCE(sum(times_fielded), 0)::integer
     FROM public.get_guild_war_hero_usage('WREADY-A')
    WHERE unit_id = 'wready-delta'),
  1,
  'mismatched generated event ids use the fallback identity and count once'
);

SELECT is(
  (SELECT COALESCE(sum(times_fielded), 0)::integer
     FROM public.get_guild_war_hero_usage('WREADY-A')
    WHERE unit_id = 'wready-omega'),
  1,
  'the separately stored attacker MoW is included in usage rows'
);

SELECT ok(
  (
    SELECT bool_and(is_mow)
      FROM public.get_guild_war_hero_usage('WREADY-A')
     WHERE unit_id = 'wready-omega'
  ),
  'hero_mappings category MOW is surfaced in usage rows'
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_guild_war_hero_usage('WREADY-A')
    WHERE unit_id = 'wready-null-member'),
  0::bigint,
  'null guild membership is excluded from usage'
);

RESET ROLE;
UPDATE public.guild_war_matches
   SET war_status = 'completed'
 WHERE war_id = 'WREADY-WAR-1'
   AND guild_code = 'WREADY-A';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_guild_war_hero_usage('WREADY-A')),
  0::bigint,
  'usage returns empty after the active war ends'
);

RESET ROLE;
-- Both stale forms must be ignored: an ended row outside the 12-hour grace,
-- and a null-ended row whose start is outside the 60-hour duration + grace.
INSERT INTO public.guild_war_matches (
  id, war_id, guild_code, opponent_guild_name, war_status, war_start_date,
  war_end_date
)
VALUES
  (
    '00000000-0000-4000-8000-000000009317',
    'WREADY-STALE-END',
    'WREADY-A',
    'Stale Ended',
    'active',
    now() - interval '100 hours',
    now() - interval '13 hours'
  ),
  (
    '00000000-0000-4000-8000-000000009318',
    'WREADY-STALE-NULL',
    'WREADY-A',
    'Stale Null End',
    'active',
    now() - interval '100 hours',
    NULL
  );

INSERT INTO public.guild_war_zones (
  id, war_id, guild_code, zone_number, zone_type, zone_status
)
VALUES
  (
    '00000000-0000-4000-8000-000000009319',
    'WREADY-STALE-END',
    'WREADY-A',
    1,
    'offense',
    'in_progress'
  ),
  (
    '00000000-0000-4000-8000-000000009320',
    'WREADY-STALE-NULL',
    'WREADY-A',
    1,
    'offense',
    'in_progress'
  );

INSERT INTO public.guild_war_battles (
  id, war_id, zone_id, guild_code, event_id, attacker_player_id,
  attacker_player_name, attempt_number, attempt_status, attacker_units_json,
  is_guild_member
)
VALUES
  (
    '00000000-0000-4000-8000-000000009321',
    'WREADY-STALE-END',
    '00000000-0000-4000-8000-000000009319',
    'WREADY-A',
    '00000000-0000-4000-8000-000000009323',
    'WREADY-STALE-END',
    'Stale Ended',
    1,
    'completed',
    '[{"unitId":"wready-stale-end"}]'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000009322',
    'WREADY-STALE-NULL',
    '00000000-0000-4000-8000-000000009320',
    'WREADY-A',
    '00000000-0000-4000-8000-000000009324',
    'WREADY-STALE-NULL',
    'Stale Null End',
    1,
    'completed',
    '[{"unitId":"wready-stale-null"}]'::jsonb,
    true
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint
     FROM public.get_guild_war_hero_usage('WREADY-A')),
  0::bigint,
  'stale active wars with old ends or old null-ended starts are ignored'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

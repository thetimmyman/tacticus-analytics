BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- A database without the migration emits explicit SKIPs so "did not run" is not read as "passed".

SELECT (
  to_regprocedure('public.get_war_player_stats(text,text)') IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = to_regprocedure('public.get_war_player_stats(text,text)')
      AND 'hold_rate' = ANY (function.proargnames)
  )
) AS wi6270_not_applied \gset
\if :wi6270_not_applied
SELECT plan(35);
SELECT * FROM skip(
  35,
  'this database predates WI-6270 (get_war_player_stats has no hold_rate output); the replay lane applies the migration and executes this suite fully, and the baseline lane joins it once extract-prod-baseline.sh is re-run after the production apply'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(35);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260811010000'
      AND name = 'wi6270_war_defense_stats_and_board_id'
  ),
  1,
  'A1: the WI-6270 migration is recorded exactly once'
);

SELECT is(
  (
    SELECT format_type(attribute.atttypid, attribute.atttypmod) || '/' ||
           (NOT attribute.attnotnull)::text
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.guild_war_zones'::regclass
      AND attribute.attname = 'board_id'
      AND NOT attribute.attisdropped
  ),
  'text/true',
  'A2: guild_war_zones.board_id is text and NULLable'
);

SELECT ok(
  (
    SELECT coalesce(length(col_description(attribute.attrelid, attribute.attnum)), 0) > 0
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.guild_war_zones'::regclass
      AND attribute.attname = 'board_id'
  ),
  'A3: board_id carries a provenance comment (source = Loki user_progression)'
);

SELECT is(
  (
    SELECT format_type(attribute.atttypid, attribute.atttypmod) || '/' ||
           attribute.attnotnull::text
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.guild_war_participation'::regclass
      AND attribute.attname = 'opted_in_observed'
      AND NOT attribute.attisdropped
  ),
  'boolean/true',
  'A4: guild_war_participation.opted_in_observed is boolean NOT NULL'
);

SELECT is(
  (
    SELECT pg_get_expr(default_expr.adbin, default_expr.adrelid)
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_attrdef AS default_expr
      ON default_expr.adrelid = attribute.attrelid
     AND default_expr.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.guild_war_participation'::regclass
      AND attribute.attname = 'opted_in_observed'
  ),
  'false',
  'A5: opted_in_observed defaults to false, so historical rows read "unknown"'
);

SELECT ok(
  (
    SELECT coalesce(length(col_description(attribute.attrelid, attribute.attnum)), 0) > 0
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.guild_war_participation'::regclass
      AND attribute.attname = 'opted_in_observed'
  ),
  'A6: opted_in_observed carries the "false means unknown, not declined" comment'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'get_war_player_stats'
  ),
  1,
  'A7: exactly one get_war_player_stats overload exists (no stale signature)'
);

SELECT is(
  pg_get_function_identity_arguments(
    to_regprocedure('public.get_war_player_stats(text,text)')
  ),
  'p_war_id text, p_guild_code text',
  'A8: the parameter list is UNCHANGED (no PostgREST alpha-order overload trap)'
);

SELECT is(
  pg_get_function_result(
    to_regprocedure('public.get_war_player_stats(text,text)')
  ),
  'TABLE(player_id character varying, player_name character varying, '
  || 'is_guild_member boolean, total_attacks bigint, wins bigint, '
  || 'losses bigint, points bigint, perfect_hits bigint, failed_hits bigint, '
  || 'win_rate numeric, avg_score numeric, defended integer, held integer, '
  || 'breached integer, conceded numeric, hold_rate numeric)',
  'A9: the return shape is the exact 16-column WI-6270 contract, in order'
);

SELECT ok(
  (
    SELECT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = to_regprocedure('public.get_war_player_stats(text,text)')
  ),
  'A10: get_war_player_stats is still SECURITY DEFINER'
);

SELECT is(
  (
    SELECT array_to_string(function.proconfig, ',')
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = to_regprocedure('public.get_war_player_stats(text,text)')
  ),
  'search_path=public',
  'A11: search_path is still pinned to public (a bare CREATE would drop it)'
);

-- The recreated function gets PUBLIC EXECUTE unless REVOKEd; B3 alone would be a false green.
SELECT is(
  pg_catalog.has_function_privilege(
    'anon', 'public.get_war_player_stats(text,text)', 'EXECUTE'
  ),
  false,
  'B1: anon CANNOT execute get_war_player_stats after the DROP+CREATE'
);

SELECT is(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.get_war_player_stats(text,text)', 'EXECUTE'
  ),
  false,
  'B2: authenticated CANNOT execute get_war_player_stats after the DROP+CREATE'
);

SELECT is(
  pg_catalog.pg_get_userbyid(function.proowner),
  'postgres',
  'B4: SECURITY DEFINER owner is postgres (DROP+CREATE resets it to the applying role)'
)
FROM pg_catalog.pg_proc AS function
WHERE function.oid = to_regprocedure('public.get_war_player_stats(text,text)');


SELECT is(
  pg_catalog.has_function_privilege(
    'service_role', 'public.get_war_player_stats(text,text)', 'EXECUTE'
  ),
  true,
  'B3: service_role retains EXECUTE (no lockout of the only real caller)'
);

-- b1 breached; b2 'win' with a survivor (held); b3 loss (held); b4 NPC (no defence row).
INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES ('00000000-0000-0000-0000-0000006270a0', 'ZW6', 'WI6270 Cluster', now());

INSERT INTO public.guild_config (
  id, guild_code, display_name, cluster_code, cluster_id, created_at, enabled
)
VALUES (
  627001, 'WI6270-G', 'WI6270 Guild', 'ZW6',
  '00000000-0000-0000-0000-0000006270a0', now(), true
);

INSERT INTO public.guild_war_matches (
  war_id, guild_code, opponent_guild_code, opponent_guild_name, war_status,
  war_result, guild_score, opponent_score, war_season, battlefield_level,
  war_end_date
)
VALUES (
  'wi6270-war-1', 'WI6270-G', NULL, 'WI6270 Opponent', 'completed',
  'win', 1300, 700, 100, 5, now() - interval '1 day'
);

INSERT INTO public.guild_war_battles (
  war_id, guild_code, event_id, is_guild_member,
  attacker_player_id, attacker_player_name,
  defender_player_id, defender_player_name,
  attempt_result, defender_units_json, score_earned
)
VALUES
  ('wi6270-war-1', 'WI6270-G', gen_random_uuid(), true,
   'wi6270-att-1', 'Att One', 'wi6270-def-1', 'Def One',
   'win', '[{"remainingHPAfter": 0}]'::jsonb, 1000),
  ('wi6270-war-1', 'WI6270-G', gen_random_uuid(), true,
   'wi6270-att-1', 'Att One', 'wi6270-def-1', 'Def One',
   'win', '[{"remainingHPAfter": 250}]'::jsonb, 300),
  ('wi6270-war-1', 'WI6270-G', gen_random_uuid(), false,
   'wi6270-att-2', 'Att Two', 'wi6270-att-1', 'Att One',
   'loss', '[{"remainingHPAfter": 900}]'::jsonb, 200),
  ('wi6270-war-1', 'WI6270-G', gen_random_uuid(), false,
   'wi6270-att-2', 'Att Two', NULL, NULL,
   'win', '[{"remainingHPAfter": 0}]'::jsonb, 500);

CREATE TEMP TABLE wi6270_stats AS
SELECT * FROM public.get_war_player_stats('wi6270-war-1', 'WI6270-G');

SELECT is(
  (SELECT count(*)::integer FROM wi6270_stats),
  3,
  'C1: three player rows -- two attackers plus the defence-only player'
);

SELECT is(
  (SELECT count(*)::integer FROM wi6270_stats WHERE player_id IS NULL),
  0,
  'C2: the NPC defence (NULL defender_player_id) produces NO player row'
);

SELECT is(
  (SELECT total_attacks::integer FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  2,
  'C3: att-1 keeps its two attacks (offence aggregates are unchanged)'
);

SELECT is(
  (SELECT points::integer FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  1300,
  'C4: att-1 keeps its raw attack points'
);

SELECT is(
  (SELECT defended FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  1,
  'C5: att-1 was attacked once, so defended = 1'
);

SELECT is(
  (SELECT held FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  1,
  'C6: att-1 repelled that attack, so held = 1'
);

SELECT is(
  (SELECT breached FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  0,
  'C7: att-1 was never breached'
);

SELECT is(
  (SELECT conceded FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  200::numeric,
  'C8: conceded is the RAW score_earned of the attacks against att-1'
);

SELECT is(
  (SELECT hold_rate FROM wi6270_stats WHERE player_id = 'wi6270-att-1'),
  100.0::numeric,
  'C9: att-1 hold_rate = 1/1 * 100'
);

SELECT is(
  (SELECT count(*)::integer FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  1,
  'C10: the defence-only player appears at all (it never attacked)'
);

SELECT is(
  (SELECT total_attacks::integer FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  0,
  'C11: the defence-only player has zero attack aggregates'
);

SELECT is(
  (SELECT is_guild_member FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  false,
  'C12: the defence-only player takes the INVERSE side of its attacker'
);

SELECT is(
  (SELECT defended FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  2,
  'C13: def-1 defended both attacks against it'
);

SELECT is(
  (SELECT breached FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  1,
  'C14: the FULL CLEAR counts as breached (HP-truth, not attempt_result)'
);

SELECT is(
  (SELECT held FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  1,
  'C15: the PARTIAL clear (surviving defender) counts as held, despite "win"'
);

SELECT is(
  (SELECT conceded FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  1300::numeric,
  'C16: conceded sums score_earned across both attacks (1000 + 300)'
);

SELECT is(
  (SELECT hold_rate FROM wi6270_stats WHERE player_id = 'wi6270-def-1'),
  50.0::numeric,
  'C17: def-1 hold_rate = 1/2 * 100'
);

SELECT is(
  (SELECT defended FROM wi6270_stats WHERE player_id = 'wi6270-att-2'),
  0,
  'C18: att-2 was never defended against, so defended = 0'
);

SELECT ok(
  (SELECT hold_rate IS NULL FROM wi6270_stats WHERE player_id = 'wi6270-att-2'),
  'C19: hold_rate is NULL (no defensive sample), never a misleading 0'
);

-- C2 alone would pass if the NPC battle were dropped from the scan.
SELECT is(
  (SELECT total_attacks::integer FROM wi6270_stats WHERE player_id = 'wi6270-att-2'),
  2,
  'C20: the NPC battle still counts as an ATTACK for att-2 (exclusion is defence-side)'
);

SELECT * FROM finish();
ROLLBACK;
\endif

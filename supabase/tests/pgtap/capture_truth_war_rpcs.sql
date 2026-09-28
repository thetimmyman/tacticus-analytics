BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Every B/C/D value differs from raw attempt_result logic, so a revert turns it red.
-- A database without the migration emits TAP SKIPs, keeping the plan count identical.

SELECT (
  to_regprocedure('public.get_zone_stats(text,integer,integer)') IS NULL
  OR pg_get_functiondef(
       to_regprocedure('public.get_zone_stats(text,integer,integer)')::oid
     ) !~ 'war_zone_captured'
) AS tw6470_not_applied \gset
\if :tw6470_not_applied
SELECT plan(22);
SELECT * FROM skip(
  22,
  'this database predates the capture-truth zone hero core output (get_zone_stats does not call war_zone_captured); the replay lane applies the migration and executes this suite fully, and the baseline lane joins it once extract-prod-baseline.sh is re-run after the production apply'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(22);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260812170000'
      AND name = 'wi6470_capture_truth_zone_hero_core'
  ),
  1,
  'A1: the wi6470_capture_truth_zone_hero_core migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_zone_stats(text,integer,integer)'),
      to_regprocedure('public.get_hero_performance(text,text,integer,integer)'),
      to_regprocedure('public.get_core_compositions(text,text,integer,integer,integer,integer,integer)')
    )
  ),
  3,
  'A2: all three RPCs still resolve at their original, unchanged signatures'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_zone_stats(text,integer,integer)'),
      to_regprocedure('public.get_hero_performance(text,text,integer,integer)'),
      to_regprocedure('public.get_core_compositions(text,text,integer,integer,integer,integer,integer)')
    )
      AND function.prosecdef
  ),
  3,
  'A3: all three remain SECURITY DEFINER'
);

-- CREATE OR REPLACE without SET search_path resets proconfig, undoing the hardening.
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_zone_stats(text,integer,integer)'),
      to_regprocedure('public.get_hero_performance(text,text,integer,integer)'),
      to_regprocedure('public.get_core_compositions(text,text,integer,integer,integer,integer,integer)')
    )
      AND 'search_path=public' = ANY (function.proconfig)
  ),
  3,
  'A4: all three keep search_path pinned to public (20260415000002 hardening survived the replace)'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = to_regprocedure('public.get_zone_stats(text,integer,integer)')
      AND array_length(function.proargnames, 1) = 14
  ),
  1,
  'A5: get_zone_stats keeps its 3-in / 11-out column shape (typed wrappers unaffected)'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_zone_stats(text,integer,integer)'),
      to_regprocedure('public.get_hero_performance(text,text,integer,integer)'),
      to_regprocedure('public.get_core_compositions(text,text,integer,integer,integer,integer,integer)')
    )
      AND pg_get_functiondef(function.oid) ~ 'attempt_result[[:space:]]*=[[:space:]]*''win'''
  ),
  0,
  'A6: none of the three still tests attempt_result = ''win'''
);

-- A 'win' that leaves a defender above 0 HP is a phantom win, not a capture.
INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES ('00000000-0000-0000-0000-0000006470a0', 'ZW7', 'TW6470 Cluster', now());

INSERT INTO public.guild_config (
  id, guild_code, display_name, cluster_code, cluster_id, created_at, enabled
)
VALUES (
  647001, 'TW6470-G', 'TW6470 Guild', 'ZW7',
  '00000000-0000-0000-0000-0000006470a0', now(), true
);

INSERT INTO public.guild_war_matches (
  war_id, guild_code, opponent_guild_code, opponent_guild_name, war_status,
  war_result, guild_score, opponent_score, war_season, battlefield_level,
  war_end_date
)
VALUES (
  'tw6470-war-1', 'TW6470-G', NULL, 'TW6470 Opponent', 'completed',
  'win', 1500, 900, 100, 5, now() - interval '1 day'
);

INSERT INTO public.guild_war_battles (
  war_id, guild_code, event_id, is_guild_member, zone_type, attempt_start_time,
  attempt_result, attacker_units_json, defender_units_json,
  score_earned, kill_count, defender_units_lost
)
VALUES
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win',
   '[{"heroKey": "TW6470_HERO_A"}, {"heroKey": "TW6470_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 0}, {"remainingHPAfter": 0}]'::jsonb, 1000, 2, 2),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win',
   '[{"heroKey": "TW6470_HERO_A"}, {"heroKey": "TW6470_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 250}]'::jsonb, 300, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win',
   '[{"heroKey": "TW6470_HERO_A"}, {"heroKey": "TW6470_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 10}]'::jsonb, 150, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'loss',
   '[{"heroKey": "TW6470_HERO_A"}, {"heroKey": "TW6470_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 900}]'::jsonb, 50, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), true, 'outpost', now() - interval '1 day',
   'win',
   '[{"heroKey": "TW6470_HERO_A"}, {"heroKey": "TW6470_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 0}]'::jsonb, 900, 1, 1),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), true, 'outpost', now() - interval '1 day',
   'win',
   '[{"heroKey": "TW6470_HERO_A"}, {"heroKey": "TW6470_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 75}]'::jsonb, 200, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', NULL,
   '[{"heroKey": "TW6470_DEF_A", "remainingHPAfter": 400}]'::jsonb, 300, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', NULL,
   '[{"heroKey": "TW6470_DEF_A", "remainingHPAfter": 0}]'::jsonb, 1000, 1, 1),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'loss', NULL,
   '[{"heroKey": "TW6470_DEF_A", "remainingHPAfter": 800}]'::jsonb, 100, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', NULL,
   '[{"heroKey": "TW6470_DEF_A", "remainingHPAfter": 5}]'::jsonb, 400, 0, 0),
  ('tw6470-war-1', 'TW6470-G', gen_random_uuid(), false, 'outpost', now() - interval '1 day',
   'win', NULL,
   '[{"heroKey": "TW6470_DEF_A", "remainingHPAfter": 0}]'::jsonb, 800, 1, 1);

CREATE TEMP TABLE tw6470_zones AS
SELECT * FROM public.get_zone_stats('TW6470-G', 30, NULL);

CREATE TEMP TABLE tw6470_heroes_off AS
SELECT * FROM public.get_hero_performance('TW6470-G', 'offense', 20, 4);

CREATE TEMP TABLE tw6470_heroes_def AS
SELECT * FROM public.get_hero_performance('TW6470-G', 'defense', 20, 4);

CREATE TEMP TABLE tw6470_cores AS
SELECT * FROM public.get_core_compositions('TW6470-G', 'offense', 3, 5, 2, 20, 4);

SELECT is(
  (SELECT offense_attacks::integer FROM tw6470_zones WHERE zone_type = 'mining_site'),
  4,
  'B1: mining_site counts all four offence attacks (denominator untouched by the fix)'
);

SELECT is(
  (SELECT offense_wins::integer FROM tw6470_zones WHERE zone_type = 'mining_site'),
  1,
  'B2: only the true capture counts as an offence win (old raw-attempt_result logic said 3)'
);

SELECT is(
  (SELECT offense_win_rate FROM tw6470_zones WHERE zone_type = 'mining_site'),
  25.0::numeric,
  'B3: offence win rate is 25.0, not the inflated 75.0 the raw win flag produced'
);

SELECT is(
  (SELECT defense_attacks::integer FROM tw6470_zones WHERE zone_type = 'mining_site'),
  4,
  'B4: mining_site counts all four incoming attacks'
);

SELECT is(
  (SELECT defense_holds::integer FROM tw6470_zones WHERE zone_type = 'mining_site'),
  3,
  'B5: every uncaptured incoming attack is a hold (old attempt_result = ''loss'' logic said 1)'
);

SELECT is(
  (SELECT defense_hold_rate FROM tw6470_zones WHERE zone_type = 'mining_site'),
  75.0::numeric,
  'B6: defence hold rate is 75.0, not the deflated 25.0 -- the mirror of the same defect'
);

SELECT is(
  (SELECT uses::integer FROM tw6470_heroes_off WHERE hero_key = 'TW6470_HERO_A'),
  6,
  'C1: HERO_A is credited with all six offence uses'
);

SELECT is(
  (SELECT wins::integer FROM tw6470_heroes_off WHERE hero_key = 'TW6470_HERO_A'),
  2,
  'C2: HERO_A has two true captures (old raw-attempt_result logic said 5)'
);

SELECT is(
  (SELECT losses::integer FROM tw6470_heroes_off WHERE hero_key = 'TW6470_HERO_A'),
  4,
  'C3: wins + losses now equal uses; the old logic said 1 loss and silently dropped the three phantom wins'
);

SELECT is(
  (SELECT win_rate FROM tw6470_heroes_off WHERE hero_key = 'TW6470_HERO_A'),
  33.3::numeric,
  'C4: HERO_A win rate is 33.3, not the inflated 83.3'
);

SELECT is(
  (SELECT wins::integer FROM tw6470_heroes_def WHERE hero_key = 'TW6470_DEF_A'),
  3,
  'C5: DEF_A held three of five defences (old attempt_result = ''loss'' logic said 1)'
);

SELECT is(
  (SELECT win_rate FROM tw6470_heroes_def WHERE hero_key = 'TW6470_DEF_A'),
  60.0::numeric,
  'C6: DEF_A defensive rate is 60.0, not the deflated 20.0'
);

SELECT is(
  (SELECT total_uses::integer FROM tw6470_cores
   WHERE core_heroes = '["TW6470_HERO_A", "TW6470_HERO_B"]'::jsonb),
  6,
  'D1: the HERO_A/HERO_B pair is credited with all six uses'
);

SELECT is(
  (SELECT wins::integer FROM tw6470_cores
   WHERE core_heroes = '["TW6470_HERO_A", "TW6470_HERO_B"]'::jsonb),
  2,
  'D2: the pair has two true captures (old raw-attempt_result logic said 5)'
);

SELECT is(
  (SELECT win_rate FROM tw6470_cores
   WHERE core_heroes = '["TW6470_HERO_A", "TW6470_HERO_B"]'::jsonb),
  33.3::numeric,
  'D3: pair win rate is 33.3, not the inflated 83.3'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.guild_war_battles
    WHERE guild_code = 'TW6470-G'
      AND attempt_result = 'win'
      AND NOT war_zone_captured(attempt_result, defender_units_json)
  ),
  5,
  'E1: the seed really does contain five phantom wins (raw ''win'' that left a defender alive) -- without them B/C/D would be vacuous'
);

SELECT * FROM finish();
ROLLBACK;
\endif

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Old values are named in descriptions; a lane without the migration emits the same count as SKIPs.

SELECT (
  to_regprocedure('public.get_zone_performance(text,integer)') IS NULL
  OR pg_get_functiondef(
       to_regprocedure('public.get_zone_performance(text,integer)')::oid
     ) !~ 'war_zone_captured'
) AS tw6530_not_applied \gset
\if :tw6530_not_applied
SELECT plan(26);
SELECT * FROM skip(
  26,
  'this database predates the capture-truth tail migration (get_zone_performance does not call war_zone_captured); the replay lane applies the migration and executes this suite fully, and the baseline lane joins it once extract-prod-baseline.sh is re-run after the production apply'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(26);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260812200000'
      AND name = 'wi6530_capture_truth_tail_and_hero_kills'
  ),
  1,
  'A1: the capture-truth tail migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_hero_performance(text,text,integer,integer)'),
      to_regprocedure('public.get_zone_performance(text,integer)'),
      to_regprocedure('public.get_player_rankings(text,integer,text,integer)'),
      to_regprocedure('public.get_war_participation_summary(text,text)'),
      to_regprocedure('public.get_war_participation_summary(text,integer,text)')
    )
  ),
  5,
  'A2: all five RPCs still resolve at their original, unchanged signatures'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE (function.oid = to_regprocedure('public.get_hero_performance(text,text,integer,integer)')
             AND function.prosecdef
             AND 'search_path=public' = ANY (function.proconfig))
       OR (function.oid = to_regprocedure('public.get_war_participation_summary(text,text)')
             AND function.prosecdef
             AND 'search_path=public, auth' = ANY (function.proconfig))
  ),
  2,
  'A3: the two SECURITY DEFINER functions keep DEFINER and their exact search_path pins'
);

-- Catches privilege escalation: these three stay plain, unpinned, caller-rights functions.
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_zone_performance(text,integer)'),
      to_regprocedure('public.get_player_rankings(text,integer,text,integer)'),
      to_regprocedure('public.get_war_participation_summary(text,integer,text)')
    )
      AND NOT function.prosecdef
      AND function.proconfig IS NULL
  ),
  3,
  'A4: the three caller-rights functions were NOT promoted to SECURITY DEFINER'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      to_regprocedure('public.get_hero_performance(text,text,integer,integer)'),
      to_regprocedure('public.get_zone_performance(text,integer)'),
      to_regprocedure('public.get_player_rankings(text,integer,text,integer)'),
      to_regprocedure('public.get_war_participation_summary(text,text)'),
      to_regprocedure('public.get_war_participation_summary(text,integer,text)')
    )
      AND pg_get_functiondef(function.oid) ~ 'attempt_result[[:space:]]*=[[:space:]]*''win'''
  ),
  0,
  'A5: none of the five still tests attempt_result = ''win'''
);

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES ('00000000-0000-0000-0000-0000006530a0', 'ZW8', 'TW6530 Cluster', now());

INSERT INTO public.guild_config (
  id, guild_code, display_name, cluster_code, cluster_id, created_at, enabled
)
VALUES (
  653001, 'TW6530-G', 'TW6530 Guild', 'ZW8',
  '00000000-0000-0000-0000-0000006530a0', now(), true
);

INSERT INTO public.guild_war_matches (
  war_id, guild_code, opponent_guild_code, opponent_guild_name, war_status,
  war_result, guild_score, opponent_score, war_season, battlefield_level,
  war_end_date
)
VALUES (
  'tw6530-war-1', 'TW6530-G', NULL, 'TW6530 Opponent', 'completed',
  'win', 1500, 900, 100, 5, now() - interval '1 day'
);

INSERT INTO public.guild_war_battles (
  war_id, guild_code, event_id, is_guild_member, zone_type, attempt_start_time,
  attempt_result, attacker_player_id, attacker_player_name,
  attacker_units_json, defender_units_json, score_earned, kill_count,
  defender_units_lost, damage_dealt
)
VALUES
  -- kill_count NULL exercises the inferred-kills ladder; o2/o3/o6 are phantom wins.
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-att', 'Att',
   '[{"heroKey": "TW6530_HERO_A"}, {"heroKey": "TW6530_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 0}, {"remainingHPAfter": 0}]'::jsonb, 1000, NULL, 2, 5000),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-att', 'Att',
   '[{"heroKey": "TW6530_HERO_A"}, {"heroKey": "TW6530_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 250}]'::jsonb, 300, NULL, 0, 1000),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-att', 'Att',
   '[{"heroKey": "TW6530_HERO_A"}, {"heroKey": "TW6530_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 10}]'::jsonb, 150, NULL, 0, 900),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'loss', 'TW6530-att', 'Att',
   '[{"heroKey": "TW6530_HERO_A"}, {"heroKey": "TW6530_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 900}]'::jsonb, 50, NULL, 0, 100),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-att', 'Att',
   '[{"heroKey": "TW6530_HERO_A"}, {"heroKey": "TW6530_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 0}, {"remainingHPAfter": 0}, {"remainingHPAfter": 0}]'::jsonb, 900, NULL, 3, 4000),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), true, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-att', 'Att',
   '[{"heroKey": "TW6530_HERO_A"}, {"heroKey": "TW6530_HERO_B"}]'::jsonb,
   '[{"remainingHPAfter": 75}]'::jsonb, 200, NULL, 0, 800),
  -- An attacker died when remainingHPAfter is ABSENT (survivors never carry HP 0).
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-enemy', 'Enemy',
   '[{"heroKey": "E1", "remainingHPAfter": 50}, {"heroKey": "E2"}]'::jsonb,
   '[{"heroKey": "TW6530_DEF_A", "remainingHPAfter": 400}]'::jsonb, 300, NULL, 0, 700),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-enemy', 'Enemy',
   '[{"heroKey": "E1", "remainingHPAfter": 60}, {"heroKey": "E2", "remainingHPAfter": 70}]'::jsonb,
   '[{"heroKey": "TW6530_DEF_A", "remainingHPAfter": 0}]'::jsonb, 1000, NULL, 1, 3000),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'loss', 'TW6530-enemy', 'Enemy',
   '[{"heroKey": "E1", "remainingHPAfter": 30}, {"heroKey": "E2"}]'::jsonb,
   '[{"heroKey": "TW6530_DEF_A", "remainingHPAfter": 800}]'::jsonb, 100, NULL, 0, 200),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-enemy', 'Enemy',
   '[{"heroKey": "E1"}, {"heroKey": "E2"}]'::jsonb,
   '[{"heroKey": "TW6530_DEF_A", "remainingHPAfter": 5}]'::jsonb, 400, NULL, 0, 600),
  ('tw6530-war-1', 'TW6530-G', gen_random_uuid(), false, 'mining_site', now() - interval '1 day',
   'win', 'TW6530-enemy', 'Enemy',
   '[{"heroKey": "E1", "remainingHPAfter": 90}, {"heroKey": "E2", "remainingHPAfter": 80}]'::jsonb,
   '[{"heroKey": "TW6530_DEF_A", "remainingHPAfter": 0}]'::jsonb, 800, NULL, 1, 2500);

-- The older snapshot carries wrong values so "newest wins" is provable.
INSERT INTO public.guild_war_participation (
  war_id, guild_code, user_id, display_name, opted_in,
  attempts_used, attempts_remaining, score, last_activity_on, snapshot_at
)
VALUES
  ('tw6530-war-1', 'TW6530-G', 'TW6530-p1', 'Player One', true,
   1, 9, 111, now() - interval '2 hours', now() - interval '2 hours'),
  ('tw6530-war-1', 'TW6530-G', 'TW6530-p1', 'Player One', true,
   6, 4, 999, now() - interval '10 minutes', now() - interval '10 minutes'),
  ('tw6530-war-1', 'TW6530-G', 'TW6530-p2', 'Player Two', false,
   0, 10, 50, now() - interval '1 hour', now() - interval '1 hour');

CREATE TEMP TABLE tw6530_hero_off AS
SELECT * FROM public.get_hero_performance('TW6530-G', 'offense', 20, 4);

CREATE TEMP TABLE tw6530_hero_def AS
SELECT * FROM public.get_hero_performance('TW6530-G', 'defense', 20, 4);

CREATE TEMP TABLE tw6530_zone AS
SELECT * FROM public.get_zone_performance('TW6530-G', NULL);

CREATE TEMP TABLE tw6530_rank AS
SELECT * FROM public.get_player_rankings('TW6530-G', NULL, 'win_rate', 50);

CREATE TEMP TABLE tw6530_part2 AS
SELECT * FROM public.get_war_participation_summary('TW6530-G', 'tw6530-war-1');

CREATE TEMP TABLE tw6530_part3 AS
SELECT * FROM public.get_war_participation_summary('TW6530-G', NULL, NULL);

SELECT is(
  (SELECT uses::integer FROM tw6530_hero_off WHERE hero_key = 'TW6530_HERO_A'),
  6,
  'B1: HERO_A is credited with all six offence uses'
);

SELECT is(
  (SELECT wins::integer FROM tw6530_hero_off WHERE hero_key = 'TW6530_HERO_A'),
  2,
  'B2: two true captures (the raw-attempt_result logic said 5)'
);

SELECT is(
  (SELECT losses::integer FROM tw6530_hero_off WHERE hero_key = 'TW6530_HERO_A'),
  4,
  'B3: wins + losses equals uses; the old logic said 1 loss and dropped the three phantom wins'
);

SELECT is(
  (SELECT win_rate FROM tw6530_hero_off WHERE hero_key = 'TW6530_HERO_A'),
  33.3::numeric,
  'B4: offence win rate 33.3, not the inflated 83.3'
);

-- 2 dead on o1 + 3 on o5 = 5/6 = 0.83 -> 0.8; AVG(kill_count) would be NULL.
SELECT is(
  (SELECT avg_kills FROM tw6530_hero_off WHERE hero_key = 'TW6530_HERO_A'),
  0.8::numeric,
  'B5: avg_kills is inferred from defender HP (0.8); the old AVG(kill_count) returned NULL on this seed'
);

SELECT is(
  (SELECT wins::integer FROM tw6530_hero_def WHERE hero_key = 'TW6530_DEF_A'),
  3,
  'C1: DEF_A held three of five (the attempt_result = ''loss'' logic said 1)'
);

SELECT is(
  (SELECT win_rate FROM tw6530_hero_def WHERE hero_key = 'TW6530_DEF_A'),
  60.0::numeric,
  'C2: defensive rate 60.0, not the deflated 20.0'
);

-- (300+1000+100+400+800)/5 = 520.0; the old `1000 - score_earned` gave 680.0.
SELECT is(
  (SELECT avg_score FROM tw6530_hero_def WHERE hero_key = 'TW6530_DEF_A'),
  520.0::numeric,
  'C3: defence avg_score is average CONCEDED (520.0); the old 1000 - score_earned expression gave 680.0'
);

-- d1=1, d2=0, d3=1, d5=0, d4 NULL: 0.5. AVG(5 - defender_units_lost) gives 4.6.
SELECT is(
  (SELECT avg_kills FROM tw6530_hero_def WHERE hero_key = 'TW6530_DEF_A'),
  0.5::numeric,
  'C4: defence avg_kills counts attackers killed (0.5); the old 5 - defender_units_lost gave 4.6'
);

-- Captures o1, o5, d2, d5 = 4; the raw flag would count 9.
SELECT is(
  (SELECT total_attempts FROM tw6530_zone WHERE zone_id = 'mining_site'),
  11,
  'D1: the zone rollup sees all eleven seeded attempts'
);

SELECT is(
  (SELECT wins FROM tw6530_zone WHERE zone_id = 'mining_site'),
  4,
  'D2: four captures (the raw attempt_result = ''win'' logic counted 9)'
);

SELECT is(
  (SELECT ROUND(win_rate, 4) FROM tw6530_zone WHERE zone_id = 'mining_site'),
  0.3636::numeric,
  'D3: zone win rate 0.3636, not the inflated 0.8182'
);

SELECT is(
  (SELECT wins FROM tw6530_rank WHERE player_id = 'TW6530-att'),
  2,
  'E1: the attacker has two true captures (the raw flag counted 5)'
);

SELECT is(
  (SELECT ROUND(win_rate, 4) FROM tw6530_rank WHERE player_id = 'TW6530-att'),
  0.3333::numeric,
  'E2: ranking win rate 0.3333, not the inflated 0.8333'
);

-- The broken version raised 42703 on every call, so F1 alone proves the repair.
SELECT is(
  (SELECT count(*)::integer FROM tw6530_part2),
  2,
  'F1: returns one row per PLAYER (2), not one per snapshot (3) -- and no longer raises 42703'
);

SELECT is(
  (SELECT attempts_used FROM tw6530_part2 WHERE player_id = 'TW6530-p1'),
  6,
  'F2: the NEWEST snapshot wins (attempts_used 6, not the stale 1)'
);

SELECT is(
  (SELECT score FROM tw6530_part2 WHERE player_id = 'TW6530-p1'),
  999,
  'F3: newest-snapshot score 999, not the stale 111'
);

SELECT is(
  (SELECT opted_in FROM tw6530_part2 WHERE player_id = 'TW6530-p2'),
  false,
  'F4: the columns still map to the right fields after the user_id/war_id repair'
);

SELECT is(
  (SELECT wins FROM tw6530_part3 WHERE player_id = 'TW6530-att'),
  2,
  'G1: season rollup counts two true captures (the raw flag counted 5)'
);

SELECT is(
  (SELECT attempts FROM tw6530_part3 WHERE player_id = 'TW6530-att'),
  6,
  'G2: the attempts denominator is untouched by the win-definition fix'
);

-- Non-vacuity: without phantom wins every assertion could pass for the wrong reason.
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.guild_war_battles
    WHERE guild_code = 'TW6530-G'
      AND attempt_result = 'win'
      AND NOT war_zone_captured(attempt_result, defender_units_json)
  ),
  5,
  'H1: the seed really contains five phantom wins -- without them B/D/E/G would be vacuous'
);

SELECT * FROM finish();
ROLLBACK;
\endif

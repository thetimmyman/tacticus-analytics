BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(4);

-- Defeat derives from remaining HP: "completedOn" is the battle-end time, not a kill marker.

INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES (926100, 'WI2650A', 'WI 2610 Lifecycle Guild', now(), true);

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('WI2650A', '99', 'Tester', 'BelisariusRW', 'Battle', 400000, 0, 6, 0, 30000000, 20000000, now() - interval '3 hours', now() - interval '3 hours', 0, 'Mythic', 'wi2650-p1', 0, 'Boss'),
  ('WI2650A', '99', 'Tester', 'TanGida',      'Battle', 300000, 0, 6, 0, 1800000,  900000,   now() - interval '2 hours', now() - interval '2 hours', 1, 'Mythic', 'wi2650-p1', 1, 'SideBoss'),
  ('WI2650A', '99', 'Tester', 'Actus',        'Battle', 500000, 0, 6, 0, 2100000,  0,        now() - interval '1 hour',  now() - interval '1 hour',  2, 'Mythic', 'wi2650-p1', 2, 'SideBoss');

SELECT results_eq(
  $q$ SELECT encounter_id, lifecycle_state
      FROM public.get_current_boss_status('WI2650A', '99')
      ORDER BY encounter_id $q$,
  $v$ VALUES (0, 'warded'), (1, 'active'), (2, 'defeated') $v$,
  'WI2650A: lifecycle derives from raw HP — warded main, active prime, defeated prime'
);

SELECT results_eq(
  $q$ SELECT warded FROM public.get_current_boss_status('WI2650A', '99')
      WHERE encounter_id = 0 $q$,
  $v$ VALUES (true) $v$,
  'WI2650A: main with an alive prime reports warded = true'
);

SELECT results_eq(
  $q$ SELECT DISTINCT alive_primes
      FROM public.get_current_boss_status('WI2650A', '99') $q$,
  $v$ VALUES (1) $v$,
  'WI2650A: alive_primes counts only the genuinely alive prime'
);

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('WI2650A', '99', 'Tester', 'TanGida',      'Battle', 900000, 0, 6, 0, 1800000,  0, now() - interval '30 minutes', now() - interval '30 minutes', 1, 'Mythic', 'wi2650-p1', 1, 'SideBoss'),
  ('WI2650A', '99', 'Tester', 'BelisariusRW', 'Battle', 900000, 0, 6, 0, 30000000, 0, now() - interval '10 minutes', now() - interval '10 minutes', 0, 'Mythic', 'wi2650-p1', 0, 'Boss');

SELECT results_eq(
  $q$ SELECT encounter_id, lifecycle_state, warded
      FROM public.get_current_boss_status('WI2650A', '99')
      ORDER BY encounter_id $q$,
  $v$ VALUES (0, 'defeated', false), (1, 'defeated', false), (2, 'defeated', false) $v$,
  'WI2650A: fully-cleared stage reads defeated across the board'
);

SELECT * FROM finish();

ROLLBACK;

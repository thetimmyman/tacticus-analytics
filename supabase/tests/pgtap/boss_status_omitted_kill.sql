BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(10);

-- The API sometimes omits the kill hit, so a defeat is inferred from a stage kill row or newer
-- later-stage engagement; the homepage inferMainBossDeath heuristic is deliberately not used (guild D).

INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES
  (926700, 'TW2670A', 'Test Omitted Main Kill Guild', now(), true),
  (926701, 'TW2670B', 'Test Later Stage Guild', now(), true),
  (926702, 'TW2670C', 'Test Control Guild', now(), true),
  (926703, 'TW2670D', 'Test Warded Control Guild', now(), true);

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('TW2670A', '99', 'Tester', 'BelisariusRW', 'Battle', 400000, 0, 6, 0, 30000000, 20000000, now() - interval '3 hours', now() - interval '3 hours', 0, 'Mythic', 'tw2670-p1', 0, 'Boss'),
  ('TW2670A', '99', 'Tester', 'TanGida',      'Battle', 300000, 1, 6, 0, 1800000,  900000,   now() - interval '1 hour',  now() - interval '1 hour',  1, 'Mythic', 'tw2670-p1', 1, 'SideBoss');

SELECT results_eq(
  $q$ SELECT encounter_id, lifecycle_state
      FROM public.get_current_boss_status('TW2670A', '99')
      ORDER BY encounter_id $q$,
  $v$ VALUES (0, 'defeated'), (1, 'active') $v$,
  'TW2670A: main with omitted kill reads defeated once the next loop is engaged'
);

SELECT results_eq(
  $q$ SELECT warded FROM public.get_current_boss_status('TW2670A', '99')
      WHERE encounter_id = 0 $q$,
  $v$ VALUES (false) $v$,
  'TW2670A: an inferred-dead main is never warded'
);

SELECT results_eq(
  $q$ SELECT DISTINCT alive_primes
      FROM public.get_current_boss_status('TW2670A', '99') $q$,
  $v$ VALUES (1) $v$,
  'TW2670A: the genuinely alive next-loop prime still counts'
);

-- Guild B: the stale prime occupies no prime slot.
INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('TW2670B', '99', 'Tester', 'TanGida',      'Battle', 300000, 0, 6, 0, 1800000,  900000,  now() - interval '6 hours', now() - interval '6 hours', 1, 'Mythic', 'tw2670-p2', 1, 'SideBoss'),
  ('TW2670B', '99', 'Tester', 'BelisariusRW', 'Battle', 900000, 0, 6, 0, 30000000, 5000000, now() - interval '5 hours', now() - interval '5 hours', 0, 'Mythic', 'tw2670-p2', 0, 'Boss'),
  ('TW2670B', '99', 'Tester', 'Tanksmasha',   'Battle', 700000, 0, 6, 1, 2500000,  1800000, now() - interval '1 hour',  now() - interval '1 hour',  2, 'Mythic', 'tw2670-p2', 2, 'SideBoss');

SELECT results_eq(
  $q$ SELECT lifecycle_state
      FROM public.get_current_boss_status('TW2670B', '99')
      WHERE encounter_id = 0 $q$,
  $v$ VALUES ('defeated') $v$,
  'TW2670B: stale main reads defeated once a later stage is engaged'
);

SELECT is_empty(
  $q$ SELECT 1 FROM public.get_current_boss_status('TW2670B', '99')
      WHERE boss_name = 'TanGida' $q$,
  'TW2670B: stale prime with omitted kill does not occupy a prime slot'
);

SELECT results_eq(
  $q$ SELECT DISTINCT alive_primes
      FROM public.get_current_boss_status('TW2670B', '99') $q$,
  $v$ VALUES (1) $v$,
  'TW2670B: alive_primes counts only the newest stage''s live prime'
);

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('TW2670C', '99', 'Tester', 'BelisariusRW', 'Battle', 400000, 0, 6, 0, 30000000, 20000000, now() - interval '1 hour', now() - interval '1 hour', 0, 'Mythic', 'tw2670-p3', 0, 'Boss');

SELECT results_eq(
  $q$ SELECT lifecycle_state
      FROM public.get_current_boss_status('TW2670C', '99')
      WHERE encounter_id = 0 $q$,
  $v$ VALUES ('active') $v$,
  'TW2670C: genuinely alive main with no later activity stays active'
);

SELECT results_eq(
  $q$ SELECT DISTINCT alive_primes
      FROM public.get_current_boss_status('TW2670C', '99') $q$,
  $v$ VALUES (0) $v$,
  'TW2670C: control guild reports zero alive primes'
);

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('TW2670D', '99', 'Tester', 'BelisariusRW', 'Battle', 400000, 0, 6, 0, 30000000, 20000000, now() - interval '3 hours', now() - interval '3 hours', 0, 'Mythic', 'tw2670-p4', 0, 'Boss'),
  ('TW2670D', '99', 'Tester', 'TanGida',      'Battle', 300000, 0, 6, 0, 1800000,  900000,   now() - interval '2 hours', now() - interval '2 hours', 1, 'Mythic', 'tw2670-p4', 1, 'SideBoss'),
  ('TW2670D', '99', 'Tester', 'Actus',        'Battle', 500000, 0, 6, 0, 2100000,  0,        now() - interval '1 hour',  now() - interval '1 hour',  2, 'Mythic', 'tw2670-p4', 2, 'SideBoss');

SELECT results_eq(
  $q$ SELECT encounter_id, lifecycle_state
      FROM public.get_current_boss_status('TW2670D', '99')
      ORDER BY encounter_id $q$,
  $v$ VALUES (0, 'warded'), (1, 'active'), (2, 'defeated') $v$,
  'TW2670D: alive main with NEWER same-stage prime hits stays warded (heuristic not imported)'
);

SELECT results_eq(
  $q$ SELECT warded FROM public.get_current_boss_status('TW2670D', '99')
      WHERE encounter_id = 0 $q$,
  $v$ VALUES (true) $v$,
  'TW2670D: warded flag survives newer same-stage prime activity'
);

SELECT * FROM finish();

ROLLBACK;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(6);

-- Prime rows are scoped to the stage of the NEWEST battle row, so a finished stage's orphaned
-- primes cannot occupy the prime slots.

INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES
  (925900, 'xpfhmoiA', 'xpmdjlo Orphan Guild', now(), true),
  (925901, 'xpfhmoiB', 'xpmdjlo Mid-Stage Guild', now(), true);

-- Guild A: prime slots re-anchor to set 1 while the main row stays the dead M1 main.
INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('xpfhmoiA', '99', 'Tester', 'TanGida',      'Battle', 100000, 0, 6, 0, 1800000,  80000,   now() - interval '5 hours', now() - interval '5 hours', 1, 'Mythic', 'xpfhmoi-p1', 1, 'SideBoss'),
  ('xpfhmoiA', '99', 'Tester', 'BelisariusRW', 'Battle', 900000, 0, 6, 0, 30000000, 0,       now() - interval '3 hours', now() - interval '3 hours', 0, 'Mythic', 'xpfhmoi-p1', 0, 'Boss'),
  ('xpfhmoiA', '99', 'Tester', 'Tanksmasha',   'Battle', 700000, 0, 6, 1, 2500000,  1800000, now() - interval '1 hour',  now() - interval '1 hour',  2, 'Mythic', 'xpfhmoi-p1', 2, 'SideBoss');

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('xpfhmoiB', '99', 'Tester', 'BelisariusRW', 'Battle', 400000, 0, 6, 0, 30000000, 20000000, now() - interval '2 hours', now() - interval '2 hours', 0, 'Mythic', 'xpfhmoi-p2', 0, 'Boss'),
  ('xpfhmoiB', '99', 'Tester', 'TanGida',      'Battle', 300000, 0, 6, 0, 1800000,  900000,   now() - interval '1 hour',  now() - interval '1 hour',  1, 'Mythic', 'xpfhmoi-p2', 1, 'SideBoss');

SELECT results_eq(
  $q$ SELECT encounter_id, boss_name
      FROM public.get_current_boss_status('xpfhmoiA', '99')
      ORDER BY encounter_id $q$,
  $v$ VALUES (0, 'BelisariusRW'), (2, 'Tanksmasha') $v$,
  'xpfhmoiA: prime slots re-anchor to the newest stage (M2), main row unchanged'
);

SELECT is_empty(
  $q$ SELECT 1 FROM public.get_current_boss_status('xpfhmoiA', '99')
      WHERE boss_name = 'TanGida' $q$,
  'xpfhmoiA: orphaned M1 prime (left alive when the main died) is excluded'
);

SELECT results_eq(
  $q$ SELECT remaining_hp::numeric
      FROM public.get_current_boss_status('xpfhmoiA', '99')
      WHERE encounter_id = 2 $q$,
  $v$ VALUES (1800000::numeric) $v$,
  'xpfhmoiA: re-anchored prime reports its actual remaining HP'
);

SELECT results_eq(
  $q$ SELECT boss_name, remaining_hp::numeric
      FROM public.get_current_boss_status('xpfhmoiA', '99')
      WHERE encounter_id = 0 $q$,
  $v$ VALUES ('BelisariusRW', NULL::numeric) $v$,
  'xpfhmoiA: main row remains the globally-latest encounter-0 row'
);

SELECT results_eq(
  $q$ SELECT encounter_id, boss_name
      FROM public.get_current_boss_status('xpfhmoiB', '99')
      ORDER BY encounter_id $q$,
  $v$ VALUES (0, 'BelisariusRW'), (1, 'TanGida') $v$,
  'xpfhmoiB: mid-stage prime scoping is unchanged (xafbdcb regression guard)'
);


SELECT results_eq(
  $q$ SELECT remaining_hp::numeric
      FROM public.get_current_boss_status('xpfhmoiB', '99')
      WHERE encounter_id = 1 $q$,
  $v$ VALUES (900000::numeric) $v$,
  'xpfhmoiB: mid-stage prime reports its live remaining HP'
);

SELECT * FROM finish();

ROLLBACK;

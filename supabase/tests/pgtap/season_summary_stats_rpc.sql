BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- get_season_summary_stats: aggregates server-side so detect-season-end's
-- Discord summary cannot be silently truncated by PostgREST's row cap.

SELECT plan(8);

SELECT has_function('public', 'get_season_summary_stats',
  ARRAY['text', 'text'],
  'get_season_summary_stats exists with the (cluster_code, season) signature');

INSERT INTO public."EOT_GR_data"
  (cluster_code, "Guild", "Season", "displayName", "damageType", "damageDealt",
   type, "encounterIndex", "encounterId", "remainingHp", "maxHp")
VALUES
  -- meaningful: not a sweep (remainingHp <> 0)
  ('TestClstA', 'G1', '999901', 'PlayerA', 'Battle', 1000, 'Boss1', 0, 0, 500, 2000),
  -- meaningful: a one-shot (damage >= maxHp), not a sweep
  ('TestClstA', 'G1', '999901', 'PlayerA', 'Battle', 2000, 'Boss1', 0, 0, 0, 2000),
  -- a sweep (remainingHp = 0, damage < maxHp): counted in totals, excluded from the avg
  ('TestClstA', 'G1', '999901', 'PlayerB', 'Battle', 500, 'Boss1', 0, 0, 0, 2000),
  -- meaningful, a different boss
  ('TestClstA', 'G1', '999901', 'PlayerB', 'Battle', 3000, 'Boss2', 1, 0, 1000, 5000),
  -- a Bomb row: counted in totals/players, excluded from the avg (not a Battle row)
  ('TestClstA', 'G1', '999901', 'PlayerC', 'Bomb', 100, 'Boss2', 1, 0, NULL, NULL);

SELECT results_eq(
  $$SELECT total_damage, total_battles, active_players, bosses_defeated,
           avg_damage, top_performer, top_performer_damage
      FROM public.get_season_summary_stats('TestClstA', '999901')$$,
  $$VALUES (6600::bigint, 5, 3, 2, 2000::bigint, 'PlayerB'::text, 3500::bigint)$$,
  'aggregates totals, the meaningful-only average, and the top total-damage contributor'
);

SELECT is(
  (SELECT total_damage FROM public.get_season_summary_stats('TestClstB', '999902')),
  0::bigint,
  'an empty cluster/season returns zeroed totals, not zero rows'
);
SELECT is(
  (SELECT top_performer FROM public.get_season_summary_stats('TestClstB', '999902')),
  'N/A',
  'an empty cluster/season falls back to N/A rather than NULL'
);
SELECT is(
  (SELECT total_battles FROM public.get_season_summary_stats('TestClstB', '999902')),
  0,
  'an empty cluster/season has zero battles'
);
SELECT is(
  (SELECT active_players FROM public.get_season_summary_stats('TestClstB', '999902')),
  0,
  'an empty cluster/season has zero active players'
);
SELECT is(
  (SELECT bosses_defeated FROM public.get_season_summary_stats('TestClstB', '999902')),
  0,
  'an empty cluster/season has zero bosses defeated'
);
SELECT is(
  (SELECT top_performer_damage FROM public.get_season_summary_stats('TestClstB', '999902')),
  0::bigint,
  'an empty cluster/season has zero top-performer damage'
);

SELECT finish();

ROLLBACK;

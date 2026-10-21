BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT plan(5);

-- Rollback restores the original relation and its planner statistics.
ALTER TABLE public."EOT_GR_data" RENAME TO public_stats_original_history;
CREATE TABLE public."EOT_GR_data"
  (LIKE public.public_stats_original_history INCLUDING ALL);

INSERT INTO public."EOT_GR_data"
  ("Guild", "Season", "userId", "displayName", "encounterId", "damageDealt")
SELECT 'EXAMPLE_GUILD_' || (n % 5),
       CASE WHEN n % 2 = 0 THEN '100' ELSE '9' END,
       'example-player-' || n,
       'Example Player ' || (n % 10) || repeat(' label', 30),
       n, 500000000
FROM generate_series(1, 5000) n;
ANALYZE public."EOT_GR_data";

SELECT is(public.get_public_stats_live(),
  '{"active_players":10,"battles_tracked":5000,"guild_count":5,"total_damage":2500000000000,"current_season":"100"}'::jsonb,
  'public statistics retain exact counts, bigint damage and numeric season ordering');

CREATE TEMP TABLE public_stats_plan (value jsonb) ON COMMIT DROP;
DO $$
DECLARE result jsonb;
BEGIN
  EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT public.get_public_stats_live()' INTO result;
  INSERT INTO public_stats_plan VALUES (result);
END;
$$;
SELECT ok(
  (value->0->'Plan'->>'Shared Hit Blocks')::bigint +
  (value->0->'Plan'->>'Shared Read Blocks')::bigint < 600,
  'public statistics avoid rescanning repeated names within the history read budget')
FROM public_stats_plan;
SELECT diag('buffer accesses=' || ((value->0->'Plan'->>'Shared Hit Blocks')::bigint + (value->0->'Plan'->>'Shared Read Blocks')::bigint)) FROM public_stats_plan;

TRUNCATE public."EOT_GR_data";
SELECT is(public.get_public_stats_live(),
  '{"active_players":0,"battles_tracked":0,"guild_count":0,"total_damage":0,"current_season":null}'::jsonb,
  'empty history returns zero totals and a null current season');

INSERT INTO public."EOT_GR_data"
  ("Guild", "displayName", "Season", "damageDealt", "userId", "encounterId")
VALUES
  ('EOT', 'Alpha', '9', 5, 'example-edge-1', 1),
  ('TEST', 'Alpha', '10', NULL, 'example-edge-2', 2),
  ('TEST', NULL, NULL, NULL, 'example-edge-3', 3),
  ('', '', '100', 7, 'example-edge-4', 4),
  ('eot', 'alpha', '2', 0, 'example-edge-5', 5),
  (' EOT ', 'Alpha ', 'unknown', 9, 'example-edge-6', 6),
  ('EXAMPLE_GUILD', NULL, '11', 1, 'example-edge-7', 7);
SELECT is(public.get_public_stats_live(),
  '{"active_players":4,"battles_tracked":7,"guild_count":4,"total_damage":22,"current_season":"100"}'::jsonb,
  'nulls, empty names, case, whitespace and exact reserved guild exclusions retain their meaning');

TRUNCATE public."EOT_GR_data";
INSERT INTO public."EOT_GR_data"
  ("Guild", "displayName", "Season", "damageDealt", "userId", "encounterId")
VALUES
  ('EOT', NULL, NULL, NULL, 'example-null-1', 1),
  ('TEST', NULL, NULL, NULL, 'example-null-2', 2);
SELECT is(public.get_public_stats_live(),
  '{"active_players":0,"battles_tracked":2,"guild_count":0,"total_damage":0,"current_season":null}'::jsonb,
  'all-null names and excluded guilds still count history rows without inventing totals');
SELECT * FROM finish();
ROLLBACK;

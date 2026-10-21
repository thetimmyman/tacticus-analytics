BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT plan(8);

-- Keep physical fixture pages and planner statistics isolated from other
-- suites. Rollback restores the original relation and all its dependencies.
ALTER TABLE public."EOT_GR_data" RENAME TO season_lookup_original_history;
CREATE TABLE public."EOT_GR_data"
  (LIKE public.season_lookup_original_history INCLUDING ALL);

-- Synthetic history with many rows per season and both cluster filters.
INSERT INTO public."EOT_GR_data"
  ("Guild", "Season", "userId", "displayName", "encounterId", cluster_code)
SELECT 'SEASON_LOOKUP_EXAMPLE', ((n % 10) + 1)::text,
       'season-lookup-example-' || n, repeat('Example ', 20), n,
       CASE WHEN (n / 10) % 2 = 0 THEN 'SYN_A' ELSE 'SYN_B' END
FROM generate_series(1, 5000) n;
INSERT INTO public."EOT_GR_data"
  ("Guild", "Season", "userId", "encounterId", cluster_code)
VALUES
  ('SEASON_LOOKUP_EXAMPLE', '11', 'season-lookup-extra', 0, 'SYN_B'),
  ('SEASON_LOOKUP_EXAMPLE', 'unknown', 'season-lookup-invalid', 0, 'SYN_A'),
  ('SEASON_LOOKUP_EXAMPLE', '', 'season-lookup-empty', 0, 'SYN_A'),
  ('SEASON_LOOKUP_EXAMPLE', NULL, 'season-lookup-null', 0, 'SYN_A'),
  ('SEASON_LOOKUP_OTHER', '999', 'season-lookup-other', 0, 'SYN_A');
ANALYZE public."EOT_GR_data";

SELECT is(public.get_distinct_seasons_for_guild('SEASON_LOOKUP_EXAMPLE'),
  ARRAY['11','10','9','8','7','6','5','4','3','2','1'],
  'returns unique numeric seasons in descending numeric order');
SELECT is(public.get_distinct_seasons_for_guild('SEASON_LOOKUP_EXAMPLE', 'SYN_A'),
  ARRAY['10','9','8','7','6','5','4','3','2','1'],
  'cluster filter excludes seasons that exist only in another cluster');
SELECT is(public.get_distinct_seasons_for_guild('SEASON_LOOKUP_EXAMPLE', 'SYN_B'),
  ARRAY['11','10','9','8','7','6','5','4','3','2','1'],
  'cluster filter retains every matching season');
SELECT is(public.get_distinct_seasons_for_guild('SEASON_LOOKUP_EXAMPLE', 'SYN_MISSING'),
  ARRAY[]::text[], 'unknown cluster returns an empty array');
SELECT is(public.get_distinct_seasons_for_guild('SEASON_LOOKUP_MISSING'),
  ARRAY[]::text[], 'unknown guild returns an empty array');
SELECT is(public.get_distinct_seasons_for_guild(NULL),
  ARRAY[]::text[], 'null guild returns an empty array');
SELECT ok(NOT ('999' = ANY(public.get_distinct_seasons_for_guild('SEASON_LOOKUP_EXAMPLE'))),
  'another guild cannot add a season to the result');

-- Count buffer accesses rather than elapsed time so shared CI load does not
-- make the regression threshold depend on machine speed or cache warmth.
CREATE TEMP TABLE season_lookup_plan (value jsonb) ON COMMIT DROP;
DO $$
DECLARE result jsonb;
BEGIN
  EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT public.get_distinct_seasons_for_guild(''SEASON_LOOKUP_EXAMPLE'')' INTO result;
  INSERT INTO season_lookup_plan VALUES (result);
END;
$$;
SELECT ok(
  (value->0->'Plan'->>'Shared Hit Blocks')::bigint +
  (value->0->'Plan'->>'Shared Read Blocks')::bigint < 128,
  'season lookup stays below a bounded read budget for repeated history rows')
FROM season_lookup_plan;
SELECT diag('buffer accesses=' || ((value->0->'Plan'->>'Shared Hit Blocks')::bigint + (value->0->'Plan'->>'Shared Read Blocks')::bigint)) FROM season_lookup_plan;
SELECT * FROM finish();
ROLLBACK;

-- queue_token_burn_notifications()'s latest-season lookup must stop after the first index row.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(8);

-- indoption bits: 0 = DESC, 1 = NULLS FIRST; [0, 1, 1] is ASC, DESC, DESC (all NULLS LAST).
SELECT has_index(
  'public',
  'EOT_GR_data',
  'idx_eot_gr_data_guild_latest_raid',
  'the guild latest-raid index exists'
);

SELECT is(
  (
    SELECT am.amname
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    WHERE i.indexrelid = to_regclass('public.idx_eot_gr_data_guild_latest_raid')
  ),
  'btree',
  'the guild latest-raid index is a btree'
);

SELECT is(
  (
    SELECT array_agg(a.attname::text ORDER BY k.ordinality)
    FROM pg_catalog.pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = k.attnum
    WHERE i.indexrelid = to_regclass('public.idx_eot_gr_data_guild_latest_raid')
      AND k.ordinality <= i.indnkeyatts
  ),
  ARRAY['Guild', 'timestamp', 'startedOn']::text[],
  'key columns exactly match Guild plus both ORDER BY columns in order'
);

SELECT is(
  (
    SELECT array_agg((o.option & 1)::integer ORDER BY o.ordinality)
    FROM pg_catalog.pg_index i
    CROSS JOIN LATERAL unnest(i.indoption) WITH ORDINALITY AS o(option, ordinality)
    WHERE i.indexrelid = to_regclass('public.idx_eot_gr_data_guild_latest_raid')
      AND o.ordinality <= i.indnkeyatts
  ),
  ARRAY[0, 1, 1]::integer[],
  'Guild is ASC while timestamp and startedOn are DESC'
);

SELECT is(
  (
    SELECT bool_and((o.option & 2) = 0)
    FROM pg_catalog.pg_index i
    CROSS JOIN LATERAL unnest(i.indoption) WITH ORDINALITY AS o(option, ordinality)
    WHERE i.indexrelid = to_regclass('public.idx_eot_gr_data_guild_latest_raid')
      AND o.ordinality <= i.indnkeyatts
  ),
  true,
  'all three key columns use NULLS LAST'
);

SELECT is(
  (
    SELECT array_agg(a.attname::text ORDER BY k.ordinality)
    FROM pg_catalog.pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = k.attnum
    WHERE i.indexrelid = to_regclass('public.idx_eot_gr_data_guild_latest_raid')
      AND k.ordinality > i.indnkeyatts
      AND k.ordinality <= i.indnatts
  ),
  ARRAY['Season']::text[],
  'Season is the included payload column'
);

-- enable_seqscan only removes the seq scan; the planner must still pick the ordered index scan.
INSERT INTO public."EOT_GR_data"
  ("Guild", "Season", "startedOn", "timestamp", "encounterId")
VALUES
  ('PS278_TEST', '277', now() - interval '2 hours', now() - interval '2 hours', 1),
  ('PS278_TEST', '278', now() - interval '4 hours', now() - interval '4 hours', 2),
  ('PS278_TEST', '279', now() - interval '3 hours', now() - interval '3 hours', 3),
  ('PS278_TEST', NULL, now() - interval '1 hour', now() - interval '1 hour', 4),
  ('PS278_OTHER', '999', now(), now(), 5);

SET LOCAL enable_seqscan = off;

CREATE TEMP TABLE ps278_explain_plan (plan jsonb) ON COMMIT DROP;
DO $capture_explain$
DECLARE
  explained json;
BEGIN
  EXECUTE $query$
    EXPLAIN (FORMAT JSON, COSTS OFF)
    SELECT e."Season"
    FROM public."EOT_GR_data" e
    WHERE e."Guild" = 'PS278_TEST'
    ORDER BY e."timestamp" DESC NULLS LAST,
             e."startedOn" DESC NULLS LAST
    LIMIT 1
  $query$
  INTO explained;

  INSERT INTO ps278_explain_plan (plan)
  VALUES ((explained::jsonb)->0->'Plan');
END;
$capture_explain$;

CREATE TEMP VIEW ps278_explain_nodes AS
WITH RECURSIVE nodes AS (
  SELECT plan AS node
  FROM ps278_explain_plan
  UNION ALL
  SELECT child.node
  FROM nodes parent
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(parent.node->'Plans', '[]'::jsonb)) child(node)
)
SELECT node
FROM nodes;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM ps278_explain_nodes
    WHERE node->>'Node Type' IN ('Index Scan', 'Index Only Scan')
      AND node->>'Index Name' = 'idx_eot_gr_data_guild_latest_raid'
  ),
  'the exact latest-season lookup uses the new index'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM ps278_explain_nodes
    WHERE node->>'Node Type' IN ('Sort', 'Incremental Sort')
  ),
  'the exact latest-season lookup has no Sort or Incremental Sort node'
);

SELECT * FROM finish();
ROLLBACK;

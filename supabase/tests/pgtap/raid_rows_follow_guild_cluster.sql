BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(9);

-- A guild's raid rows follow its cluster, so seasons written before a join stay visible.

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'TSTCLA', 'Test Cluster A', now()),
  ('a1000000-0000-4000-8000-000000000002', 'TSTCLB', 'Test Cluster B', now());

INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES
  (927100, 'TRFGC1', 'Test Restamp Guild', now(), true),
  (927101, 'TRFGC2', 'Test Bystander Guild', now(), true);

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp",
  "startedOn", "completedOn", "encounterId", "rarity", "userId",
  "encounterIndex", "encounterType"
)
VALUES
  ('TRFGC1', '97', 'Tester', 'TanGida', 'Battle', 100000, 0, 6, 0, 1800000, 900000, now(), now(), 1, 'Mythic', 'trfgc-p1', 1, 'SideBoss'),
  ('TRFGC1', '98', 'Tester', 'TanGida', 'Battle', 100000, 0, 6, 0, 1800000, 900000, now(), now(), 1, 'Mythic', 'trfgc-p1', 1, 'SideBoss'),
  ('TRFGC2', '98', 'Other',  'TanGida', 'Battle', 100000, 0, 6, 0, 1800000, 900000, now(), now(), 1, 'Mythic', 'trfgc-p2', 1, 'SideBoss');

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = 'public.guild_config_restamp_raid_cluster()'::regprocedure),
  'the restamp trigger function runs as definer, since only service_role may write raid rows'
);

-- Join cluster A.
UPDATE public.guild_config
   SET cluster_code = 'TSTCLA', cluster_id = 'a1000000-0000-4000-8000-000000000001', is_cluster = true
 WHERE guild_code = 'TRFGC1';

SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data"
    WHERE "Guild" = 'TRFGC1' AND cluster_code = 'TSTCLA'
      AND cluster_id = 'a1000000-0000-4000-8000-000000000001'),
  2,
  'joining a cluster tags every earlier raid row of the guild with it'
);

SELECT is(
  public.get_distinct_seasons_for_guild('TRFGC1', 'TSTCLA'),
  ARRAY['98', '97']::text[],
  'the cluster-scoped season list includes seasons written before the join'
);

SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data"
    WHERE "Guild" = 'TRFGC2' AND cluster_code IS NULL AND cluster_id IS NULL),
  1,
  'another guild''s raid rows are untouched'
);

-- An update that leaves the cluster alone does not re-tag rows.
UPDATE public."EOT_GR_data" SET cluster_code = NULL, cluster_id = NULL
 WHERE "Guild" = 'TRFGC1' AND "Season" = '97';
UPDATE public.guild_config SET display_name = 'Test Restamp Guild 2' WHERE guild_code = 'TRFGC1';

SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data"
    WHERE "Guild" = 'TRFGC1' AND cluster_code IS NULL),
  1,
  'an update that does not change the cluster leaves raid rows alone'
);

-- Move to cluster B.
UPDATE public.guild_config
   SET cluster_code = 'TSTCLB', cluster_id = 'a1000000-0000-4000-8000-000000000002'
 WHERE guild_code = 'TRFGC1';

SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data"
    WHERE "Guild" = 'TRFGC1' AND cluster_code = 'TSTCLB'
      AND cluster_id = 'a1000000-0000-4000-8000-000000000002'),
  2,
  'moving to another cluster re-tags every raid row of the guild'
);

SELECT is(
  public.get_distinct_seasons_for_guild('TRFGC1', 'TSTCLA'),
  ARRAY[]::text[],
  'the cluster the guild left no longer sees its seasons'
);

-- Leave clusters entirely.
UPDATE public.guild_config
   SET cluster_code = NULL, cluster_id = NULL, is_cluster = false
 WHERE guild_code = 'TRFGC1';

SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data"
    WHERE "Guild" = 'TRFGC1' AND cluster_code IS NULL AND cluster_id IS NULL),
  2,
  'leaving a cluster clears it from every raid row of the guild'
);

SELECT is(
  public.get_distinct_seasons_for_guild('TRFGC1'),
  ARRAY['98', '97']::text[],
  'an independent guild still sees all of its seasons'
);

SELECT * FROM finish();

ROLLBACK;

-- Drop five more indexes with zero scans on primary and replicas.
-- target-db: general
-- No transaction: DROP INDEX CONCURRENTLY forbids one. REFRESH CONCURRENTLY on
-- mv_cluster_season_rankings still works: its unique index is untouched.

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

-- The DROP list and verify in-list must match (lint:sql); a mismatch raises post-commit.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_guild_war_battles_zone;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_guild_war_lineups_hash_version;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_gwb_defender_lineup_analytics;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_gwb_lineup_analytics;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_mv_cluster_rankings_pk;

DO $verify$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*)::integer INTO leftover
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'i'
    AND c.relname IN (
      'idx_guild_war_battles_zone',
      'idx_guild_war_lineups_hash_version',
      'idx_gwb_defender_lineup_analytics',
      'idx_gwb_lineup_analytics',
      'idx_mv_cluster_rankings_pk'
    );

  IF leftover <> 0 THEN
    RAISE EXCEPTION '% target indexes still present after the drop', leftover;
  END IF;

  -- Positive control: the unique index that this database's one concurrently
  -- refreshed matview needs must still be here.
  --
  -- This control used to assert on idx_member_stats_summary_unique as well, and
  -- that assertion could only ever FAIL. This file's guard admits exactly one
  -- database, General; in General the whole member_stats_summary family was
  -- retired by 20260903190000, which is already applied. Despite the later
  -- timestamp, 20260903190000 precedes this file in the real apply order, so at
  -- this migration's position in the ledger idx_member_stats_summary_unique does
  -- not exist and to_regclass returns NULL. The control therefore raised on
  -- every run, AFTER the DROP INDEX CONCURRENTLY statements had already
  -- committed (this file is deliberately non-transactional), turning a
  -- successful apply into an apparent hard failure. A positive control may only
  -- assert on objects that exist in the database it guards, at the point the
  -- migration runs.
  IF to_regclass('public.idx_mv_cluster_season_rankings_unique') IS NULL THEN
    RAISE EXCEPTION
      'idx_mv_cluster_season_rankings_unique was removed; REFRESH CONCURRENTLY on mv_cluster_season_rankings would break';
  END IF;

  -- Positive control: the index PS-90 pulled from this migration for being on a
  -- live query path must SURVIVE.
  IF to_regclass('public.idx_guild_config_explore_privacy') IS NULL THEN
    RAISE EXCEPTION
      'idx_guild_config_explore_privacy was removed; it is on a live query path and must still exist';
  END IF;
END;
$verify$;

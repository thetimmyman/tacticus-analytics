-- Drop four indexes with zero scans on primary and replicas (1.3 GB plus write amplification).
-- target-db: general
-- No transaction: DROP INDEX CONCURRENTLY forbids one, and a plain DROP would take
-- ACCESS EXCLUSIVE on a hot table.

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

DROP INDEX CONCURRENTLY IF EXISTS public.idx_eot_gr_hit_comparison_probe_v2;
DROP INDEX CONCURRENTLY IF EXISTS public.captured_replay_eot_started_match;
DROP INDEX CONCURRENTLY IF EXISTS public.guild_war_battles_defender_units_gin;
DROP INDEX CONCURRENTLY IF EXISTS public.guild_war_battles_attacker_units_gin;

DO $verify$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*)::integer INTO leftover
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'i'
    AND c.relname IN (
      'idx_eot_gr_hit_comparison_probe_v2',
      'captured_replay_eot_started_match',
      'guild_war_battles_defender_units_gin',
      'guild_war_battles_attacker_units_gin'
    );

  IF leftover <> 0 THEN
    RAISE EXCEPTION '% target indexes still present after the drop', leftover;
  END IF;

  -- Positive control: the index PS-90 pulled from this migration must SURVIVE.
  -- Without it a file that dropped nothing at all would still report success.
  IF to_regclass('public.idx_player_achievements_unlocked_at') IS NULL THEN
    RAISE EXCEPTION
      'idx_player_achievements_unlocked_at was removed; it is deferred to PS-111 and must still exist';
  END IF;
END;
$verify$;

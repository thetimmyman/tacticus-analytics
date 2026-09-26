-- Drop three indexes whose only scans came from one audit probe; definitions are
-- in the clean baseline.
-- target-db: general
-- No transaction: DROP INDEX CONCURRENTLY cannot run in one.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_guild_war_battles_attacker_lineup;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_guild_war_battles_defender_lineup;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_player_achievements_unlocked_at;

-- The IN list must match the DROP list exactly, and the kept index must exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN ('idx_guild_war_battles_attacker_lineup',
                         'idx_guild_war_battles_defender_lineup',
                         'idx_player_achievements_unlocked_at')
  ) THEN
    RAISE EXCEPTION 'PS-111 verify: a dropped index still exists';
  END IF;
  IF to_regclass('public.idx_player_achievements_key') IS NULL THEN
    RAISE EXCEPTION 'PS-111 verify: kept index idx_player_achievements_key is missing';
  END IF;
END $$;

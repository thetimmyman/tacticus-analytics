-- Covering index for get_votlw_guild_season_first_battle: its unbounded
-- season_num scan otherwise needs heap access per row; all three referenced
-- columns are here, so a vacuumed table answers it index-only instead.
-- Plain CREATE INDEX (CONCURRENTLY cannot run in a migration's transaction)
-- with IF NOT EXISTS: this already exists in production, created
-- CONCURRENTLY out of band, so here it is a no-op matching prod's schema.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_eot_gr_data_guild_season_first_battle
  ON public."EOT_GR_data" ("Guild", season_num, (COALESCE("completedOn", "startedOn")));

COMMIT;

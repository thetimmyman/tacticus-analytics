-- Index EOT_GR_data for queue_token_burn_notifications()'s per-guild latest-season
-- lookup, which sorted ~15k rows per guild.
-- target-db: general
-- No transaction: CONCURRENTLY cannot run in one, and a plain build blocks writes.

-- A failed CONCURRENTLY build leaves an INVALID index IF NOT EXISTS would skip;
-- refuse over one and require a valid result.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'idx_eot_gr_data_guild_latest_raid'
               AND NOT i.indisvalid) THEN
    RAISE EXCEPTION 'PS-278: idx_eot_gr_data_guild_latest_raid exists but is INVALID (a previous concurrent build failed); run DROP INDEX CONCURRENTLY public.idx_eot_gr_data_guild_latest_raid and re-apply';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eot_gr_data_guild_latest_raid
  ON public."EOT_GR_data"
  USING btree (
    "Guild",
    "timestamp" DESC NULLS LAST,
    "startedOn" DESC NULLS LAST
  )
  INCLUDE ("Season");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'idx_eot_gr_data_guild_latest_raid'
                   AND i.indisvalid AND i.indisready) THEN
    RAISE EXCEPTION 'PS-278 verify: idx_eot_gr_data_guild_latest_raid is missing or not valid after the build';
  END IF;
END $$;

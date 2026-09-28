-- One row per guild with tier >= 4 data in a season, aggregated server-side
-- so calculate-votlw's manual all-guild path avoids config.toml's max_rows
-- (10000) truncating a plain per-row select, the same reason
-- get_votlw_guild_season_first_battle exists for the scheduled path.
BEGIN;

CREATE FUNCTION public.get_votlw_guilds_for_season(p_season text)
    RETURNS TABLE(guild_code text)
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT "Guild"
  FROM public."EOT_GR_data"
  WHERE "Season" = p_season
    AND tier >= 4
    AND "Guild" NOT IN ('TEST', 'EOT', 'TBD')
  GROUP BY "Guild";
$$;

ALTER FUNCTION public.get_votlw_guilds_for_season(p_season text) OWNER TO postgres;

-- Internal to calculate-votlw's service-role client only, matching
-- get_votlw_guild_season_first_battle's grant.
REVOKE ALL ON FUNCTION public.get_votlw_guilds_for_season(p_season text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_votlw_guilds_for_season(p_season text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';


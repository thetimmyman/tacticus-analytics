-- One row per (guild, season) with its earliest battle, aggregated
-- server-side so calculate-votlw's scheduled run avoids config.toml's
-- max_rows (10000) truncating a plain per-row select. No tier filter: this
-- only detects a guild moved into a season, which tier >= 4 would miss for a
-- guild that later drops below Legendary/Mythic; the caller still requires
-- actual tier >= 4 data for the season it scores.
CREATE FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer)
    RETURNS TABLE(guild_code text, season integer, first_battle timestamptz)
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT "Guild", season_num, MIN(COALESCE("completedOn", "startedOn"))
  FROM public."EOT_GR_data"
  WHERE season_num >= p_min_season
    AND "Guild" NOT IN ('TEST', 'EOT', 'TBD')
  GROUP BY "Guild", season_num;
$$;

ALTER FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer) OWNER TO postgres;

-- Internal to calculate-votlw's service-role client only; unlike the
-- season-lookup RPCs this has no end-user surface to justify anon/authenticated access.
REVOKE ALL ON FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer) TO service_role;

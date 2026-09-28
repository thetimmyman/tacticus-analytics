-- calculate-votlw's scheduled run needs one row per (guild, season) with the
-- season's earliest battle time, to gate scoring on a grace window. A plain
-- PostgREST select of raw EOT_GR_data rows hits config.toml's max_rows (10000)
-- long before covering every guild across a season, silently truncating.
-- Aggregating server-side keeps the response near guild-count size.
CREATE FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer)
    RETURNS TABLE(guild_code text, season integer, first_battle timestamptz)
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT "Guild", season_num, MIN(COALESCE("completedOn", "startedOn"))
  FROM public."EOT_GR_data"
  WHERE tier >= 4
    AND season_num >= p_min_season
    AND "Guild" NOT IN ('TEST', 'EOT', 'TBD')
  GROUP BY "Guild", season_num;
$$;

ALTER FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer) OWNER TO postgres;

-- Internal to calculate-votlw's service-role client only; unlike the
-- season-lookup RPCs this has no end-user surface to justify anon/authenticated access.
REVOKE ALL ON FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_votlw_guild_season_first_battle(p_min_season integer) TO service_role;

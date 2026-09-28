-- Aggregates a cluster/season's Discord summary stats server-side, mirroring
-- detect-season-end's isMeaningfulBattleRow classification. A plain select
-- of raw EOT_GR_data rows is capped by config.toml's max_rows (10000), which
-- would silently truncate the totals, player/boss counts and top performer
-- for any cluster-season above that size and then post and mark it sent.
BEGIN;

CREATE FUNCTION public.get_season_summary_stats(p_cluster_code text, p_season text)
    RETURNS TABLE(
      total_damage bigint,
      total_battles integer,
      active_players integer,
      bosses_defeated integer,
      avg_damage bigint,
      top_performer text,
      top_performer_damage bigint
    )
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH rows AS (
    SELECT
      "displayName",
      COALESCE("damageDealt", 0) AS damage_dealt,
      COALESCE(type, 'Unknown') AS boss_type,
      COALESCE("encounterIndex", 0) AS encounter_index,
      COALESCE("damageType", 'Battle') AS damage_type,
      "remainingHp",
      "maxHp"
    FROM public."EOT_GR_data"
    WHERE cluster_code = p_cluster_code
      AND "Season" = p_season
  ),
  player_totals AS (
    SELECT "displayName", SUM(damage_dealt) AS total
    FROM rows
    GROUP BY "displayName"
  ),
  -- Same rule as isMeaningfulBattleRow (damage-classification.ts): Battle
  -- rows with positive damage that are not a sweep (remainingHp = 0, a real
  -- maxHp, and damage under that max -- a one-shot has damage >= maxHp).
  meaningful AS (
    SELECT damage_dealt
    FROM rows
    WHERE damage_type = 'Battle'
      AND damage_dealt > 0
      AND NOT (
        COALESCE("remainingHp", -1) = 0
        AND COALESCE("maxHp", 0) > 0
        AND damage_dealt < "maxHp"
      )
  ),
  top AS (
    SELECT "displayName", total
    FROM player_totals
    ORDER BY total DESC
    LIMIT 1
  )
  -- No FROM clause: every column is an independent scalar subquery, so this
  -- always returns exactly one row, even over an empty cluster/season.
  SELECT
    COALESCE((SELECT SUM(damage_dealt) FROM rows), 0),
    (SELECT COUNT(*) FROM rows)::integer,
    (SELECT COUNT(DISTINCT "displayName") FROM rows)::integer,
    (SELECT COUNT(DISTINCT boss_type || '_' || encounter_index) FROM rows)::integer,
    COALESCE((SELECT ROUND(AVG(damage_dealt)) FROM meaningful), 0)::bigint,
    COALESCE((SELECT "displayName" FROM top), 'N/A'),
    COALESCE((SELECT total FROM top), 0);
$$;

ALTER FUNCTION public.get_season_summary_stats(text, text) OWNER TO postgres;

-- Internal to detect-season-end's service-role client only.
REVOKE ALL ON FUNCTION public.get_season_summary_stats(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_summary_stats(text, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Hash the account-UUID key in cluster leaderboard output; clients use it only as an
-- opaque grouping key, so the same md5() in both functions keeps joins working.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_cluster_overall_leaderboard(p_season text, p_cluster_code text DEFAULT NULL::text)
 RETURNS TABLE(stable_key text, display_name text, guild text, user_id text, total_damage bigint, battle_count integer, avg_damage bigint, bombs_used integer, bosses_killed integer, all_battle_count integer, all_bosses_killed integer, percent_vs_cluster numeric, current_rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cluster_code TEXT;
  v_guild_code TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF p_cluster_code IS NOT NULL THEN
    v_cluster_code := p_cluster_code;
  ELSE
    SELECT gc.cluster_code, pm.guild_code
    INTO v_cluster_code, v_guild_code
    FROM player_mapping pm
    JOIN guild_config gc ON gc.guild_code = pm.guild_code
    WHERE pm.user_id = v_user_id
      AND pm.is_current = true
    LIMIT 1;
  END IF;

  IF v_cluster_code IS NULL AND v_guild_code IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cluster_guilds AS (
    SELECT gc.guild_code
    FROM guild_config gc
    WHERE (v_cluster_code IS NOT NULL AND gc.cluster_code = v_cluster_code)
       OR (v_cluster_code IS NULL AND v_guild_code IS NOT NULL AND gc.guild_code = v_guild_code)
  ),
  -- Boss averages are sweep-free (this is correct - baseline should exclude sweeps)
  boss_averages AS (
    SELECT
      ab."Name" || '_' || ab.rarity || '_' || ab.set AS boss_key,
      AVG(ab."damageDealt") AS cluster_avg
    FROM "EOT_GR_data" ab
    WHERE ab."Season" = p_season
      AND ab."Guild" IN (SELECT cg.guild_code FROM cluster_guilds cg)
      AND ab."damageType" = 'Battle'
      AND ab.rarity IN ('Legendary', 'Mythic')
      AND ab."damageDealt" > 0
      AND NOT (ab."remainingHp" = 0 AND ab."maxHp" > 0 AND ab."damageDealt" < ab."maxHp")
    GROUP BY ab."Name", ab.rarity, ab.set
  ),
  -- Player boss stats for performance calculation (sweeps excluded from avg, included via qualifying exception)
  player_boss_stats AS (
    SELECT
      COALESCE(ab."userId", ab."Guild" || '::' || LOWER(TRIM(ab."displayName"))) AS stable_key,
      ab."displayName",
      ab."Guild",
      ab."userId",
      ab."Name" || '_' || ab.rarity || '_' || ab.set AS boss_key,
      SUM(ab."damageDealt") FILTER (WHERE NOT (ab."remainingHp" = 0 AND ab."maxHp" > 0 AND ab."damageDealt" < ab."maxHp")) AS non_sweep_damage,
      COUNT(*) FILTER (WHERE NOT (ab."remainingHp" = 0 AND ab."maxHp" > 0 AND ab."damageDealt" < ab."maxHp")) AS non_sweep_count,
      AVG(ab."damageDealt") FILTER (WHERE NOT (ab."remainingHp" = 0 AND ab."maxHp" > 0 AND ab."damageDealt" < ab."maxHp")) AS player_avg,
      array_agg(ab."damageDealt"::numeric) FILTER (WHERE ab."remainingHp" = 0 AND ab."maxHp" > 0 AND ab."damageDealt" < ab."maxHp") AS sweep_damages
    FROM "EOT_GR_data" ab
    WHERE ab."Season" = p_season
      AND ab."Guild" IN (SELECT cg.guild_code FROM cluster_guilds cg)
      AND ab."damageType" = 'Battle'
      AND ab.rarity IN ('Legendary', 'Mythic')
      AND ab."damageDealt" > 0
    GROUP BY
      COALESCE(ab."userId", ab."Guild" || '::' || LOWER(TRIM(ab."displayName"))),
      ab."displayName",
      ab."Guild",
      ab."userId",
      ab."Name",
      ab.rarity,
      ab.set
  ),
  -- Performance calculation (sweeps included via qualifying exception logic)
  player_weighted_performance AS (
    SELECT
      pbs.stable_key,
      pbs."displayName",
      pbs."Guild",
      pbs."userId",
      SUM(
        calc_boss_performance_pct(pbs.non_sweep_damage, pbs.non_sweep_count, pbs.sweep_damages, ba.cluster_avg::numeric, pbs.player_avg::numeric)
        * calc_effective_battle_count(pbs.non_sweep_count, pbs.sweep_damages, ba.cluster_avg::numeric, pbs.player_avg::numeric)
      ) / NULLIF(SUM(
        calc_effective_battle_count(pbs.non_sweep_count, pbs.sweep_damages, ba.cluster_avg::numeric, pbs.player_avg::numeric)
      ), 0) AS percent_vs_cluster,
      SUM(
        calc_effective_battle_count(pbs.non_sweep_count, pbs.sweep_damages, ba.cluster_avg::numeric, pbs.player_avg::numeric)
      )::INT AS total_battles
    FROM player_boss_stats pbs
    JOIN boss_averages ba ON ba.boss_key = pbs.boss_key
    GROUP BY pbs.stable_key, pbs."displayName", pbs."Guild", pbs."userId"
  ),
  -- FIX: total_damage now INCLUDES sweeps (removed sweep exclusion filter)
  player_totals AS (
    SELECT
      COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName"))) AS stable_key,
      SUM(d."damageDealt") AS total_damage,
      COUNT(*) FILTER (WHERE d."damageType" = 'Battle') AS battle_count,
      COUNT(*) FILTER (WHERE d."damageType" = 'Bomb') AS bombs_used,
      COUNT(*) FILTER (WHERE d."remainingHp" = 0) AS bosses_killed
    FROM "EOT_GR_data" d
    WHERE d."Season" = p_season
      AND d."Guild" IN (SELECT cg.guild_code FROM cluster_guilds cg)
      AND d.rarity IN ('Legendary', 'Mythic')
      AND d."damageDealt" > 0
      -- FIX: Removed sweep exclusion to include all damage in total
    GROUP BY COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName")))
  ),
  -- all_battle_count already includes sweeps (correct)
  player_all_counts AS (
    SELECT
      COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName"))) AS stable_key,
      COUNT(*) FILTER (WHERE d."damageType" = 'Battle') AS all_battle_count,
      COUNT(*) FILTER (WHERE d."remainingHp" = 0) AS all_bosses_killed
    FROM "EOT_GR_data" d
    WHERE d."Season" = p_season
      AND d."Guild" IN (SELECT cg.guild_code FROM cluster_guilds cg)
      AND d."damageDealt" > 0
    GROUP BY COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName")))
  ),
  ranked_players AS (
    SELECT
      md5(pwp.stable_key) AS stable_key,
      pwp."displayName" AS display_name,
      pwp."Guild" AS guild,
      md5(pwp."userId") AS user_id,
      COALESCE(pt.total_damage, 0)::BIGINT AS total_damage,
      COALESCE(pt.battle_count, 0)::INT AS battle_count,
      CASE WHEN COALESCE(pt.battle_count, 0) > 0
           THEN (COALESCE(pt.total_damage, 0) / pt.battle_count)::BIGINT
           ELSE 0 END AS avg_damage,
      COALESCE(pt.bombs_used, 0)::INT AS bombs_used,
      COALESCE(pt.bosses_killed, 0)::INT AS bosses_killed,
      COALESCE(pac.all_battle_count, 0)::INT AS all_battle_count,
      COALESCE(pac.all_bosses_killed, 0)::INT AS all_bosses_killed,
      ROUND(pwp.percent_vs_cluster, 2) AS percent_vs_cluster,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN pwp.total_battles > 0 THEN 0 ELSE 1 END,
          pwp.percent_vs_cluster DESC NULLS LAST,
          pwp."displayName"
      )::INT AS current_rank
    FROM player_weighted_performance pwp
    LEFT JOIN player_totals pt ON pt.stable_key = pwp.stable_key
    LEFT JOIN player_all_counts pac ON pac.stable_key = pwp.stable_key
  )
  SELECT * FROM ranked_players
  ORDER BY current_rank;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cluster_historical_rankings(p_seasons text[], p_cluster_code text DEFAULT NULL::text)
 RETURNS TABLE(season text, stable_key text, display_name text, guild text, percent_vs_cluster numeric, season_rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cluster_code TEXT;
  v_guild_code TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF p_cluster_code IS NOT NULL THEN
    v_cluster_code := p_cluster_code;
  ELSE
    SELECT gc.cluster_code, pm.guild_code
    INTO v_cluster_code, v_guild_code
    FROM player_mapping pm
    JOIN guild_config gc ON gc.guild_code = pm.guild_code
    WHERE pm.user_id = v_user_id
      AND pm.is_current = true
    LIMIT 1;
  END IF;

  IF v_cluster_code IS NULL THEN
    v_cluster_code := v_guild_code;
  END IF;

  IF v_cluster_code IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    mv.season,
    md5(mv.stable_key) AS stable_key,
    mv.display_name,
    mv.guild,
    mv.percent_vs_cluster,
    mv.season_rank
  FROM mv_cluster_season_rankings mv
  WHERE mv.cluster_code = v_cluster_code
    AND mv.season = ANY(p_seasons)
  ORDER BY mv.season DESC, mv.season_rank;
END;
$function$;

COMMIT;

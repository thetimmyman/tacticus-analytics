-- Order text "Season" numerically in seven functions; uncast, 99 sorts above 108.
-- target-db: general
-- mv_season_summary has the same defect but is left for its planned drop.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_distinct_seasons()
 RETURNS TABLE(season text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT s."Season"
  FROM ( SELECT DISTINCT "EOT_GR_data"."Season"
           FROM "EOT_GR_data"
          WHERE "EOT_GR_data"."Season" IS NOT NULL) s
  ORDER BY (s."Season")::numeric DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_guild_boss_averages_batch(p_guild_code text, p_seasons text[])
 RETURNS TABLE(season text, boss_key text, avg_damage numeric, total_damage numeric, battle_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    e."Season"::text AS season,
    e."Name" || '_' || e.rarity || '_' || e.set AS boss_key,
    ROUND(AVG(e."damageDealt")::numeric, 2) AS avg_damage,
    ROUND(SUM(e."damageDealt")::numeric, 2) AS total_damage,
    COUNT(*)::integer AS battle_count
  FROM "EOT_GR_data" e
  WHERE e."Guild" = p_guild_code
    AND e."Season" = ANY(p_seasons)
    AND e."damageType" = 'Battle'
    AND e.rarity IN ('Legendary', 'Mythic')
    AND e."damageDealt" > 0
    AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
  GROUP BY e."Season", e."Name", e.rarity, e.set
  ORDER BY (e."Season")::numeric DESC, total_damage DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_guild_player_scores_batch(p_guild_code text, p_seasons text[])
 RETURNS TABLE(season text, user_id text, weighted_vs_guild numeric, battle_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guild_averages AS (
    SELECT
      e."Season",
      e."Name" || '_' || e.rarity || '_' || e.set AS boss_key,
      AVG(e."damageDealt") AS avg_damage
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY e."Season", e."Name", e.rarity, e.set
  ),
  player_boss_stats AS (
    SELECT
      e."Season",
      e."userId",
      e."Name" || '_' || e.rarity || '_' || e.set AS boss_key,
      AVG(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS player_avg,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS battle_count,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS non_sweep_damage,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) AS sweep_damages
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
    GROUP BY e."Season", e."userId", e."Name", e.rarity, e.set
  ),
  -- Weighted performance using shared functions
  player_weighted AS (
    SELECT
      pbs."Season",
      pbs."userId",
      SUM(
        calc_boss_performance_pct(pbs.non_sweep_damage, pbs.battle_count, pbs.sweep_damages, ga.avg_damage::numeric, pbs.player_avg::numeric)
        * calc_effective_battle_count(pbs.battle_count, pbs.sweep_damages, ga.avg_damage::numeric, pbs.player_avg::numeric)
      ) / NULLIF(SUM(
        calc_effective_battle_count(pbs.battle_count, pbs.sweep_damages, ga.avg_damage::numeric, pbs.player_avg::numeric)
      ), 0) AS weighted_vs_guild,
      -- total_battles: count all effective battles (LEFT JOIN safe -- returns 0 for NULL avg)
      SUM(COALESCE(pbs.battle_count, 0) + COALESCE(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg::numeric, ga.avg_damage::numeric)), 0))::integer AS total_battles
    FROM player_boss_stats pbs
    LEFT JOIN guild_averages ga ON ga."Season" = pbs."Season" AND ga.boss_key = pbs.boss_key
    GROUP BY pbs."Season", pbs."userId"
  )
  SELECT
    pw."Season"::text AS season,
    pw."userId" AS user_id,
    pw.weighted_vs_guild,
    pw.total_battles AS battle_count
  FROM player_weighted pw
  WHERE pw.weighted_vs_guild IS NOT NULL
  ORDER BY (pw."Season")::numeric DESC, pw.weighted_vs_guild DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_guild_trends_batch(p_guild_code text, p_seasons text[])
 RETURNS TABLE(season text, total_damage numeric, total_battles integer, max_hit bigint, boss_kills integer, active_players integer, guild_member_count integer, participation_rate numeric, avg_damage_per_token numeric, vs_cluster_percent numeric, guild_rank_in_cluster integer, total_guilds_in_cluster integer, reliability_score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guild_cluster AS (
    SELECT cluster_code
    FROM guild_config
    WHERE guild_code = p_guild_code
    LIMIT 1
  ),
  cluster_guilds AS (
    SELECT guild_code
    FROM guild_config
    WHERE cluster_code = (SELECT cluster_code FROM guild_cluster)
      AND (SELECT cluster_code FROM guild_cluster) IS NOT NULL
  ),
  -- Unfiltered token counts: ALL battle tokens (no damage filter)
  all_token_counts AS (
    SELECT
      e."Season",
      COUNT(*)::integer AS token_count,
      COUNT(DISTINCT e."userId")::integer AS active_players
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
    GROUP BY e."Season"
  ),
  -- Filtered battle data for damage metrics + cluster comparison
  battle_data AS (
    SELECT
      e."Season",
      e."userId",
      e."damageDealt",
      e."remainingHp",
      e."Name" AS boss_name,
      e."encounterId"
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND e."encounterId" = 0
  ),
  season_agg AS (
    SELECT
      bd."Season",
      SUM(bd."damageDealt")::numeric AS total_damage,
      COUNT(*)::integer AS filtered_battles,
      MAX(bd."damageDealt") AS max_hit,
      COUNT(*) FILTER (WHERE bd."remainingHp" = 0)::integer AS boss_kills
    FROM battle_data bd
    GROUP BY bd."Season"
  ),
  member_count AS (
    SELECT COUNT(*)::integer AS cnt
    FROM player_mapping
    WHERE guild_code = p_guild_code
      AND is_current = true
  ),
  guild_boss_avgs AS (
    SELECT
      bd."Season",
      bd.boss_name,
      AVG(bd."damageDealt")::numeric AS guild_avg,
      COUNT(*)::integer AS battle_count
    FROM battle_data bd
    GROUP BY bd."Season", bd.boss_name
  ),
  cluster_boss_avgs AS (
    SELECT
      e."Season",
      e."Name" AS boss_name,
      AVG(e."damageDealt")::numeric AS cluster_avg
    FROM "EOT_GR_data" e
    WHERE e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND e."encounterId" = 0
      AND (
        e."Guild" IN (SELECT guild_code FROM cluster_guilds)
        OR e.cluster_code = (SELECT cluster_code FROM guild_cluster)
      )
      AND (SELECT cluster_code FROM guild_cluster) IS NOT NULL
    GROUP BY e."Season", e."Name"
  ),
  guild_vs_cluster AS (
    SELECT
      g."Season",
      CASE
        WHEN SUM(g.battle_count) > 0 THEN
          ROUND(
            SUM(
              CASE WHEN c.cluster_avg > 0
                THEN ((g.guild_avg / c.cluster_avg) - 1) * 100 * g.battle_count
                ELSE 0
              END
            ) / SUM(g.battle_count),
          1)
        ELSE NULL
      END AS vs_cluster_pct
    FROM guild_boss_avgs g
    LEFT JOIN cluster_boss_avgs c
      ON g."Season" = c."Season" AND g.boss_name = c.boss_name
    GROUP BY g."Season"
  ),
  guild_reliability AS (
    SELECT
      g."Season",
      CASE
        WHEN COUNT(g.guild_avg) >= 2 AND AVG(g.guild_avg) > 0 THEN
          ROUND(GREATEST(0, 100 - (STDDEV_POP(g.guild_avg) / AVG(g.guild_avg)) * 100), 1)
        ELSE NULL
      END AS reliability
    FROM guild_boss_avgs g
    GROUP BY g."Season"
  ),
  -- Total damage per guild in the cluster: ALL rows, no damageType /
  -- rarity / encounterId filter, so it matches the in-game leaderboard
  -- and cluster-analytics "Guild Performance Metrics" (totalDamage).
  cluster_guild_totals AS (
    SELECT
      e."Season",
      e."Guild" AS guild_code,
      SUM(e."damageDealt")::numeric AS total_damage
    FROM "EOT_GR_data" e
    WHERE e."Season" = ANY(p_seasons)
      AND (
        e."Guild" IN (SELECT guild_code FROM cluster_guilds)
        OR e.cluster_code = (SELECT cluster_code FROM guild_cluster)
      )
      AND (SELECT cluster_code FROM guild_cluster) IS NOT NULL
    GROUP BY e."Season", e."Guild"
  ),
  guild_rankings AS (
    SELECT
      cgt."Season",
      cgt.guild_code,
      RANK() OVER (PARTITION BY cgt."Season" ORDER BY cgt.total_damage DESC)::integer AS rank_in_cluster,
      COUNT(*) OVER (PARTITION BY cgt."Season")::integer AS total_guilds
    FROM cluster_guild_totals cgt
    WHERE cgt.total_damage IS NOT NULL
  )
  SELECT
    sa."Season"::text AS season,
    sa.total_damage,
    atc.token_count AS total_battles,
    sa.max_hit,
    sa.boss_kills,
    atc.active_players,
    mc.cnt AS guild_member_count,
    CASE WHEN mc.cnt > 0
      THEN LEAST(100.0, ROUND((atc.active_players::numeric / mc.cnt) * 100, 1))
      ELSE NULL
    END AS participation_rate,
    CASE WHEN sa.filtered_battles > 0
      THEN ROUND(sa.total_damage / sa.filtered_battles, 2)
      ELSE NULL
    END AS avg_damage_per_token,
    gvc.vs_cluster_pct AS vs_cluster_percent,
    gr.rank_in_cluster AS guild_rank_in_cluster,
    gr.total_guilds AS total_guilds_in_cluster,
    grel.reliability AS reliability_score
  FROM season_agg sa
  JOIN all_token_counts atc ON sa."Season" = atc."Season"
  CROSS JOIN member_count mc
  LEFT JOIN guild_vs_cluster gvc ON sa."Season" = gvc."Season"
  LEFT JOIN guild_rankings gr ON sa."Season" = gr."Season" AND gr.guild_code = p_guild_code
  LEFT JOIN guild_reliability grel ON sa."Season" = grel."Season"
  ORDER BY (sa."Season")::numeric DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_player_five_season_averages(p_guild_code text, p_current_season integer, p_tier_min integer DEFAULT NULL::integer, p_tier_max integer DEFAULT NULL::integer)
 RETURNS TABLE(player_id text, player_name text, boss_name text, "Season" text, avg_damage numeric, battle_count bigint, rarity text, tier integer, encounter_id integer, vs_guild_pct numeric, vs_cluster_pct numeric, is_current_member boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_loop_number integer;
  v_cluster_code text;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.player_mapping pm
       WHERE pm.user_id = auth.uid()
         AND pm.guild_code = p_guild_code
         AND COALESCE(pm.is_current, false) = true
     ) THEN
    RAISE EXCEPTION 'Not authorized for guild %', p_guild_code
      USING ERRCODE = '42501';
  END IF;

  SELECT gc.cluster_code INTO v_cluster_code
  FROM public.guild_config gc
  WHERE gc.guild_code = p_guild_code
    AND COALESCE(gc.enabled, true) = true;

  IF p_tier_min IS NOT NULL AND p_tier_max IS NOT NULL AND p_tier_min > p_tier_max THEN
    RAISE EXCEPTION 'p_tier_min must be less than or equal to p_tier_max';
  END IF;

  IF p_tier_min IS NOT NULL
     AND p_tier_max IS NOT NULL
     AND p_tier_min >= 4
     AND p_tier_max = p_tier_min + 1
     AND MOD(p_tier_min, 2) = 0 THEN
    v_loop_number := (p_tier_min - 4) / 2;
  END IF;

  RETURN QUERY
  WITH season_range AS (
    SELECT generate_series(
      GREATEST(p_current_season - 5, 1),
      p_current_season - 1
    )::text AS season_num
  ),
  player_current_names AS (
    SELECT
      pm.player_id,
      pm.display_name
    FROM public.player_mapping pm
    WHERE pm.guild_code = p_guild_code
      AND pm.is_current = true
  ),
  player_membership AS (
    SELECT
      pm.player_id,
      BOOL_OR(COALESCE(pm.is_current, false)) AS is_current_member
    FROM public.player_mapping pm
    WHERE pm.guild_code = p_guild_code
    GROUP BY pm.player_id
  ),
  player_boss_stats AS (
    SELECT
      e."userId" AS player_id,
      COALESCE(pcn.display_name, e."displayName", 'Unknown Player') AS player_name,
      e."Name" AS boss_name,
      e."Season",
      e."rarity",
      e."tier",
      CASE
        WHEN e."encounterId"::text ~ '^\d+$' THEN e."encounterId"::integer
        ELSE 0
      END AS encounter_id,
      COALESCE(pm_status.is_current_member, false) AS is_current_member,
      AVG(e."damageDealt") AS avg_damage,
      COUNT(*) AS battle_count
    FROM public."EOT_GR_data" e
    JOIN season_range sr ON e."Season" = sr.season_num
    LEFT JOIN player_current_names pcn ON pcn.player_id = e."userId"
    LEFT JOIN player_membership pm_status ON pm_status.player_id = e."userId"
    WHERE e."Guild" = p_guild_code
      AND e."damageType" = 'Battle'
      AND e."damageDealt" > 0
      AND e."rarity" IN ('Legendary', 'Mythic')
      AND e."userId" IS NOT NULL
      AND (
        v_loop_number IS NULL
        OR COALESCE(
          e."loopIndex"::integer,
          CASE
            WHEN e."tier" IS NULL THEN NULL
            WHEN e."tier" >= 4 THEN ((e."tier"::integer - 4) / 2)
            ELSE 0
          END
        ) = v_loop_number
      )
      AND (p_tier_min IS NULL OR e."tier" >= p_tier_min)
      AND (p_tier_max IS NULL OR e."tier" <= p_tier_max)
    GROUP BY
      e."userId",
      player_name,
      e."Name",
      e."Season",
      e."rarity",
      e."tier",
      encounter_id,
      pm_status.is_current_member
  ),
  guild_boss_averages AS (
    SELECT
      pbs_g.boss_name,
      pbs_g."Season",
      pbs_g.rarity,
      pbs_g.tier,
      pbs_g.encounter_id,
      AVG(pbs_g.avg_damage) AS guild_avg
    FROM player_boss_stats pbs_g
    GROUP BY
      pbs_g.boss_name,
      pbs_g."Season",
      pbs_g.rarity,
      pbs_g.tier,
      pbs_g.encounter_id
  ),
  cluster_boss_averages AS (
    SELECT
      e."Name" AS boss_name,
      e."Season",
      e."rarity",
      e."tier",
      CASE
        WHEN e."encounterId"::text ~ '^\d+$' THEN e."encounterId"::integer
        ELSE 0
      END AS encounter_id,
      AVG(e."damageDealt") AS cluster_avg
    FROM public."EOT_GR_data" e
    JOIN season_range sr ON e."Season" = sr.season_num
    JOIN public.guild_config gc ON e."Guild" = gc.guild_code
    WHERE COALESCE(gc.enabled, true) = true
      AND (
        (v_cluster_code IS NULL AND e."Guild" = p_guild_code)
        OR gc.cluster_code = v_cluster_code
      )
      AND e."damageType" = 'Battle'
      AND e."damageDealt" > 0
      AND e."rarity" IN ('Legendary', 'Mythic')
      AND (
        v_loop_number IS NULL
        OR COALESCE(
          e."loopIndex"::integer,
          CASE
            WHEN e."tier" IS NULL THEN NULL
            WHEN e."tier" >= 4 THEN ((e."tier"::integer - 4) / 2)
            ELSE 0
          END
        ) = v_loop_number
      )
      AND (p_tier_min IS NULL OR e."tier" >= p_tier_min)
      AND (p_tier_max IS NULL OR e."tier" <= p_tier_max)
    GROUP BY e."Name", e."Season", e."rarity", e."tier", encounter_id
  )
  SELECT
    pbs.player_id::text,
    pbs.player_name::text AS player_name,
    pbs.boss_name::text AS boss_name,
    pbs."Season"::text AS "Season",
    pbs.avg_damage AS avg_damage,
    pbs.battle_count AS battle_count,
    pbs.rarity::text AS rarity,
    pbs.tier::integer AS tier,
    pbs.encounter_id::integer AS encounter_id,
    ROUND(((pbs.avg_damage - gba.guild_avg) / NULLIF(gba.guild_avg, 0) * 100)::numeric, 1)
      AS vs_guild_pct,
    ROUND(((pbs.avg_damage - cba.cluster_avg) / NULLIF(cba.cluster_avg, 0) * 100)::numeric, 1)
      AS vs_cluster_pct,
    pbs.is_current_member
  FROM player_boss_stats pbs
  LEFT JOIN guild_boss_averages gba ON (
    pbs.boss_name = gba.boss_name
    AND pbs."Season" = gba."Season"
    AND pbs.rarity = gba.rarity
    AND pbs.tier = gba.tier
    AND pbs.encounter_id = gba.encounter_id
  )
  LEFT JOIN cluster_boss_averages cba ON (
    pbs.boss_name = cba.boss_name
    AND pbs."Season" = cba."Season"
    AND pbs.rarity = cba.rarity
    AND pbs.tier = cba.tier
    AND pbs.encounter_id = cba.encounter_id
  )
  ORDER BY (pbs."Season")::numeric DESC, pbs.boss_name, pbs.player_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_seasons_for_guild(p_guild text)
 RETURNS TABLE(season text, record_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    "Season" as season,
    COUNT(*) as record_count
  FROM "EOT_GR_data"
  WHERE "Guild" = p_guild
  GROUP BY "Season"
  ORDER BY ("Season")::numeric DESC;
$function$;

-- A DISTINCT ON tie-break column need not be selected, so only the cast changes.
CREATE OR REPLACE FUNCTION public.backfill_boss_mapping_unit_ids()
 RETURNS TABLE(updated_count integer, boss_types_updated text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_updated int := 0;
  v_boss_types text[] := ARRAY[]::text[];
BEGIN
  UPDATE boss_mapping bm
  SET unit_id = subq.unit_id
  FROM (
    SELECT DISTINCT ON (e."Name", e."encounterId")
      e."Name" as boss_type,
      e."encounterId"::int as encounter_index,
      e."unitId" as unit_id
    FROM "EOT_GR_data" e
    WHERE e."unitId" IS NOT NULL
      AND e."damageType" = 'Battle'
    ORDER BY e."Name", e."encounterId", (e."Season")::numeric DESC
  ) subq
  WHERE bm.boss_type = subq.boss_type
    AND bm.encounter_index = subq.encounter_index
    AND bm.unit_id IS NULL
    AND subq.unit_id IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT array_agg(DISTINCT boss_type) INTO v_boss_types
  FROM boss_mapping
  WHERE unit_id IS NOT NULL;

  RETURN QUERY SELECT v_updated, v_boss_types;
END;
$function$;

DO $verify$
DECLARE
  v_def text;
  v_max_numeric numeric;
  v_top_season text;
  v_prosecdef boolean;
  v_proconfig text[];
  v_fn_acl text[];
  v_expected_fn_acl text[] := ARRAY[
    'authenticated/EXECUTE', 'postgres/EXECUTE', 'service_role/EXECUTE'
  ];
  v_expected_backfill_acl text[] := ARRAY[
    'postgres/EXECUTE', 'service_role/EXECUTE'
  ];
  v_fn_name text;
BEGIN
  -- 1. Each of the seven functions casts ::numeric in its ORDER BY.
  FOR v_def IN
    SELECT pg_get_functiondef(oid)
    FROM pg_proc
    WHERE proname IN (
      'get_distinct_seasons',
      'get_guild_boss_averages_batch',
      'get_guild_player_scores_batch',
      'get_guild_trends_batch',
      'get_player_five_season_averages',
      'get_seasons_for_guild',
      'backfill_boss_mapping_unit_ids'
    )
  LOOP
    IF v_def !~ '"?Season"?\)?::numeric' THEN
      RAISE EXCEPTION 'PS-258 verify: expected a ::numeric ORDER BY cast, none found in: %', v_def;
    END IF;
  END LOOP;

  -- 2. prosecdef / proconfig unchanged from the captured pre-fix values.
  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'get_guild_boss_averages_batch' AND pronargs = 2;
  IF v_prosecdef IS DISTINCT FROM true OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'PS-258 verify: get_guild_boss_averages_batch prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'get_guild_player_scores_batch' AND pronargs = 2;
  IF v_prosecdef IS DISTINCT FROM true OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'PS-258 verify: get_guild_player_scores_batch prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'get_guild_trends_batch';
  IF v_prosecdef IS DISTINCT FROM true OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'PS-258 verify: get_guild_trends_batch prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'get_player_five_season_averages';
  IF v_prosecdef IS DISTINCT FROM false OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'PS-258 verify: get_player_five_season_averages prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'get_distinct_seasons';
  IF v_prosecdef IS DISTINCT FROM false OR v_proconfig IS NOT NULL THEN
    RAISE EXCEPTION 'PS-258 verify: get_distinct_seasons prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'get_seasons_for_guild';
  IF v_prosecdef IS DISTINCT FROM false OR v_proconfig IS NOT NULL THEN
    RAISE EXCEPTION 'PS-258 verify: get_seasons_for_guild prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  SELECT prosecdef, proconfig INTO v_prosecdef, v_proconfig
    FROM pg_proc WHERE proname = 'backfill_boss_mapping_unit_ids';
  IF v_prosecdef IS DISTINCT FROM true OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public, auth'] THEN
    RAISE EXCEPTION 'PS-258 verify: backfill_boss_mapping_unit_ids prosecdef/proconfig changed (prosecdef=%, proconfig=%)', v_prosecdef, v_proconfig;
  END IF;

  -- 3. proacl unchanged, function by function, against the exact live
  --    capture (postgres/authenticated/service_role EXECUTE only -- anon
  --    held none before and must hold none now). backfill_boss_mapping_unit_ids
  --    is checked separately below: it never granted authenticated EXECUTE.
  FOR v_fn_name IN
    SELECT unnest(ARRAY[
      'get_distinct_seasons', 'get_guild_boss_averages_batch',
      'get_guild_player_scores_batch', 'get_guild_trends_batch',
      'get_player_five_season_averages', 'get_seasons_for_guild'
    ])
  LOOP
    SELECT array_agg(entry ORDER BY entry) INTO v_fn_acl
    FROM (
      SELECT DISTINCT (a.grantee::regrole)::text || '/' || a.privilege_type AS entry
      FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.proname = v_fn_name
    ) x;
    IF v_fn_acl IS DISTINCT FROM v_expected_fn_acl THEN
      RAISE EXCEPTION 'PS-258 verify: % proacl changed -- expected %, got %', v_fn_name, v_expected_fn_acl, v_fn_acl;
    END IF;
  END LOOP;

  SELECT array_agg(entry ORDER BY entry) INTO v_fn_acl
  FROM (
    SELECT DISTINCT (a.grantee::regrole)::text || '/' || a.privilege_type AS entry
    FROM pg_proc p, LATERAL aclexplode(p.proacl) a
    WHERE p.proname = 'backfill_boss_mapping_unit_ids'
  ) x;
  IF v_fn_acl IS DISTINCT FROM v_expected_backfill_acl THEN
    RAISE EXCEPTION 'PS-258 verify: backfill_boss_mapping_unit_ids proacl changed -- expected %, got %', v_expected_backfill_acl, v_fn_acl;
  END IF;

  -- 4. get_distinct_seasons() now returns the true max season first.
  SELECT max(("Season")::numeric) INTO v_max_numeric FROM "EOT_GR_data";
  SELECT season INTO v_top_season FROM get_distinct_seasons() LIMIT 1;
  IF v_top_season::numeric IS DISTINCT FROM v_max_numeric THEN
    RAISE EXCEPTION 'PS-258 verify: get_distinct_seasons() first row (%) does not match EOT_GR_data max Season (%)', v_top_season, v_max_numeric;
  END IF;

  RAISE NOTICE 'PS-258 verify: OK -- all seven functions now order "Season" numerically, proacl and SECURITY context unchanged (verified grantee-by-grantee, privilege-by-privilege), get_distinct_seasons() top row (%) matches live max. mv_season_summary is deliberately untouched -- see PS-296.', v_max_numeric;
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- target-db: general
-- Keep cluster leaderboard totals scoped to (player, guild). Rank exactly one
-- row per player per season and cluster: the largest qualifying battle row,
-- breaking ties by performance, guild and display name. Other rows are unranked.
-- Historical rankings return ranked rows only. Preserve the materialized view's
-- owner, grants and existing lookup index, and recreate its unique refresh index.

-- Rollback: re-apply the 20260814190000 function bodies and recreate
-- mv_cluster_season_rankings from 20260813000000 (WITH NO DATA), restore its
-- indexes and the captured grants, then REFRESH. No data rows are rewritten
-- or deleted.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- ---------------------------------------------------------------------------
-- get_cluster_overall_leaderboard: guild-scoped totals + one rank per player
-- ---------------------------------------------------------------------------
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
    -- A player may only view their own cluster's leaderboard; app-admins may view any.
    IF NOT public._pm_caller_is_app_admin() AND NOT EXISTS (
      SELECT 1 FROM player_mapping pm
      JOIN guild_config gc ON gc.guild_code = pm.guild_code
      WHERE pm.user_id = v_user_id AND pm.is_current = true AND gc.cluster_code = p_cluster_code
    ) THEN
      RETURN;
    END IF;
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
  -- total_damage now INCLUDES sweeps and is guild-scoped so a mover's totals
  -- stay with the guild that synced the rows.
  player_totals AS (
    SELECT
      COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName"))) AS stable_key,
      d."Guild" AS guild,
      SUM(d."damageDealt") AS total_damage,
      COUNT(*) FILTER (WHERE d."damageType" = 'Battle') AS battle_count,
      COUNT(*) FILTER (WHERE d."damageType" = 'Bomb') AS bombs_used,
      COUNT(*) FILTER (WHERE d."remainingHp" = 0) AS bosses_killed
    FROM "EOT_GR_data" d
    WHERE d."Season" = p_season
      AND d."Guild" IN (SELECT cg.guild_code FROM cluster_guilds cg)
      AND d.rarity IN ('Legendary', 'Mythic')
      AND d."damageDealt" > 0
    GROUP BY
      COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName"))),
      d."Guild"
  ),
  -- all_battle_count already includes sweeps (correct); guild-scoped too.
  player_all_counts AS (
    SELECT
      COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName"))) AS stable_key,
      d."Guild" AS guild,
      COUNT(*) FILTER (WHERE d."damageType" = 'Battle') AS all_battle_count,
      COUNT(*) FILTER (WHERE d."remainingHp" = 0) AS all_bosses_killed
    FROM "EOT_GR_data" d
    WHERE d."Season" = p_season
      AND d."Guild" IN (SELECT cg.guild_code FROM cluster_guilds cg)
      AND d."damageDealt" > 0
    GROUP BY
      COALESCE(d."userId", d."Guild" || '::' || LOWER(TRIM(d."displayName"))),
      d."Guild"
  ),
  player_primary AS (
    SELECT DISTINCT ON (pwp.stable_key) pwp.*
    FROM player_weighted_performance pwp
    ORDER BY pwp.stable_key, pwp.total_battles DESC,
             pwp.percent_vs_cluster DESC NULLS LAST, pwp."Guild", pwp."displayName"
  ),
  player_rank AS (
    SELECT pp.stable_key, pp."Guild", pp."displayName",
      ROW_NUMBER() OVER (
        ORDER BY CASE WHEN pp.total_battles > 0 THEN 0 ELSE 1 END,
                 pp.percent_vs_cluster DESC NULLS LAST, pp.stable_key
      )::integer AS assigned_rank
    FROM player_primary pp
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
      pr.assigned_rank AS current_rank
    FROM player_weighted_performance pwp
    LEFT JOIN player_totals pt
      ON pt.stable_key = pwp.stable_key AND pt.guild = pwp."Guild"
    LEFT JOIN player_all_counts pac
      ON pac.stable_key = pwp.stable_key AND pac.guild = pwp."Guild"
    LEFT JOIN player_rank pr
      ON pr.stable_key = pwp.stable_key
     AND pr."Guild" = pwp."Guild"
     AND pr."displayName" IS NOT DISTINCT FROM pwp."displayName"
  )
  SELECT * FROM ranked_players
  ORDER BY current_rank NULLS LAST, display_name;
END;
$function$;

-- ---------------------------------------------------------------------------
-- get_cluster_historical_rankings: return only the one ranked row per player
-- per season (the primary guild's), so a mid-season move is no longer ambiguous.
-- ---------------------------------------------------------------------------
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
    -- A player may only view their own cluster's leaderboard; app-admins may view any.
    IF NOT public._pm_caller_is_app_admin() AND NOT EXISTS (
      SELECT 1 FROM player_mapping pm
      JOIN guild_config gc ON gc.guild_code = pm.guild_code
      WHERE pm.user_id = v_user_id AND pm.is_current = true AND gc.cluster_code = p_cluster_code
    ) THEN
      RETURN;
    END IF;
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
    AND mv.season_rank IS NOT NULL
  ORDER BY mv.season DESC, mv.season_rank NULLS LAST;
END;
$function$;

-- ---------------------------------------------------------------------------
-- mv_cluster_season_rankings: same one-rank-per-player-per-season rule.
-- ---------------------------------------------------------------------------
-- Fail explicitly before replacing a view referenced by another relation.
DO $dependencies$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend d
    LEFT JOIN pg_catalog.pg_rewrite r
      ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND r.oid = d.objid
    WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
      AND d.refobjid = 'public.mv_cluster_season_rankings'::regclass
      AND (
        r.ev_class <> d.refobjid
        OR (d.classid = 'pg_catalog.pg_class'::regclass
            AND d.objid <> d.refobjid AND d.deptype = 'n')
      )
  ) THEN
    RAISE EXCEPTION 'Cannot replace mv_cluster_season_rankings: another relation depends on it';
  END IF;
END;
$dependencies$;

CREATE TEMP TABLE cluster_rankings_metadata ON COMMIT DROP AS
SELECT c.relowner AS owner_oid,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_index i
         WHERE i.indexrelid = to_regclass('public.idx_mv_cluster_rankings_lookup')
           AND i.indrelid = c.oid
       ) AS had_lookup_index
FROM pg_catalog.pg_class c
WHERE c.oid = 'public.mv_cluster_season_rankings'::regclass;

CREATE TEMP TABLE cluster_rankings_acl ON COMMIT DROP AS
SELECT a.grantee, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_class c
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
WHERE c.oid = 'public.mv_cluster_season_rankings'::regclass;

DROP MATERIALIZED VIEW public.mv_cluster_season_rankings;

CREATE MATERIALIZED VIEW public.mv_cluster_season_rankings AS
WITH filtered_battles AS (
  SELECT d."Season",
         d.cluster_code,
         COALESCE(d."userId", ((d."Guild" || '::'::text) || lower(TRIM(BOTH FROM d."displayName")))) AS stable_key,
         d."displayName",
         d."Guild",
         d."damageDealt",
         ((d."Name" || '_'::text) || d.rarity) AS boss_key
    FROM public."EOT_GR_data" d
   WHERE ((d."damageType" = 'Battle'::text)
      AND (d.rarity = ANY (ARRAY['Legendary'::text, 'Mythic'::text]))
      AND (d."damageDealt" > 0)
      AND (d.cluster_code IS NOT NULL)
      AND (NOT ((d."remainingHp" = 0) AND (d."maxHp" > 0) AND (d."damageDealt" < d."maxHp"))))
), boss_averages AS (
  SELECT filtered_battles."Season",
         filtered_battles.cluster_code,
         filtered_battles.boss_key,
         avg(filtered_battles."damageDealt") AS cluster_avg
    FROM filtered_battles
   GROUP BY filtered_battles."Season", filtered_battles.cluster_code, filtered_battles.boss_key
), player_boss_stats AS (
  SELECT fb."Season",
         fb.cluster_code,
         fb.stable_key,
         fb."displayName",
         fb."Guild",
         fb.boss_key,
         avg(fb."damageDealt") AS player_avg,
         count(*) AS battle_count
    FROM filtered_battles fb
   GROUP BY fb."Season", fb.cluster_code, fb.stable_key, fb."displayName", fb."Guild", fb.boss_key
), player_performance AS (
  SELECT pbs."Season",
         pbs.cluster_code,
         pbs.stable_key,
         pbs."displayName",
         pbs."Guild",
         (sum(((((pbs.player_avg / NULLIF(ba.cluster_avg, (0)::numeric)) - (1)::numeric) * (100)::numeric) * (pbs.battle_count)::numeric)) / NULLIF(sum(pbs.battle_count), (0)::numeric)) AS percent_vs_cluster,
         sum(pbs.battle_count) AS total_battles
    FROM (player_boss_stats pbs
      JOIN boss_averages ba ON (((ba.boss_key = pbs.boss_key) AND (ba."Season" = pbs."Season") AND ((ba.cluster_code)::text = (pbs.cluster_code)::text))))
   GROUP BY pbs."Season", pbs.cluster_code, pbs.stable_key, pbs."displayName", pbs."Guild"
  HAVING (sum(pbs.battle_count) > (0)::numeric)
), player_primary AS (
  SELECT DISTINCT ON (pp."Season", pp.cluster_code, pp.stable_key) pp.*
    FROM player_performance pp
   ORDER BY pp."Season", pp.cluster_code, pp.stable_key, pp.total_battles DESC,
            pp.percent_vs_cluster DESC NULLS LAST, pp."Guild", pp."displayName"
), player_rank AS (
  SELECT pp."Season", pp.cluster_code, pp.stable_key, pp."Guild", pp."displayName",
         (row_number() OVER (
           PARTITION BY pp."Season", pp.cluster_code
           ORDER BY pp.percent_vs_cluster DESC NULLS LAST, pp.stable_key
         ))::integer AS assigned_rank
    FROM player_primary pp
)
SELECT pp."Season" AS season,
       pp.cluster_code,
       pp.stable_key,
       pp."displayName" AS display_name,
       pp."Guild" AS guild,
       round(pp.percent_vs_cluster, 2) AS percent_vs_cluster,
       (pp.total_battles)::integer AS battle_count,
       pr.assigned_rank AS season_rank
  FROM player_performance pp
  LEFT JOIN player_rank pr
    ON pr."Season" = pp."Season"
   AND pr.cluster_code = pp.cluster_code
   AND pr.stable_key = pp.stable_key
   AND pr."Guild" = pp."Guild"
   AND pr."displayName" IS NOT DISTINCT FROM pp."displayName"
WITH DATA;

DO $restore_owner$
BEGIN
  EXECUTE format('ALTER MATERIALIZED VIEW public.mv_cluster_season_rankings OWNER TO %I',
    (SELECT r.rolname FROM cluster_rankings_metadata m
     JOIN pg_catalog.pg_roles r ON r.oid = m.owner_oid));
END;
$restore_owner$;

-- REFRESH CONCURRENTLY in refresh_cluster_rankings() requires this unique index.
CREATE UNIQUE INDEX idx_mv_cluster_season_rankings_unique
  ON public.mv_cluster_season_rankings (cluster_code, season, stable_key, guild, display_name);

DO $restore_indexes_and_acl$
DECLARE
  grant_row record;
BEGIN
  IF (SELECT had_lookup_index FROM cluster_rankings_metadata) THEN
    CREATE INDEX idx_mv_cluster_rankings_lookup
      ON public.mv_cluster_season_rankings USING btree (cluster_code, season);
  END IF;

  REVOKE ALL ON TABLE public.mv_cluster_season_rankings FROM PUBLIC;
  -- Remove any default grants introduced by CREATE before restoring the ACL.
  FOR grant_row IN
    SELECT DISTINCT a.grantee, r.rolname
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
    WHERE c.oid = 'public.mv_cluster_season_rankings'::regclass
      AND a.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.mv_cluster_season_rankings FROM %I', grant_row.rolname);
  END LOOP;

  FOR grant_row IN
    SELECT a.*, r.rolname
    FROM cluster_rankings_acl a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
    WHERE a.grantee <> (SELECT owner_oid FROM cluster_rankings_metadata)
  LOOP
    EXECUTE format('GRANT %s ON TABLE public.mv_cluster_season_rankings TO %s%s',
      grant_row.privilege_type,
      CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(grant_row.rolname) END,
      CASE WHEN grant_row.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END;
$restore_indexes_and_acl$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    IF has_table_privilege('anon', 'public.mv_cluster_season_rankings', 'SELECT') THEN
      RAISE EXCEPTION 'anon must not have SELECT on mv_cluster_season_rankings';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    IF has_table_privilege('authenticated', 'public.mv_cluster_season_rankings', 'SELECT') THEN
      RAISE EXCEPTION 'authenticated must not have SELECT on mv_cluster_season_rankings';
    END IF;
  END IF;
  IF EXISTS (
    WITH actual AS (
      SELECT a.grantee, a.privilege_type, a.is_grantable
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public.mv_cluster_season_rankings'::regclass
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM cluster_rankings_acl)
    UNION ALL
    (SELECT * FROM cluster_rankings_acl EXCEPT SELECT * FROM actual)
  ) THEN
    RAISE EXCEPTION 'mv_cluster_season_rankings grants differ from the captured ACL';
  END IF;
  IF (SELECT had_lookup_index FROM cluster_rankings_metadata)
     AND to_regclass('public.idx_mv_cluster_rankings_lookup') IS NULL THEN
    RAISE EXCEPTION 'idx_mv_cluster_rankings_lookup was not restored';
  END IF;
  IF to_regclass('public.idx_mv_cluster_season_rankings_unique') IS NULL THEN
    RAISE EXCEPTION
      'idx_mv_cluster_season_rankings_unique is missing; REFRESH CONCURRENTLY would break';
  END IF;
  IF (SELECT relispopulated
      FROM pg_catalog.pg_class
      WHERE oid = 'public.mv_cluster_season_rankings'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'mv_cluster_season_rankings was not populated';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc
      WHERE oid IN (
        'public.get_cluster_overall_leaderboard(text,text)'::regprocedure,
        'public.get_cluster_historical_rankings(text[],text)'::regprocedure
      )) <> 2 THEN
    RAISE EXCEPTION 'leaderboard RPCs are missing after replacement';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

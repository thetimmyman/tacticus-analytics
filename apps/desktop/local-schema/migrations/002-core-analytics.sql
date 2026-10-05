CREATE TABLE public.boss_mapping (
    id integer NOT NULL,
    boss_type text NOT NULL,
    encounter_index integer NOT NULL,
    boss_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    auto_generated boolean DEFAULT false,
    asset_slug text,
    portrait_path text,
    icon_path text,
    thumbnail_path text,
    asset_source text DEFAULT 'datamine'::text,
    map_slug text,
    map_display_name text,
    map_variant text,
    map_source text,
    map_metadata jsonb,
    last_synced_at timestamp with time zone,
    unit_id text,
    faction text,
    faction_ban text,
    damage_type text,
    traits text[] DEFAULT '{}'::text[],
    key_abilities text[] DEFAULT '{}'::text[],
    weaknesses text[] DEFAULT '{}'::text[],
    preferred_traits text[] DEFAULT '{}'::text[],
    avoid_traits text[] DEFAULT '{}'::text[],
    hex_width integer DEFAULT 2,
    hex_height integer DEFAULT 2,
    movement integer DEFAULT 0,
    can_fly boolean DEFAULT false,
    base_health integer,
    base_damage integer,
    base_armor integer
);

CREATE OR REPLACE FUNCTION public._pm_caller_mapping_rows()
RETURNS TABLE(user_id uuid, guild_code text, cluster_code character varying,
              role public.app_role, is_current boolean, is_app_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT pm.user_id, pm.guild_code, pm.cluster_code, pm.role,
         pm.is_current, pm.is_app_admin
  FROM public.player_mapping pm
  WHERE pm.user_id = (SELECT auth.uid());
END;
$fn$;
CREATE TABLE public.meta_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team_name text NOT NULL,
    description text,
    is_meta boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    trigger_heroes jsonb DEFAULT '[]'::jsonb,
    match_type text DEFAULT 'any'::text,
    CONSTRAINT meta_teams_match_type_check CHECK ((match_type = ANY (ARRAY['any'::text, 'all'::text, 'exact'::text])))
);

CREATE TABLE public.player_avatar_frames (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    avatar_id character varying(100) NOT NULL,
    hero_unit_id character varying(100),
    display_name character varying(255),
    icon_url text,
    is_premium boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.hero_mappings (
    id integer NOT NULL,
    unit_id text NOT NULL,
    display_name text,
    discord_emoji text,
    discord_emoji_id text,
    icon_url text GENERATED ALWAYS AS (
CASE
    WHEN (discord_emoji_id IS NOT NULL) THEN (('https://cdn.discordapp.com/emojis/'::text || discord_emoji_id) || '.png'::text)
    ELSE NULL::text
END) STORED,
    category text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    web_icon_url text,
    avatar_id character varying(100),
    game_id text,
    long_name text,
    description text,
    faction_id text,
    alliance_id text,
    base_rarity text,
    movement integer DEFAULT 3,
    sorting integer,
    active_ability text,
    passive_ability text,
    mow_active_abilities text[],
    mythic_abilities text[],
    traits text[] DEFAULT '{}'::text[],
    damage_profiles text[] DEFAULT '{}'::text[],
    item_slots text[] DEFAULT '{}'::text[],
    base_health integer,
    base_damage integer,
    base_armor integer,
    CONSTRAINT hero_mappings_category_check CHECK ((category = ANY (ARRAY['Hero'::text, 'MOW'::text])))
);

CREATE FUNCTION public.get_boss_difficulty_analysis(p_guild_code text, p_season text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(boss_name text, display_name text, rarity text, set_num integer, encounter_id integer, avg_attempts numeric, avg_time_minutes numeric, hit_count integer, total_damage bigint, completed_loops integer, total_loops integer, completion_rate numeric, avg_damage_per_attempt numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH battle_records AS (
    SELECT
      d."Name",
      d.rarity,
      d.set,
      d."encounterId",
      d."damageDealt",
      d."remainingHp",
      d."maxHp",
      d."loopIndex",
      d.timestamp,
      d."startedOn",
      d."completedOn",
      CASE
        WHEN d.rarity = 'Mythic' THEN 'M' || (COALESCE(d.set, 0) + 1)::TEXT
        ELSE 'L' || (COALESCE(d.set, 0) + 1)::TEXT
      END || ' ' || d."Name" AS boss_display_name
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d."damageDealt" > 0
      AND d.rarity = ANY(p_rarities)
  ),
  boss_loop_stats AS (
    SELECT
      br."Name",
      br.rarity,
      br.set,
      br."encounterId",
      br.boss_display_name,
      br."loopIndex",
      COUNT(*)::INTEGER AS loop_attempts,
      SUM(br."damageDealt")::BIGINT AS loop_damage,
      MIN(COALESCE(br."startedOn", br.timestamp)) AS first_hit,
      MAX(COALESCE(br."completedOn", br.timestamp)) AS last_hit,
      MAX(br."maxHp") AS max_hp,
      (SELECT br2."remainingHp"
       FROM battle_records br2
       WHERE br2."Name" = br."Name"
         AND br2.rarity = br.rarity
         AND br2.set = br.set
         AND br2."encounterId" = br."encounterId"
         AND br2."loopIndex" = br."loopIndex"
       ORDER BY br2."completedOn" DESC NULLS LAST, br2.timestamp DESC NULLS LAST
       LIMIT 1) AS final_remaining_hp
    FROM battle_records br
    WHERE br."loopIndex" IS NOT NULL
    GROUP BY br."Name", br.rarity, br.set, br."encounterId", br.boss_display_name, br."loopIndex"
  ),
  boss_aggregates AS (
    SELECT
      bls."Name",
      bls.rarity,
      bls.set,
      bls."encounterId",
      bls.boss_display_name,
      COUNT(DISTINCT bls."loopIndex")::INTEGER AS total_loop_count,
      COUNT(DISTINCT bls."loopIndex") FILTER (
        WHERE bls.final_remaining_hp IS NOT NULL AND bls.final_remaining_hp <= 0
           OR (bls.max_hp > 0 AND bls.loop_damage >= bls.max_hp)
      )::INTEGER AS completed_loop_count,
      SUM(bls.loop_attempts) FILTER (
        WHERE bls.final_remaining_hp IS NOT NULL AND bls.final_remaining_hp <= 0
           OR (bls.max_hp > 0 AND bls.loop_damage >= bls.max_hp)
      )::INTEGER AS attempts_in_completed_loops,
      SUM(bls.loop_attempts)::INTEGER AS total_hits,
      SUM(bls.loop_damage)::BIGINT AS total_dmg,
      SUM(
        CASE
          WHEN (bls.final_remaining_hp IS NOT NULL AND bls.final_remaining_hp <= 0
                OR (bls.max_hp > 0 AND bls.loop_damage >= bls.max_hp))
               AND bls.first_hit IS NOT NULL AND bls.last_hit IS NOT NULL
               AND bls.last_hit > bls.first_hit
          THEN EXTRACT(EPOCH FROM (bls.last_hit - bls.first_hit)) / 60.0
          ELSE 0
        END
      ) AS total_completion_time_minutes
    FROM boss_loop_stats bls
    GROUP BY bls."Name", bls.rarity, bls.set, bls."encounterId", bls.boss_display_name
  )
  SELECT
    ba."Name" AS boss_name,
    ba.boss_display_name AS display_name,
    ba.rarity,
    ba.set AS set_num,
    ba."encounterId" AS encounter_id,
    CASE
      WHEN ba.completed_loop_count > 0
      THEN ROUND(ba.attempts_in_completed_loops::NUMERIC / ba.completed_loop_count, 2)
      ELSE 0
    END AS avg_attempts,
    CASE
      WHEN ba.completed_loop_count > 0
      THEN ROUND(ba.total_completion_time_minutes / ba.completed_loop_count, 2)
      ELSE 0
    END AS avg_time_minutes,
    ba.total_hits AS hit_count,
    ba.total_dmg AS total_damage,
    ba.completed_loop_count AS completed_loops,
    ba.total_loop_count AS total_loops,
    CASE
      WHEN ba.total_loop_count > 0
      THEN ROUND(ba.completed_loop_count::NUMERIC / ba.total_loop_count, 3)
      ELSE 0
    END AS completion_rate,
    CASE
      WHEN ba.total_hits > 0
      THEN ROUND(ba.total_dmg::NUMERIC / ba.total_hits, 0)
      ELSE 0
    END AS avg_damage_per_attempt
  FROM boss_aggregates ba
  ORDER BY
    CASE WHEN ba.rarity = 'Mythic' THEN 0 ELSE 1 END,
    ba.set DESC,
    avg_attempts DESC;
END;
$$;

CREATE FUNCTION public.get_damage_by_boss_loop(p_guild_code text, p_season text) RETURNS TABLE(loop_index integer, boss_display_name text, avg_damage numeric, max_damage numeric, total_damage bigint, hit_count integer, start_time timestamp with time zone, end_time timestamp with time zone, is_prime boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH boss_data AS (
    SELECT
      d."loopIndex",
      d."Name",
      d."damageDealt",
      d."timestamp",
      d."startedOn",
      d."completedOn",
      d.rarity,
      d.set,
      d."encounterId",
      CASE
        WHEN d.rarity = 'Mythic' THEN 'M' || (COALESCE(d.set, 0) + 1)::TEXT
        ELSE 'L' || (COALESCE(d.set, 0) + 1)::TEXT
      END || ' ' || d."Name" AS display_name,
      (d."encounterId" != 0) AS is_prime_enemy
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d.rarity IN ('Legendary', 'Mythic')
      AND d."loopIndex" IS NOT NULL
  )
  SELECT
    bd."loopIndex"::INTEGER AS loop_index,
    bd.display_name AS boss_display_name,
    ROUND(AVG(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0), 0) AS avg_damage,
    MAX(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0)::NUMERIC AS max_damage,
    SUM(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0)::BIGINT AS total_damage,
    COUNT(*)::INTEGER AS hit_count,
    MIN(COALESCE(bd."startedOn", bd."timestamp")) AS start_time,
    MAX(COALESCE(bd."completedOn", bd."timestamp")) AS end_time,
    bd.is_prime_enemy AS is_prime
  FROM boss_data bd
  GROUP BY bd."loopIndex", bd.display_name, bd.is_prime_enemy
  ORDER BY bd."loopIndex", bd.display_name;
END;
$$;

CREATE FUNCTION public.get_token_usage_by_loop(p_guild_code text, p_season text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(loop_index integer, bosses integer, primes integer, rarities text[])
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH battle_data AS (
    SELECT
      d."loopIndex",
      d."encounterId",
      d.rarity
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d.rarity = ANY(p_rarities)
  ),
  loop_aggregates AS (
    SELECT
      bd."loopIndex"::INTEGER AS loop_idx,
      COUNT(*) FILTER (WHERE bd."encounterId" = 0)::INTEGER AS boss_count,
      COUNT(*) FILTER (WHERE bd."encounterId" != 0)::INTEGER AS prime_count,
      ARRAY_AGG(DISTINCT bd.rarity) AS rarity_list
    FROM battle_data bd
    WHERE bd."loopIndex" IS NOT NULL
    GROUP BY bd."loopIndex"
  )
  SELECT
    la.loop_idx,
    la.boss_count,
    la.prime_count,
    la.rarity_list
  FROM loop_aggregates la
  ORDER BY la.loop_idx;
END;
$$;

CREATE FUNCTION public.get_guild_vs_cluster_prime_performance(p_guild_code text, p_season text) RETURNS TABLE(prime_name text, guild_avg_damage numeric, cluster_avg_damage numeric, vs_cluster_percent numeric, set integer, rarity text)
    LANGUAGE sql
    AS $$
with cluster_ctx as (
  select cluster_code
  from guild_config
  where guild_code = p_guild_code
  limit 1
),
cluster_guilds as (
  select guild_code
  from guild_config
  where cluster_code in (select cluster_code from cluster_ctx)
),
guild_agg as (
  select
    "Name" as prime_name,
    "set",
    rarity,
    sum("damageDealt") as total_damage,
    count(*) as battle_count
  from "EOT_GR_data"
  where "Season" = p_season
    and "Guild" = p_guild_code
    and "damageType" = 'Battle'
    and rarity in ('Legendary','Mythic')
    and "damageDealt" > 0
    and not ("remainingHp" = 0 and "maxHp" > 0 and "damageDealt" < "maxHp" and "damageType" = 'Battle')
    and "encounterId" in (1, 2) -- primes only
  group by "Name", "set", rarity
),
cluster_agg as (
  select
    "Name" as prime_name,
    "set",
    rarity,
    avg("damageDealt") as cluster_avg
  from "EOT_GR_data"
  where "Season" = p_season
    and "damageType" = 'Battle'
    and rarity in ('Legendary','Mythic')
    and "damageDealt" > 0
    and not ("remainingHp" = 0 and "maxHp" > 0 and "damageDealt" < "maxHp" and "damageType" = 'Battle')
    and "encounterId" in (1, 2) -- primes only
    and (
      coalesce(cluster_code, '') = coalesce((select cluster_code from cluster_ctx limit 1), '')
      or "Guild" in (select guild_code from cluster_guilds)
    )
  group by "Name", "set", rarity
)
select
  g.prime_name,
  (g.total_damage / nullif(g.battle_count,0)) as guild_avg_damage,
  c.cluster_avg as cluster_avg_damage,
  case
    when c.cluster_avg > 0 then ((g.total_damage / nullif(g.battle_count,0)) / c.cluster_avg - 1) * 100
    else 0
  end as vs_cluster_percent,
  g."set",
  g.rarity
from guild_agg g
left join cluster_agg c on
  g.prime_name = c.prime_name
  and g."set" = c."set"
  and g.rarity = c.rarity
order by vs_cluster_percent desc nulls last;
$$;

CREATE OR REPLACE FUNCTION public.get_token_usage_by_loop_and_set(
  p_guild_code text,
  p_season text,
  p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]
) RETURNS TABLE(loop_index integer, set_key text, token_count integer)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_guild text;
  v_admin boolean := false;
  v_role text;
  v_caller_cluster uuid;
  v_target_cluster uuid;
BEGIN
  IF COALESCE(
       NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
       NULLIF(session_user, '')
     ) = 'service_role' THEN
    NULL;
  ELSE
    IF v_uid IS NULL THEN
      RETURN;
    END IF;

    SELECT count(*)::integer,
           max(NULLIF(trim(pm.guild_code), '')),
           max(lower(trim(pm.role::text))),
           bool_or(pm.is_app_admin IS TRUE)
      INTO v_count, v_guild, v_role, v_admin
      FROM public._pm_caller_mapping_rows() AS pm
     WHERE pm.is_current IS TRUE;

    IF v_count <> 1
       OR v_guild IS NULL
       OR v_role NOT IN ('member', 'officer', 'leader') THEN
      RETURN;
    END IF;

    IF v_admin OR p_guild_code = v_guild THEN
      NULL;
    ELSE
      SELECT gc.cluster_id
        INTO v_caller_cluster
        FROM public.guild_config AS gc
       WHERE gc.guild_code = v_guild
       LIMIT 1;

      SELECT gc.cluster_id
        INTO v_target_cluster
        FROM public.guild_config AS gc
       WHERE gc.guild_code = p_guild_code
       LIMIT 1;

      IF v_caller_cluster IS NULL
         OR v_target_cluster IS NULL
         OR v_caller_cluster <> v_target_cluster THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  SELECT d."loopIndex"::integer,
         CASE
           WHEN d.rarity = 'Mythic'
             THEN 'M' || (coalesce(d.set, 0) + 1)::text
           ELSE 'L' || (coalesce(d.set, 0) + 1)::text
         END,
         count(*)::integer
    FROM public."EOT_GR_data" AS d
   WHERE d."Guild" = p_guild_code
     AND d."Season" = p_season
     AND d."damageType" = 'Battle'
     AND d.rarity = ANY(p_rarities)
     AND d."loopIndex" IS NOT NULL
   GROUP BY d."loopIndex",
            CASE
              WHEN d.rarity = 'Mythic'
                THEN 'M' || (coalesce(d.set, 0) + 1)::text
              ELSE 'L' || (coalesce(d.set, 0) + 1)::text
            END
   ORDER BY d."loopIndex", set_key;
END;
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

CREATE FUNCTION public.get_boss_performance_overview(p_guild_code text, p_season text, p_level text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_rarity text;
  v_level_number integer;
  v_set integer;
  v_cluster text;
  v_result jsonb;
  v_is_service boolean := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  ) = 'service_role';
BEGIN
  IF NOT v_is_service AND NOT COALESCE(
    p_guild_code IN (SELECT public._pm_caller_guild_codes())
    OR p_guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
    OR public._pm_caller_is_app_admin(),
    FALSE
  ) THEN
    RETURN NULL;
  END IF;
  IF p_level IS NULL OR length(p_level) = 0 THEN
    RAISE EXCEPTION 'Level is required';
  END IF;

  v_rarity := CASE upper(left(p_level, 1))
    WHEN 'M' THEN 'Mythic'
    WHEN 'E' THEN 'Epic'
    WHEN 'R' THEN 'Rare'
    WHEN 'U' THEN 'Uncommon'
    WHEN 'C' THEN 'Common'
    ELSE 'Legendary'
  END;

  v_level_number := NULLIF(regexp_replace(p_level, '[^0-9]', '', 'g'), '')::integer;
  v_set := GREATEST(0, COALESCE(v_level_number, 1) - 1);

  SELECT cluster_code INTO v_cluster
  FROM guild_config
  WHERE guild_code = p_guild_code
  LIMIT 1;

  WITH filtered AS (
    SELECT *
    FROM "EOT_GR_data"
    WHERE "Guild" = p_guild_code
      AND "Season" = p_season
      AND "set" = v_set
      AND "rarity" = v_rarity
      AND "damageType" = 'Battle'
      AND (
        v_cluster IS NULL
        OR v_cluster = ''
        OR "cluster_code" = v_cluster
      )
  ),
  boss_meta AS (
    SELECT
      COALESCE(
        (
          SELECT bm.boss_name
          FROM boss_mapping bm
          WHERE bm.boss_type = base_type
            AND bm.encounter_index = 0
          ORDER BY bm.auto_generated ASC NULLS LAST
          LIMIT 1
        ),
        base_type,
        'Boss ' || p_level
      ) AS boss_name,
      COALESCE(base_type, 'Unknown') AS boss_type
    FROM (
      SELECT
        COALESCE(
          MAX(NULLIF("type", '')),
          MAX(NULLIF("Name", ''))
        ) AS base_type
      FROM filtered
      WHERE COALESCE("encounterId", 0) = 0
    ) bt
  ),
  non_sweep AS (
    SELECT *
    FROM filtered
    WHERE COALESCE("encounterId", 0) = 0
      AND COALESCE("damageDealt", 0) > 0
      AND NOT (
        COALESCE("remainingHp", 0) = 0
        AND COALESCE("maxHp", 0) > 0
        AND COALESCE("damageDealt", 0) < "maxHp"
      )
  ),
  boss_all_token_counts AS (
    SELECT "displayName", COUNT(*) AS all_tokens
    FROM filtered
    WHERE COALESCE("encounterId", 0) = 0
    GROUP BY "displayName"
  ),
  boss_all_lap_counts AS (
    SELECT COALESCE("loopIndex", 0) AS lap, COUNT(*) AS all_tokens
    FROM filtered
    WHERE COALESCE("encounterId", 0) = 0
    GROUP BY COALESCE("loopIndex", 0)
  ),
  prime_all_token_counts AS (
    SELECT "displayName", COUNT(*) AS all_tokens
    FROM filtered
    WHERE COALESCE("encounterId", 0) > 0
    GROUP BY "displayName"
  ),
  main_hits AS (
    SELECT COALESCE("damageDealt", 0)::numeric AS dmg
    FROM non_sweep
  ),
  prime_rows AS (
    SELECT *
    FROM filtered
    WHERE COALESCE("encounterId", 0) > 0
      AND COALESCE("damageDealt", 0) > 0
  ),
  prime_named_rows AS (
    SELECT
      pr.*,
      COALESCE(
        (
          SELECT bm.boss_name
          FROM boss_mapping bm
          WHERE bm.boss_type = COALESCE(NULLIF(pr."type", ''), bm_base.boss_type)
            AND bm.encounter_index = COALESCE(pr."encounterId", 0)
          ORDER BY bm.auto_generated ASC NULLS LAST
          LIMIT 1
        ),
        COALESCE(NULLIF(pr."type", ''), pr."Name", 'Prime Boss')
      ) AS resolved_boss_name
    FROM prime_rows pr
    CROSS JOIN boss_meta bm_base
  ),
  player_stats AS (
    SELECT
      ns."displayName" AS display_name,
      AVG(ns."damageDealt") AS avg_damage,
      MAX(ns."damageDealt") AS max_hit,
      SUM(ns."damageDealt") AS total_damage,
      COALESCE(bat.all_tokens, COUNT(*))::bigint AS token_count,
      SUM(ns."damageDealt") / NULLIF(COUNT(*), 0) AS efficiency
    FROM non_sweep ns
    LEFT JOIN boss_all_token_counts bat ON bat."displayName" = ns."displayName"
    GROUP BY ns."displayName", bat.all_tokens
  ),
  prime_stats AS (
    SELECT
      pr."displayName" AS display_name,
      AVG(pr."damageDealt") AS avg_damage,
      MAX(pr."damageDealt") AS max_hit,
      COALESCE(pat.all_tokens, COUNT(*))::bigint AS token_count
    FROM prime_rows pr
    LEFT JOIN prime_all_token_counts pat ON pat."displayName" = pr."displayName"
    GROUP BY pr."displayName", pat.all_tokens
  ),
  prime_ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (ORDER BY token_count DESC, avg_damage DESC) AS rnk
    FROM prime_stats
  ),
  prime_boss_players AS (
    SELECT
      resolved_boss_name AS boss_name,
      "displayName" AS display_name,
      AVG("damageDealt") AS avg_damage,
      MAX("damageDealt") AS max_hit,
      COUNT(*) AS token_count
    FROM prime_named_rows
    GROUP BY resolved_boss_name, "displayName"
  ),
  prime_boss_ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY boss_name ORDER BY avg_damage DESC, token_count DESC) AS boss_rank
    FROM prime_boss_players
  ),
  lap_trends AS (
    SELECT
      COALESCE(ns."loopIndex", 0) AS lap,
      AVG(ns."damageDealt") AS avg_damage,
      COALESCE(blc.all_tokens, COUNT(*))::bigint AS token_count
    FROM non_sweep ns
    LEFT JOIN boss_all_lap_counts blc ON blc.lap = COALESCE(ns."loopIndex", 0)
    GROUP BY COALESCE(ns."loopIndex", 0), blc.all_tokens
  ),
  top_stats AS (
    SELECT jsonb_build_object(
      'topTotalDamagePlayer',
      (SELECT display_name FROM player_stats ORDER BY total_damage DESC LIMIT 1),
      'topTotalDamage',
      COALESCE((SELECT total_damage FROM player_stats ORDER BY total_damage DESC LIMIT 1), 0),
      'biggestHitPlayer',
      (SELECT "displayName" FROM non_sweep ORDER BY COALESCE("damageDealt", 0) DESC LIMIT 1),
      'biggestHit',
      COALESCE((SELECT MAX("damageDealt") FROM non_sweep), 0),
      'totalBossTokens',
      (SELECT COUNT(*) FROM filtered WHERE COALESCE("encounterId", 0) = 0),
      'totalPrimeTokens',
      (SELECT COUNT(*) FROM filtered WHERE COALESCE("encounterId", 0) > 0),
      'overallAvgDamage',
      COALESCE((SELECT AVG("damageDealt") FROM non_sweep), 0)
    ) AS payload
  ),
  main_distribution AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM main_hits)
        THEN jsonb_build_object(
          'name', (SELECT boss_name FROM boss_meta),
          'min', MIN(dmg),
          'q1', percentile_cont(0.25) WITHIN GROUP (ORDER BY dmg),
          'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY dmg),
          'q3', percentile_cont(0.75) WITHIN GROUP (ORDER BY dmg),
          'max', MAX(dmg),
          'sampleSize', COUNT(*)
        )
      ELSE NULL
    END AS payload
    FROM main_hits
  ),
  prime_distribution_stats AS (
    SELECT jsonb_build_object(
      'name', resolved_boss_name,
      'min', MIN(dmg),
      'q1', percentile_cont(0.25) WITHIN GROUP (ORDER BY dmg),
      'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY dmg),
      'q3', percentile_cont(0.75) WITHIN GROUP (ORDER BY dmg),
      'max', MAX(dmg),
      'sampleSize', COUNT(*)
    ) AS payload
    FROM (
      SELECT
        resolved_boss_name,
        COALESCE("damageDealt", 0)::numeric AS dmg
      FROM prime_named_rows
    ) p
    GROUP BY resolved_boss_name
  ),
  prime_distributions AS (
    SELECT COALESCE(
      jsonb_agg(payload ORDER BY payload->>'name'),
      '[]'::jsonb
    ) AS payload
    FROM prime_distribution_stats
  ),
  assigned_players AS (
    SELECT jsonb_build_object(
      'primary', COALESCE(
        (
          SELECT jsonb_agg(display_name ORDER BY display_name)
          FROM player_with_cluster pwc
          WHERE pwc.guild_code = p_guild_code
            AND (v_cluster IS NULL OR v_cluster = '' OR pwc.cluster_code = v_cluster)
            AND pwc.primary_boss = (SELECT boss_name FROM boss_meta)
        ),
        '[]'::jsonb
      ),
      'secondary', COALESCE(
        (
          SELECT jsonb_agg(display_name ORDER BY display_name)
          FROM player_with_cluster pwc
          WHERE pwc.guild_code = p_guild_code
            AND (v_cluster IS NULL OR v_cluster = '' OR pwc.cluster_code = v_cluster)
            AND pwc.secondary_boss = (SELECT boss_name FROM boss_meta)
        ),
        '[]'::jsonb
      )
    ) AS payload
  ),
  prime_boss_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bossName', boss_name,
          'playerStats', players
        )
        ORDER BY boss_name
      ),
      '[]'::jsonb
    ) AS payload
    FROM (
      SELECT
        boss_name,
        jsonb_agg(
          jsonb_build_object(
            'displayName', display_name,
            'avgDamage', avg_damage,
            'maxHit', max_hit,
            'tokenCount', token_count
          )
          ORDER BY avg_damage DESC, token_count DESC
        ) AS players
      FROM prime_boss_ranked
      WHERE boss_rank <= 20
      GROUP BY boss_name
    ) s
  )
  SELECT jsonb_build_object(
    'bossName', (SELECT boss_name FROM boss_meta), 'bossType', (SELECT boss_type FROM boss_meta),
    'playerStats', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'displayName', display_name,
            'avgDamage', avg_damage,
            'maxHit', max_hit,
            'totalDamage', total_damage,
            'tokenCount', token_count,
            'efficiency', efficiency
          )
          ORDER BY avg_damage DESC
        )
        FROM player_stats
      ),
      '[]'::jsonb
    ),
    'primeStats', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'displayName', display_name,
            'avgDamage', avg_damage,
            'maxHit', max_hit,
            'tokenCount', token_count
          )
          ORDER BY token_count DESC, avg_damage DESC
        )
        FROM prime_ranked
        WHERE rnk <= 30
      ),
      '[]'::jsonb
    ),
    'primeBossStats', (SELECT payload FROM prime_boss_json),
    'primeDistributions', (SELECT payload FROM prime_distributions),
    'lapTrends', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'lap', lap + 1,
            'avgDamage', avg_damage,
            'tokenCount', token_count
          )
          ORDER BY lap
        )
        FROM lap_trends
      ),
      '[]'::jsonb
    ),
    'topStats', (SELECT payload FROM top_stats),
    'mainDistribution', (SELECT payload FROM main_distribution),
    'assignedPlayers', (SELECT payload FROM assigned_players),
    'hasPrimeData', EXISTS(SELECT 1 FROM prime_rows),
    'hasCluster', (v_cluster IS NOT NULL AND v_cluster <> '')
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

ALTER TABLE public.meta_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_teams FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hero_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hero_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.player_avatar_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_avatar_frames FORCE ROW LEVEL SECURITY;
ALTER TABLE public.boss_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY desktop_meta_catalog_read ON public.meta_teams FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
CREATE POLICY desktop_hero_catalog_read ON public.hero_mappings FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
CREATE POLICY desktop_avatar_catalog_read ON public.player_avatar_frames FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
CREATE POLICY desktop_boss_catalog_read ON public.boss_mapping FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.meta_teams,public.hero_mappings,public.player_avatar_frames,public.boss_mapping TO authenticated,desktop_rpc_reader,service_role;
GRANT SELECT(avatar_unit_id) ON public.player_mapping TO authenticated;
DO $core_rpc$
DECLARE fn regprocedure;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('_pm_caller_mapping_rows','get_boss_difficulty_analysis','get_damage_by_boss_loop','get_token_usage_by_loop','get_guild_vs_cluster_prime_performance','get_token_usage_by_loop_and_set','get_guild_trends_batch','get_boss_performance_overview') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
  EXECUTE format('ALTER FUNCTION %s OWNER TO desktop_rpc_reader',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role,desktop_rpc_reader',fn);
 END LOOP;
END;
$core_rpc$;

CREATE FUNCTION public.get_player_stats_comprehensive(p_guild_code text, p_season text, p_display_name text) RETURNS jsonb
    LANGUAGE sql
    AS $$
WITH cluster_info AS (
  SELECT cluster_code
  FROM guild_config
  WHERE guild_code = p_guild_code
  LIMIT 1
),
battle AS (
  SELECT
    "Name" AS name,
    tier,
    set,
    "encounterId" AS encounter_id,
    "damageDealt" AS damage_dealt,
    "damageType" AS damage_type,
    "maxHp" AS max_hp,
    "remainingHp" AS remaining_hp,
    rarity,
    "loopIndex" AS loop_index,
    ( "remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp" AND "damageType" = 'Battle' ) AS is_sweep,
    ( "remainingHp" = 0 AND "damageDealt" >= "maxHp" AND "damageType" = 'Battle' ) AS is_one_shot,
    ( "damageType" = 'Battle' AND "damageDealt" = 0 ) AS is_crash
  FROM "EOT_GR_data"
  WHERE "Guild" = p_guild_code
    AND "Season" = p_season
    AND "displayName" = p_display_name
),
agg AS (
  SELECT
    coalesce(sum(CASE WHEN damage_type IN ('Battle','Bomb') THEN damage_dealt END), 0) AS total_damage,
    avg(nullif(CASE
      WHEN damage_type = 'Battle'
        AND NOT is_sweep
        AND damage_dealt > 0
      THEN damage_dealt
    END, 0)) AS avg_damage_per_hit,
    count(*) FILTER (WHERE damage_type = 'Battle') AS tokens_used,
    count(*) FILTER (WHERE damage_type = 'Bomb') AS bombs_used,
    count(*) FILTER (WHERE damage_type = 'Battle' AND rarity IN ('Legendary','Mythic')) AS legendary_tokens_used,
    count(*) FILTER (WHERE damage_type = 'Bomb' AND rarity IN ('Legendary','Mythic')) AS legendary_bombs_used,
    count(*) FILTER (WHERE remaining_hp = 0 AND damage_dealt > 0) AS kills,
    count(*) FILTER (WHERE is_sweep) AS sweeps,
    count(*) FILTER (WHERE is_one_shot) AS one_shots,
    count(*) FILTER (WHERE is_crash) AS crashes
  FROM battle
),
guild_avg AS (
  SELECT
    "Name" AS name,
    rarity,
    set AS set_val,
    CASE WHEN "encounterId" = 0 THEN 'boss' ELSE 'prime' END AS kind,
    avg("damageDealt")::numeric AS avg_damage
  FROM "EOT_GR_data"
  WHERE "Guild" = p_guild_code
    AND "Season" = p_season
    AND "damageType" = 'Battle'
    AND rarity IN ('Legendary', 'Mythic')
    AND "damageDealt" > 0
    AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp")
  GROUP BY "Name", rarity, set, CASE WHEN "encounterId" = 0 THEN 'boss' ELSE 'prime' END
),
cluster_avg AS (
  SELECT
    e."Name" AS name,
    e.rarity,
    e.set AS set_val,
    CASE WHEN e."encounterId" = 0 THEN 'boss' ELSE 'prime' END AS kind,
    avg(e."damageDealt")::numeric AS avg_damage
  FROM "EOT_GR_data" e
  JOIN guild_config gc ON gc.guild_code = e."Guild"
  CROSS JOIN cluster_info ci
  WHERE e."Season" = p_season
    AND gc.cluster_code = ci.cluster_code
    AND e."damageType" = 'Battle'
    AND e.rarity IN ('Legendary', 'Mythic')
    AND e."damageDealt" > 0
    AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    AND ci.cluster_code IS NOT NULL
  GROUP BY e."Name", e.rarity, e.set, CASE WHEN e."encounterId" = 0 THEN 'boss' ELSE 'prime' END
),
bosses AS (
  SELECT
    CASE WHEN min(encounter_id) = 0 THEN 'boss' ELSE 'prime' END AS kind,
    concat(name, '_', rarity, '_', set) AS boss_key,
    name,
    set AS set_val,
    max(tier) AS tier_max,
    rarity,
    min(encounter_id) AS encounter_id,
    sum(damage_dealt) FILTER ( WHERE NOT is_sweep ) AS damage,
    count(*) FILTER ( WHERE damage_type = 'Battle' AND NOT is_sweep ) AS tokens,
    max(damage_dealt) AS biggest_hit,
    count(*) FILTER (WHERE is_sweep) AS sweeps,
    count(*) FILTER (WHERE is_one_shot) AS one_shots,
    count(*) FILTER (WHERE is_crash) AS crashes,
    count(*) FILTER (WHERE damage_type = 'Battle') AS total_tokens,
    sum(damage_dealt) FILTER (WHERE damage_type = 'Battle') AS total_damage_with_sweeps,
    avg(damage_dealt) FILTER (WHERE damage_type = 'Battle' AND NOT is_sweep AND damage_dealt > 0)::numeric AS player_avg,
    array_agg(damage_dealt::numeric) FILTER (WHERE is_sweep AND damage_dealt > 0) AS sweep_damages
  FROM battle
  WHERE rarity IN ('Legendary','Mythic') AND damage_type = 'Battle'
  GROUP BY name, rarity, set
),
boss_with_vs AS (
  SELECT
    b.*,
    coalesce(qualifying_sweep_count(b.sweep_damages, GREATEST(b.player_avg, ga.avg_damage)), 0) AS qualifying_sweeps_guild,
    coalesce(qualifying_sweep_count(b.sweep_damages, GREATEST(b.player_avg, ca.avg_damage)), 0) AS qualifying_sweeps_cluster,
    coalesce(b.damage, 0) + coalesce(qualifying_sweep_sum(b.sweep_damages, GREATEST(b.player_avg, ga.avg_damage)), 0) AS adj_damage_guild,
    (coalesce(b.tokens, 0) + coalesce(qualifying_sweep_count(b.sweep_damages, GREATEST(b.player_avg, ga.avg_damage)), 0)) AS adj_count_guild,
    ROUND(COALESCE(calc_boss_performance_pct(b.damage, b.tokens, b.sweep_damages, ga.avg_damage, b.player_avg), 0)::numeric, 1) AS vs_guild,
    ROUND(COALESCE(calc_boss_performance_pct(b.damage, b.tokens, b.sweep_damages, ca.avg_damage, b.player_avg), 0)::numeric, 1) AS vs_cluster
  FROM bosses b
  LEFT JOIN guild_avg ga ON ga.name = b.name AND ga.rarity = b.rarity AND ga.set_val = b.set_val AND ga.kind = b.kind
  LEFT JOIN cluster_avg ca ON ca.name = b.name AND ca.rarity = b.rarity AND ca.set_val = b.set_val AND ca.kind = b.kind
),
overall_weighted AS (
  SELECT
    CASE WHEN sum(coalesce(tokens, 0) + qualifying_sweeps_guild) > 0
      THEN sum(vs_guild * (coalesce(tokens, 0) + qualifying_sweeps_guild)) / sum(coalesce(tokens, 0) + qualifying_sweeps_guild)
      ELSE 0 END AS weighted_vs_guild,
    CASE WHEN sum(coalesce(tokens, 0) + qualifying_sweeps_cluster) > 0
      THEN sum(vs_cluster * (coalesce(tokens, 0) + qualifying_sweeps_cluster)) / sum(coalesce(tokens, 0) + qualifying_sweeps_cluster)
      ELSE 0 END AS weighted_vs_cluster
  FROM boss_with_vs
  WHERE (coalesce(tokens, 0) + qualifying_sweeps_guild) > 0
     OR (coalesce(tokens, 0) + qualifying_sweeps_cluster) > 0
),
boss_map AS (
  SELECT coalesce(
    jsonb_object_agg(
      b.boss_key,
      jsonb_build_object(
        'damage', coalesce(b.damage,0),
        'tokens', coalesce(b.tokens,0),
        'avgDamage', CASE WHEN b.adj_count_guild > 0 THEN b.adj_damage_guild::float / b.adj_count_guild ELSE 0 END,
        'biggestHit', coalesce(b.biggest_hit,0),
        'sweeps', coalesce(b.sweeps,0),
        'oneShots', coalesce(b.one_shots,0),
        'crashes', coalesce(b.crashes,0),
        'totalTokens', coalesce(b.total_tokens,0),
        'totalDamageWithSweeps', coalesce(b.total_damage_with_sweeps,0),
        'avgDamageWithSweeps', CASE WHEN b.total_tokens > 0 THEN b.total_damage_with_sweeps::float / b.total_tokens ELSE 0 END,
        'set', b.set_val,
        'tier', b.tier_max,
        'rarity', b.rarity,
        'encounterId', b.encounter_id,
        'vsGuildAvg', b.vs_guild,
        'vsClusterAvg', b.vs_cluster,
        'qualifyingSweepsGuild', coalesce(b.qualifying_sweeps_guild, 0),
        'qualifyingSweepsCluster', coalesce(b.qualifying_sweeps_cluster, 0)
      )
    ) FILTER (WHERE b.kind = 'boss'),
    '{}'::jsonb
  ) AS boss_stats,
  coalesce(
    jsonb_object_agg(
      b.boss_key,
      jsonb_build_object(
        'damage', coalesce(b.damage,0),
        'tokens', coalesce(b.tokens,0),
        'avgDamage', CASE WHEN b.adj_count_guild > 0 THEN b.adj_damage_guild::float / b.adj_count_guild ELSE 0 END,
        'biggestHit', coalesce(b.biggest_hit,0),
        'sweeps', coalesce(b.sweeps,0),
        'oneShots', coalesce(b.one_shots,0),
        'crashes', coalesce(b.crashes,0),
        'totalTokens', coalesce(b.total_tokens,0),
        'totalDamageWithSweeps', coalesce(b.total_damage_with_sweeps,0),
        'avgDamageWithSweeps', CASE WHEN b.total_tokens > 0 THEN b.total_damage_with_sweeps::float / b.total_tokens ELSE 0 END,
        'set', b.set_val,
        'tier', b.tier_max,
        'rarity', b.rarity,
        'encounterId', b.encounter_id,
        'vsGuildAvg', b.vs_guild,
        'vsClusterAvg', b.vs_cluster,
        'qualifyingSweepsGuild', coalesce(b.qualifying_sweeps_guild, 0),
        'qualifyingSweepsCluster', coalesce(b.qualifying_sweeps_cluster, 0)
      )
    ) FILTER (WHERE b.kind = 'prime'),
    '{}'::jsonb
  ) AS prime_stats
  FROM boss_with_vs b
),
historical_tokens AS (
  SELECT coalesce(
    jsonb_object_agg(season, token_count),
    '{}'::jsonb
  ) AS season_tokens
  FROM (
    SELECT "Season" AS season, count(*) AS token_count
    FROM "EOT_GR_data"
    WHERE "Guild" = p_guild_code
      AND "displayName" = p_display_name
      AND "damageType" = 'Battle'
      AND "damageDealt" > 0
    GROUP BY "Season"
  ) t
)
SELECT jsonb_build_object(
  'totalDamage', agg.total_damage,
  'avgDamagePerHit', coalesce(agg.avg_damage_per_hit, 0),
  'tokensUsed', agg.tokens_used,
  'bombsUsed', agg.bombs_used,
  'legendaryTokensUsed', agg.legendary_tokens_used,
  'legendaryBombsUsed', agg.legendary_bombs_used,
  'maxPossibleTokens', 0,
  'maxPossibleBombs', 0,
  'isTokenOffender', false,
  'isTokenAbuser', false,
  'kills', agg.kills,
  'sweeps', agg.sweeps,
  'oneShots', agg.one_shots,
  'crashes', agg.crashes,
  'vsClusterAvg', coalesce(round(ow.weighted_vs_cluster::numeric, 1), 0),
  'vsGuildAvg', coalesce(round(ow.weighted_vs_guild::numeric, 1), 0),
  'weightedContribution', 0,
  'bossStats', coalesce(boss_map.boss_stats, '{}'::jsonb),
  'primeStats', coalesce(boss_map.prime_stats, '{}'::jsonb),
  'historicalTokens', coalesce(historical_tokens.season_tokens, '{}'::jsonb)
) AS result
FROM agg
CROSS JOIN boss_map
CROSS JOIN historical_tokens
CROSS JOIN overall_weighted ow;
$$;
REVOKE ALL ON FUNCTION public.get_player_stats_comprehensive(text,text,text) FROM PUBLIC,anon,authenticated,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_stats_comprehensive(text,text,text) TO service_role;

CREATE FUNCTION public.get_player_boss_rankings(p_player_name text, p_guild_code text, p_cluster_code text, p_season text) RETURNS TABLE(boss_name text, encounter_id integer, player_rank integer, total_players integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH boss_performances AS (
    SELECT
      CONCAT(COALESCE(resolve_boss_name(e."Name"), e."Name"), '_', e.rarity, '_', e.set) as boss_name,
      e."encounterId" as encounter_id,
      e."displayName" as player_name,
      e."Guild" as guild,
      AVG(e."damageDealt") as avg_damage
    FROM "EOT_GR_data" e
    LEFT JOIN guild_config gc ON gc.guild_code = e."Guild"
    WHERE e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND gc.cluster_code = p_cluster_code
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY COALESCE(resolve_boss_name(e."Name"), e."Name"), e.rarity, e.set, e."encounterId", e."displayName", e."Guild"
  ),
  ranked_performances AS (
    SELECT
      bp.boss_name,
      bp.encounter_id,
      bp.player_name,
      bp.guild,
      bp.avg_damage,
      RANK() OVER (PARTITION BY bp.boss_name, bp.encounter_id ORDER BY bp.avg_damage DESC) as rank,
      COUNT(*) OVER (PARTITION BY bp.boss_name, bp.encounter_id) as total_players
    FROM boss_performances bp
  )
  SELECT
    rp.boss_name,
    rp.encounter_id,
    rp.rank::INTEGER as player_rank,
    rp.total_players::INTEGER
  FROM ranked_performances rp
  WHERE rp.player_name = p_player_name
    AND rp.guild = p_guild_code;
END;
$$;

CREATE FUNCTION public.get_player_damage_by_boss_loop(p_guild_code text, p_season text, p_display_name text) RETURNS TABLE(loop_index integer, boss_display_name text, avg_damage numeric, max_damage numeric, total_damage bigint, hit_count integer, start_time timestamp with time zone, end_time timestamp with time zone, is_prime boolean, sweep_count integer, one_shot_count integer, crash_count integer, eff_avg_damage numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH boss_data AS (
    SELECT
      d."loopIndex",
      d."Name",
      d."damageDealt",
      d."remainingHp",
      d."maxHp",
      d."timestamp",
      d."startedOn",
      d."completedOn",
      d.rarity,
      d.set,
      d."encounterId",
      CASE
        WHEN d.rarity = 'Mythic' THEN 'M' || (COALESCE(d.set, 0) + 1)::TEXT
        ELSE 'L' || (COALESCE(d.set, 0) + 1)::TEXT
      END || ' ' || d."Name" AS display_name,
      (d."encounterId" != 0) AS is_prime_enemy
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."displayName" = p_display_name
      AND d."damageType" = 'Battle'
      AND d.rarity IN ('Legendary', 'Mythic')
      AND d."loopIndex" IS NOT NULL
  )
  SELECT
    bd."loopIndex"::INTEGER AS loop_index,
    bd.display_name AS boss_display_name,
    ROUND(AVG(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0), 0) AS avg_damage,
    MAX(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0)::NUMERIC AS max_damage,
    SUM(bd."damageDealt")::BIGINT AS total_damage,
    COUNT(*) FILTER (WHERE bd."damageDealt" > 0)::INTEGER AS hit_count,
    MIN(COALESCE(bd."startedOn", bd."timestamp")) AS start_time,
    MAX(COALESCE(bd."completedOn", bd."timestamp")) AS end_time,
    bd.is_prime_enemy AS is_prime,
    COUNT(*) FILTER (
      WHERE bd."damageDealt" > 0
        AND bd."remainingHp" = 0
        AND bd."maxHp" > 0
        AND bd."damageDealt" < bd."maxHp"
    )::INTEGER AS sweep_count,
    COUNT(*) FILTER (
      WHERE bd."maxHp" > 0
        AND bd."damageDealt" >= bd."maxHp"
    )::INTEGER AS one_shot_count,
    COUNT(*) FILTER (WHERE bd."damageDealt" = 0)::INTEGER AS crash_count,
    ROUND(AVG(bd."damageDealt") FILTER (
      WHERE bd."damageDealt" > 0
        AND NOT (bd."remainingHp" = 0 AND bd."maxHp" > 0 AND bd."damageDealt" < bd."maxHp")
    ), 0) AS eff_avg_damage
  FROM boss_data bd
  GROUP BY bd."loopIndex", bd.display_name, bd.is_prime_enemy
  ORDER BY bd."loopIndex", bd.display_name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_player_damage_by_boss_loop(text,text,text),public.get_player_boss_rankings(text,text,text,text) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.get_player_damage_by_boss_loop(text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.get_player_boss_rankings(text,text,text,text) OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_damage_by_boss_loop(text,text,text),public.get_player_boss_rankings(text,text,text,text) TO authenticated,desktop_rpc_reader,service_role;

CREATE TABLE public.boss_name_aliases (
    id integer NOT NULL,
    canonical_name text NOT NULL,
    alias_name text NOT NULL,
    unit_id text,
    created_at timestamp with time zone DEFAULT now(),
    notes text
);

CREATE FUNCTION public.resolve_boss_name(p_name text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    (SELECT canonical_name FROM boss_name_aliases WHERE alias_name = p_name LIMIT 1),
    p_name
  );
$$;
ALTER TABLE public.boss_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_name_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY desktop_boss_alias_read ON public.boss_name_aliases FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.boss_name_aliases TO authenticated,desktop_rpc_reader,service_role;
REVOKE ALL ON FUNCTION public.resolve_boss_name(text) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.resolve_boss_name(text) OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.resolve_boss_name(text) TO authenticated,desktop_rpc_reader,service_role;

ALTER TABLE public.desktop_preview_setup ADD COLUMN recovery_code_hash text CHECK (recovery_code_hash ~ '^[a-f0-9]{64}$');
REVOKE ALL ON public.desktop_preview_setup FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

-- Local identity claims describe this workspace only; never upstream ownership.
ALTER TABLE public.desktop_preview_setup ADD COLUMN identity_mode text NOT NULL DEFAULT 'sample' CHECK (identity_mode IN ('sample','local-file'));
ALTER TABLE public.desktop_preview_setup ADD COLUMN guild_code text;
UPDATE public.desktop_preview_setup s SET guild_code=(SELECT min(p.guild_code) FROM public.player_mapping p WHERE p.user_id=s.subject_user_id AND p.is_current);
ALTER TABLE public.player_identity_attestations DROP CONSTRAINT player_identity_attestations_source_check;
ALTER TABLE public.player_identity_attestations ADD CONSTRAINT player_identity_attestations_source_check CHECK (source IN ('invite_consumption','historical_exact_invite','operator_quarantine_restore','self_player_id_change','desktop_local_claim'));
ALTER TABLE public.player_identity_attestations DROP CONSTRAINT player_identity_attestations_invite_presence;
ALTER TABLE public.player_identity_attestations ADD CONSTRAINT player_identity_attestations_invite_presence CHECK (source IN ('operator_quarantine_restore','desktop_local_claim') OR source_invite_id IS NOT NULL);

ALTER TABLE public."EOT_GR_data" ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;
SELECT setval(pg_get_serial_sequence('public."EOT_GR_data"','id'),coalesce((SELECT max(id)+1 FROM public."EOT_GR_data"),1),false);
CREATE UNIQUE INDEX desktop_raid_conflict_key ON public."EOT_GR_data" ("Guild","Season","userId","encounterId","startedOn","completedOn","damageDealt","damageType");
CREATE ROLE desktop_importer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_importer;
GRANT EXECUTE ON FUNCTION auth.uid() TO desktop_importer;
GRANT SELECT ON public.desktop_preview_setup TO desktop_importer;
CREATE POLICY desktop_import_setup ON public.desktop_preview_setup FOR SELECT TO desktop_importer USING (subject_user_id=auth.uid());
GRANT SELECT (guild_code,cluster_code,cluster_id) ON public.guild_config TO desktop_importer;
CREATE POLICY desktop_import_guild ON public.guild_config FOR SELECT TO desktop_importer USING (guild_code IN (SELECT s.guild_code FROM public.desktop_preview_setup s));
GRANT INSERT ON public."EOT_GR_data" TO desktop_importer;
GRANT SELECT ("Guild","Season","userId","encounterId","startedOn","completedOn","damageDealt","damageType") ON public."EOT_GR_data" TO desktop_importer;
CREATE POLICY desktop_import_conflict_read ON public."EOT_GR_data" FOR SELECT TO desktop_importer USING ("Guild" IN (SELECT s.guild_code FROM public.desktop_preview_setup s));
GRANT USAGE ON SEQUENCE public."EOT_GR_data_id_seq" TO desktop_importer;
CREATE POLICY desktop_import_write ON public."EOT_GR_data" FOR INSERT TO desktop_importer WITH CHECK ("Guild" IN (SELECT s.guild_code FROM public.desktop_preview_setup s));

CREATE TABLE public.desktop_raid_imports (
 subject_user_id uuid NOT NULL REFERENCES auth.users(id),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 guild_code text NOT NULL,
 entry_count integer NOT NULL CHECK (entry_count BETWEEN 1 AND 10000),
 inserted_count integer NOT NULL CHECK (inserted_count BETWEEN 0 AND entry_count),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subject_user_id,fingerprint)
);
ALTER TABLE public.desktop_raid_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_raid_imports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.desktop_raid_imports FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT ON public.desktop_raid_imports TO desktop_importer;
CREATE POLICY desktop_import_receipt ON public.desktop_raid_imports TO desktop_importer USING (subject_user_id=auth.uid()) WITH CHECK (subject_user_id=auth.uid());

CREATE FUNCTION public.desktop_import_raid(p_fingerprint text,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $import$
DECLARE target text; target_cluster text; target_cluster_id uuid; count_rows integer; count_inserted integer; previous integer;
BEGIN
 SELECT s.guild_code INTO STRICT target FROM public.desktop_preview_setup s WHERE s.subject_user_id=auth.uid() AND s.singleton;
 SELECT g.cluster_code,g.cluster_id INTO STRICT target_cluster,target_cluster_id FROM public.guild_config g WHERE g.guild_code=target;
 IF target IS NULL OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid local import'; END IF;
 count_rows:=jsonb_array_length(p_rows);
 IF count_rows NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid local import'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public."EOT_GR_data",p_rows) r WHERE
   r."Guild" IS DISTINCT FROM target OR r.cluster_code IS DISTINCT FROM target_cluster OR r.cluster_id IS DISTINCT FROM target_cluster_id OR
   r."Season" IS NULL OR r."Season" !~ '^[0-9]{1,6}$' OR r."Season"::integer<1 OR
   r."userId" IS NULL OR length(r."userId") NOT BETWEEN 1 AND 128 OR
   r."startedOn" IS NULL OR r."completedOn" IS NULL OR r."completedOn"<r."startedOn" OR
   r."damageDealt" IS NULL OR r."damageDealt" NOT BETWEEN 0 AND 1000000000000 OR r."damageType" IS NULL OR r."damageType" NOT IN ('Battle','Bomb') OR
   r."startedOn"<'2000-01-01T00:00:00Z'::timestamptz OR r."completedOn">'2100-01-01T00:00:00Z'::timestamptz OR
   r."displayName" IS NULL OR length(r."displayName") NOT BETWEEN 1 AND 128 OR r."Name" IS NULL OR length(r."Name") NOT BETWEEN 1 AND 256 OR
   r.rarity IS NULL OR r.rarity NOT IN ('Common','Uncommon','Rare','Epic','Legendary','Mythic') OR r.set IS NULL OR r.set NOT BETWEEN 0 AND 4 OR r.tier IS NULL OR r.tier NOT BETWEEN 0 AND 10000 OR
   r."maxHp" IS NULL OR r."maxHp" NOT BETWEEN 0 AND 1000000000000 OR r."remainingHp" IS NULL OR r."remainingHp" NOT BETWEEN 0 AND r."maxHp" OR
   r."encounterIndex" IS NULL OR r."encounterIndex" NOT BETWEEN 0 AND 1000 OR r."encounterId" IS DISTINCT FROM r."encounterIndex") THEN RAISE EXCEPTION 'Invalid local import'; END IF;
 PERFORM pg_advisory_xact_lock(74832019);
 SELECT i.inserted_count INTO previous FROM public.desktop_raid_imports i WHERE i.subject_user_id=auth.uid() AND i.fingerprint=p_fingerprint;
 IF FOUND THEN RETURN jsonb_build_object('entries',count_rows,'inserted',0,'repeated',true); END IF;
 WITH inserted AS (
   INSERT INTO public."EOT_GR_data" ("Guild","Season","userId","displayName","Name",type,"encounterType","encounterId","encounterIndex","damageType","damageDealt","remainingHp","maxHp","startedOn","completedOn",rarity,tier,set,"loopIndex","heroDetails","machineOfWarDetails","unitId","globalConfigHash",cluster_code,cluster_id)
   SELECT r."Guild",r."Season",r."userId",r."displayName",r."Name",r.type,r."encounterType",r."encounterId",r."encounterIndex",r."damageType",r."damageDealt",r."remainingHp",r."maxHp",r."startedOn",r."completedOn",r.rarity,r.tier,r.set,r."loopIndex",r."heroDetails",r."machineOfWarDetails",r."unitId",r."globalConfigHash",r.cluster_code,r.cluster_id
   FROM jsonb_populate_recordset(NULL::public."EOT_GR_data",p_rows) r
   ON CONFLICT ("Guild","Season","userId","encounterId","startedOn","completedOn","damageDealt","damageType") DO NOTHING RETURNING 1
 ) SELECT count(*) INTO count_inserted FROM inserted;
 INSERT INTO public.desktop_raid_imports(subject_user_id,fingerprint,guild_code,entry_count,inserted_count) VALUES(auth.uid(),p_fingerprint,target,count_rows,count_inserted);
 RETURN jsonb_build_object('entries',count_rows,'inserted',count_inserted,'repeated',false);
END $import$;
ALTER FUNCTION public.desktop_import_raid(text,jsonb) OWNER TO desktop_importer;
REVOKE ALL ON FUNCTION public.desktop_import_raid(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_import_raid(text,jsonb) TO desktop_owner;

-- Add canonical meta-team membership to the local profile.
CREATE TABLE public.player_meta_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    meta_team_id uuid NOT NULL,
    source text NOT NULL,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_meta_roles_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'self'::text, 'manual'::text, 'leader_override'::text])))
);

CREATE FUNCTION public.player_meta_roles_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Local membership retains canonical rows and allows scoped human changes.
ALTER TABLE public.meta_teams ADD PRIMARY KEY (id);
ALTER TABLE public.player_meta_roles ADD PRIMARY KEY (id);
ALTER TABLE public.player_meta_roles ADD UNIQUE (user_id,meta_team_id);
ALTER TABLE public.player_meta_roles ADD FOREIGN KEY (meta_team_id) REFERENCES public.meta_teams(id) ON DELETE CASCADE;
ALTER TABLE public.player_meta_roles ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.player_meta_roles ADD FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE TRIGGER trg_player_meta_roles_updated_at BEFORE UPDATE ON public.player_meta_roles FOR EACH ROW EXECUTE FUNCTION public.player_meta_roles_set_updated_at();
ALTER TABLE public.player_meta_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_meta_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_meta_roles FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
REVOKE ALL ON FUNCTION public.player_meta_roles_set_updated_at() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.player_meta_roles TO authenticated;
GRANT SELECT ON public.player_meta_roles TO service_role;
CREATE POLICY desktop_meta_role_read ON public.player_meta_roles FOR SELECT TO authenticated USING (
 user_id=auth.uid() OR EXISTS (SELECT 1 FROM public.player_mapping p WHERE p.user_id=player_meta_roles.user_id AND p.is_current AND p.guild_code IN (SELECT public._pm_caller_guild_codes()))
);
CREATE POLICY desktop_meta_role_self ON public.player_meta_roles TO authenticated USING (user_id=auth.uid() AND source='self') WITH CHECK (user_id=auth.uid() AND source='self' AND set_by=auth.uid());
CREATE POLICY desktop_meta_role_leader_insert ON public.player_meta_roles FOR INSERT TO authenticated WITH CHECK (source='leader_override' AND set_by=auth.uid() AND EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current));
CREATE POLICY desktop_meta_role_leader_update ON public.player_meta_roles FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current)) WITH CHECK (source='leader_override' AND set_by=auth.uid() AND EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current));
CREATE POLICY desktop_meta_role_leader_delete ON public.player_meta_roles FOR DELETE TO authenticated USING (source='leader_override' AND EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current));

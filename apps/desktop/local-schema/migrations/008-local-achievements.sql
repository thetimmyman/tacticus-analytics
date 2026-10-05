-- Canonical achievement inputs with local job and read authority.
CREATE FUNCTION public.get_votlw_set_winners(p_guild_code text, p_season text, p_cluster_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
BEGIN
  IF p_guild_code IS NULL OR length(trim(p_guild_code)) = 0 THEN
    RAISE EXCEPTION 'p_guild_code is required';
  END IF;

  IF p_season IS NULL OR length(trim(p_season)) = 0 THEN
    RAISE EXCEPTION 'p_season is required';
  END IF;

  WITH filtered_all AS (
    SELECT
      d."Guild" AS guild_code,
      d."Season" AS season,
      d.cluster_code,
      COALESCE(NULLIF(trim(d."displayName"), ''), 'Unknown') AS display_name,
      d."Name" AS boss_name,
      d.rarity,
      d.tier,
      d."set" AS set_num,
      d."encounterId" AS encounter_id,
      d."encounterIndex" AS encounter_index,
      d."loopIndex" AS loop_index,
      d."damageDealt" AS damage_dealt,
      d."remainingHp" AS remaining_hp,
      d."maxHp" AS max_hp,
      d."startedOn" AS started_on,
      d."completedOn" AS completed_on,
      CASE
        WHEN COALESCE(d."remainingHp", 0) = 0
          AND COALESCE(d."maxHp", 0) > 0
          AND COALESCE(d."damageDealt", 0) < d."maxHp"
          THEN TRUE
        ELSE FALSE
      END AS is_sweep,
      CASE
        WHEN COALESCE(d."remainingHp", 0) = 0
          AND COALESCE(d."maxHp", 0) > 0
          AND COALESCE(d."damageDealt", 0) >= d."maxHp"
          THEN TRUE
        ELSE FALSE
      END AS is_one_shot
    FROM public."EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d."damageDealt" IS NOT NULL
      AND d."damageDealt" > 0
      AND d.rarity IN ('Legendary', 'Mythic')
      AND (p_cluster_code IS NULL OR d.cluster_code = p_cluster_code)
  ),
  loop_start AS (
    SELECT rarity_rank, set_num
    FROM (
      SELECT
        CASE rarity WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 5 ELSE 99 END AS rarity_rank,
        COALESCE(set_num, 0) AS set_num
      FROM filtered_all
      WHERE COALESCE(loop_index, 0) >= 1
    ) s
    ORDER BY rarity_rank, set_num
    LIMIT 1
  ),
  filtered AS (
    SELECT f.*
    FROM filtered_all f
    LEFT JOIN loop_start ls ON TRUE
    WHERE ls.rarity_rank IS NULL
       OR (
            CASE f.rarity WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 5 ELSE 99 END,
            COALESCE(f.set_num, 0)
          ) >= (ls.rarity_rank, ls.set_num)
  ),
  guild_baseline AS (
    SELECT
      rarity,
      set_num,
      AVG(damage_dealt) AS avg_damage
    FROM filtered
    WHERE (encounter_id = 0 OR encounter_id IS NULL)
      AND (NOT is_sweep OR is_one_shot)
    GROUP BY rarity, set_num
  ),
  side_boss_baseline AS (
    SELECT
      rarity,
      set_num,
      encounter_index,
      AVG(damage_dealt) AS avg_damage
    FROM filtered
    WHERE encounter_index IN (1, 2)
      AND (NOT is_sweep OR is_one_shot)
    GROUP BY rarity, set_num, encounter_index
  ),
  base_stats AS (
    SELECT
      rarity,
      set_num,
      display_name,
      SUM(damage_dealt) FILTER (WHERE NOT is_sweep OR is_one_shot) AS non_sweep_damage,
      COUNT(*) FILTER (WHERE NOT is_sweep OR is_one_shot) AS meaningful_tokens,
      SUM(damage_dealt) AS total_damage,
      COUNT(*) AS token_count,
      MIN(started_on) AS first_token_time,
      array_agg(damage_dealt::numeric) FILTER (WHERE is_sweep AND NOT is_one_shot) AS sweep_damages
    FROM filtered
    WHERE encounter_id = 0 OR encounter_id IS NULL
    GROUP BY rarity, set_num, display_name
  ),
  adjusted_stats AS (
    SELECT
      bs.*,
      COALESCE(bs.non_sweep_damage, 0)
        + COALESCE(qualifying_sweep_sum(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0) AS adj_damage,
      COALESCE(bs.meaningful_tokens, 0)
        + COALESCE(qualifying_sweep_count(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0) AS adj_count,
      CASE
        WHEN (COALESCE(bs.meaningful_tokens, 0)
              + COALESCE(qualifying_sweep_count(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0)) > 0
        THEN (COALESCE(bs.non_sweep_damage, 0)
              + COALESCE(qualifying_sweep_sum(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0))::numeric
             / (COALESCE(bs.meaningful_tokens, 0)
                + COALESCE(qualifying_sweep_count(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0))
        ELSE NULL
      END AS adj_avg
    FROM base_stats bs
    LEFT JOIN guild_baseline gb ON gb.rarity = bs.rarity AND gb.set_num = bs.set_num
  ),
  qualified_avg AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num
        ORDER BY adj_avg DESC NULLS LAST, adj_count DESC, first_token_time ASC
      ) AS avg_rank
    FROM adjusted_stats
    WHERE adj_count > 1 AND adj_avg IS NOT NULL
  ),
  total_damage_ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num
        ORDER BY total_damage DESC, token_count DESC, first_token_time ASC
      ) AS total_rank
    FROM adjusted_stats
  ),
  side_boss_raw AS (
    SELECT
      rarity,
      set_num,
      CASE WHEN encounter_index = 1 THEN 'SideBoss1' ELSE 'SideBoss2' END AS encounter_label,
      display_name,
      SUM(damage_dealt) FILTER (WHERE NOT is_sweep OR is_one_shot) AS non_sweep_damage,
      COUNT(*) FILTER (WHERE NOT is_sweep OR is_one_shot) AS meaningful_tokens,
      MIN(started_on) AS first_token_time,
      array_agg(damage_dealt::numeric) FILTER (WHERE is_sweep AND NOT is_one_shot) AS sweep_damages,
      encounter_index
    FROM filtered
    WHERE encounter_index IN (1, 2)
    GROUP BY rarity, set_num, encounter_label, display_name, encounter_index
  ),
  side_boss_adjusted AS (
    SELECT
      sbr.rarity,
      sbr.set_num,
      sbr.encounter_label,
      sbr.display_name,
      CASE
        WHEN (COALESCE(sbr.meaningful_tokens, 0)
              + COALESCE(qualifying_sweep_count(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0)) > 0
        THEN (COALESCE(sbr.non_sweep_damage, 0)
              + COALESCE(qualifying_sweep_sum(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0))::numeric
             / (COALESCE(sbr.meaningful_tokens, 0)
                + COALESCE(qualifying_sweep_count(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0))
        ELSE NULL
      END AS avg_damage,
      COALESCE(sbr.meaningful_tokens, 0)
        + COALESCE(qualifying_sweep_count(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0) AS adj_count,
      sbr.first_token_time
    FROM side_boss_raw sbr
    LEFT JOIN side_boss_baseline sbb
      ON sbb.rarity = sbr.rarity AND sbb.set_num = sbr.set_num AND sbb.encounter_index = sbr.encounter_index
  ),
  side_boss_ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num, encounter_label
        ORDER BY avg_damage DESC NULLS LAST, adj_count DESC, first_token_time ASC
      ) AS side_rank
    FROM side_boss_adjusted
    WHERE avg_damage IS NOT NULL AND adj_count > 1
  ),
  boss_identity AS (
    SELECT
      rarity,
      set_num,
      MAX(
        CASE
          WHEN encounter_index IS NULL OR encounter_index = 0 THEN boss_name
          ELSE NULL
        END
      ) AS boss_name
    FROM filtered
    GROUP BY rarity, set_num
  ),
  biggest_hits AS (
    SELECT
      rarity,
      set_num,
      display_name,
      damage_dealt,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num
        ORDER BY damage_dealt DESC, started_on ASC
      ) AS hit_rank
    FROM filtered
    WHERE encounter_id = 0 OR encounter_id IS NULL
  ),
  aggregated AS (
    SELECT
      q.rarity,
      q.set_num,
      COALESCE(bi.boss_name, 'Unknown Boss') AS boss_name,
      MAX(CASE WHEN q.avg_rank = 1 THEN jsonb_build_object('player', q.display_name, 'value', ROUND(q.adj_avg))::text END)::jsonb AS gold,
      MAX(CASE WHEN q.avg_rank = 2 THEN jsonb_build_object('player', q.display_name, 'value', ROUND(q.adj_avg))::text END)::jsonb AS silver,
      MAX(CASE WHEN q.avg_rank = 3 THEN jsonb_build_object('player', q.display_name, 'value', ROUND(q.adj_avg))::text END)::jsonb AS bronze,
      MAX(CASE WHEN t.total_rank = 1 THEN jsonb_build_object('player', t.display_name, 'value', t.total_damage)::text END)::jsonb AS most_damage,
      MAX(CASE WHEN sb.encounter_label = 'SideBoss1' AND sb.side_rank = 1 THEN jsonb_build_object('player', sb.display_name, 'value', ROUND(sb.avg_damage))::text END)::jsonb AS side_boss1,
      MAX(CASE WHEN sb.encounter_label = 'SideBoss2' AND sb.side_rank = 1 THEN jsonb_build_object('player', sb.display_name, 'value', ROUND(sb.avg_damage))::text END)::jsonb AS side_boss2,
      MAX(CASE WHEN bh.hit_rank = 1 THEN jsonb_build_object('player', bh.display_name, 'value', bh.damage_dealt)::text END)::jsonb AS biggest_hit
    FROM qualified_avg q
    LEFT JOIN boss_identity bi
      ON bi.rarity = q.rarity AND bi.set_num = q.set_num
    LEFT JOIN total_damage_ranked t
      ON t.rarity = q.rarity AND t.set_num = q.set_num AND t.display_name = q.display_name
    LEFT JOIN side_boss_ranked sb
      ON sb.rarity = q.rarity AND sb.set_num = q.set_num
    LEFT JOIN biggest_hits bh
      ON bh.rarity = q.rarity AND bh.set_num = q.set_num
    GROUP BY q.rarity, q.set_num, bi.boss_name
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'rarity', ag.rarity,
        'set', ag.set_num,
        'levelString',
          CASE WHEN ag.rarity = 'Legendary' THEN CONCAT('L', ag.set_num + 1)
               WHEN ag.rarity = 'Mythic' THEN CONCAT('M', ag.set_num + 1)
               ELSE CONCAT('S', ag.set_num + 1) END,
        'bossName', ag.boss_name,
        'gold', COALESCE(ag.gold, '{}'::jsonb),
        'silver', COALESCE(ag.silver, '{}'::jsonb),
        'bronze', COALESCE(ag.bronze, '{}'::jsonb),
        'mostDamage', COALESCE(ag.most_damage, '{}'::jsonb),
        'sideBoss1', COALESCE(ag.side_boss1, '{}'::jsonb),
        'sideBoss2', COALESCE(ag.side_boss2, '{}'::jsonb),
        'biggestHit', COALESCE(ag.biggest_hit, '{}'::jsonb)
      )
      ORDER BY ag.rarity, ag.set_num
    ), '[]'::jsonb)
  INTO v_results
  FROM aggregated ag;

  RETURN v_results;
END;
$$;

CREATE TABLE public.guild_war_player_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    war_id character varying(255) NOT NULL,
    zone_id uuid NOT NULL,
    guild_code text NOT NULL,
    player_id character varying(255) NOT NULL,
    player_name character varying(255) NOT NULL,
    attempt_number integer NOT NULL,
    attempt_status character varying(20) NOT NULL,
    attempt_result character varying(10),
    damage_dealt bigint DEFAULT 0,
    score_earned integer DEFAULT 0,
    units_used jsonb,
    attempt_start_time timestamp with time zone,
    attempt_end_time timestamp with time zone,
    battle_duration integer,
    raw_loki_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_guild_member boolean DEFAULT true NOT NULL,
    attacker_team_index integer,
    attacker_guild_name text,
    defender_player_id text,
    defender_player_name text,
    defender_guild_name text,
    attacker_units_json jsonb,
    defender_units_json jsonb,
    attempt_debuff integer,
    CONSTRAINT guild_war_player_attempts_attempt_result_check CHECK (((attempt_result)::text = ANY (ARRAY[('win'::character varying)::text, ('loss'::character varying)::text]))),
    CONSTRAINT guild_war_player_attempts_attempt_status_check CHECK (((attempt_status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('abandoned'::character varying)::text])))
);

CREATE TABLE public.guild_war_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    war_id character varying(255) NOT NULL,
    guild_code text NOT NULL,
    zone_number integer NOT NULL,
    zone_name character varying(255),
    zone_type character varying(50) NOT NULL,
    zone_status character varying(20) NOT NULL,
    assigned_players text[],
    zone_score integer DEFAULT 0,
    opponent_zone_score integer DEFAULT 0,
    zone_result character varying(10),
    attempts_remaining integer DEFAULT 0,
    max_attempts integer DEFAULT 0,
    zone_start_time timestamp with time zone,
    zone_end_time timestamp with time zone,
    raw_loki_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    board_id text,
    CONSTRAINT guild_war_zones_zone_result_check CHECK (((zone_result)::text = ANY (ARRAY[('win'::character varying)::text, ('loss'::character varying)::text, ('draw'::character varying)::text]))),
    CONSTRAINT guild_war_zones_zone_status_check CHECK (((zone_status)::text = ANY (ARRAY[('available'::character varying)::text, ('assigned'::character varying)::text, ('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text])))
);

CREATE TABLE public.player_achievements (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    achievement_key text NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now() NOT NULL,
    value jsonb,
    CONSTRAINT player_achievements_key_format CHECK ((achievement_key ~ '^[a-z][a-z0-9_]{1,80}$'::text))
);

CREATE SEQUENCE public.player_achievements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.player_achievements_id_seq OWNED BY public.player_achievements.id;
ALTER TABLE public.player_achievements ALTER COLUMN id SET DEFAULT nextval('public.player_achievements_id_seq'::regclass);
ALTER TABLE public.player_achievements ADD PRIMARY KEY (id);
ALTER TABLE public.player_achievements ADD UNIQUE(user_id,achievement_key);
ALTER TABLE public.player_achievements ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.guild_war_zones ADD PRIMARY KEY(id);
ALTER TABLE public.guild_war_player_attempts ADD PRIMARY KEY(id);
ALTER TABLE public.guild_war_player_attempts ADD FOREIGN KEY(zone_id) REFERENCES public.guild_war_zones(id) ON DELETE CASCADE;
ALTER TABLE public.guild_war_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_war_zones FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guild_war_player_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_war_player_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.player_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_achievements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.guild_war_zones,public.guild_war_player_attempts,public.player_achievements FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
REVOKE ALL ON SEQUENCE public.player_achievements_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.guild_war_zones,public.guild_war_player_attempts,public.player_achievements TO authenticated,service_role;
GRANT INSERT ON public.player_achievements TO service_role;
GRANT USAGE ON SEQUENCE public.player_achievements_id_seq TO service_role;
CREATE POLICY desktop_achievement_self_read ON public.player_achievements FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY desktop_war_zone_read ON public.guild_war_zones FOR SELECT TO authenticated USING(guild_code IN(SELECT public._pm_caller_guild_codes()));
CREATE POLICY desktop_war_attempt_read ON public.guild_war_player_attempts FOR SELECT TO authenticated USING(guild_code IN(SELECT public._pm_caller_guild_codes()));
GRANT SELECT(subject_user_id,guild_code,singleton) ON public.desktop_preview_setup TO service_role;
CREATE ROLE desktop_achievement_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_achievement_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO desktop_achievement_reader;
GRANT SELECT(subject_user_id,guild_code,singleton) ON public.desktop_preview_setup TO desktop_achievement_reader;
CREATE POLICY desktop_achievement_context ON public.desktop_preview_setup FOR SELECT TO desktop_achievement_reader USING(singleton AND (subject_user_id=auth.uid() OR auth.jwt()->>'role'='service_role'));
GRANT SELECT ON public."EOT_GR_data" TO desktop_achievement_reader;
CREATE POLICY desktop_achievement_raid_read ON public."EOT_GR_data" FOR SELECT TO desktop_achievement_reader USING("Guild" IN(SELECT guild_code FROM public.desktop_preview_setup WHERE singleton));
ALTER FUNCTION public.get_votlw_set_winners(text,text,text) OWNER TO desktop_achievement_reader;
REVOKE ALL ON FUNCTION public.get_votlw_set_winners(text,text,text) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_votlw_set_winners(text,text,text) TO authenticated,service_role;
ALTER TABLE public.work_queue DROP CONSTRAINT desktop_local_job_type;
ALTER TABLE public.work_queue ADD CONSTRAINT desktop_local_job_type CHECK(job_type IN ('refresh-explore-snapshots','refresh-local-achievements'));

GRANT EXECUTE ON FUNCTION public.qualifying_sweep_sum(numeric[],numeric),public.qualifying_sweep_count(numeric[],numeric) TO desktop_achievement_reader;

-- Local display preferences never grant account or guild authority.
WITH bundled(team_name,sort_order) AS (VALUES
 ('Admech',0),('Battlesuits',1),('Custodes',2),('Double Howl',3),
 ('Forcasmo',4),('Lavstodes',5),('Neuro / Z''Kar',6),('Orkz',7))
INSERT INTO public.meta_teams(team_name,sort_order,is_meta)
SELECT b.team_name,b.sort_order,true FROM bundled b
WHERE NOT EXISTS(SELECT 1 FROM public.meta_teams m WHERE m.team_name=b.team_name);

CREATE FUNCTION public.desktop_validate_profile_preferences() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $preferences$
BEGIN
 IF NEW.timezone IS DISTINCT FROM OLD.timezone AND NEW.timezone IS NOT NULL AND
   NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local timezone'; END IF;
 IF NEW.discord_username IS DISTINCT FROM OLD.discord_username AND NEW.discord_username IS NOT NULL AND (
   length(NEW.discord_username) NOT BETWEEN 1 AND 128 OR NEW.discord_username ~ '[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local display alias'; END IF;
 IF NEW.theme_preference IS DISTINCT FROM OLD.theme_preference AND NEW.theme_preference IS NOT NULL AND
   NEW.theme_preference !~ '^[A-Za-z0-9_-]{1,20}$'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local theme preference'; END IF;
 IF (NEW.primary_team IS DISTINCT FROM OLD.primary_team AND NEW.primary_team IS NOT NULL AND
       NOT EXISTS(SELECT 1 FROM public.meta_teams WHERE team_name=NEW.primary_team)) OR
    (NEW.secondary_team IS DISTINCT FROM OLD.secondary_team AND NEW.secondary_team IS NOT NULL AND
       NOT EXISTS(SELECT 1 FROM public.meta_teams WHERE team_name=NEW.secondary_team)) OR
    (NEW.tertiary_team IS DISTINCT FROM OLD.tertiary_team AND NEW.tertiary_team IS NOT NULL AND
       NOT EXISTS(SELECT 1 FROM public.meta_teams WHERE team_name=NEW.tertiary_team))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local preferred team'; END IF;
 RETURN NEW;
END $preferences$;
REVOKE ALL ON FUNCTION public.desktop_validate_profile_preferences() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_profile_preferences_write BEFORE UPDATE OF timezone,discord_username,theme_preference,primary_team,secondary_team,tertiary_team ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_profile_preferences();
GRANT UPDATE(timezone,discord_username,theme_preference,primary_team,secondary_team,tertiary_team) ON public.current_user_player_mapping TO authenticated;

-- Owner boss choices are local preferences, not verified game-account claims.
CREATE FUNCTION public.desktop_validate_boss_preferences() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $preferences$
DECLARE choice record;
BEGIN
 IF NEW.boss_preferences IS NOT DISTINCT FROM OLD.boss_preferences THEN RETURN NEW; END IF;
 IF NEW.boss_preferences IS NULL OR jsonb_typeof(NEW.boss_preferences) <> 'object' OR
    octet_length(NEW.boss_preferences::text) > 16384
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local boss preferences'; END IF;
 FOR choice IN SELECT key,value FROM jsonb_each(NEW.boss_preferences) LOOP
  IF choice.value NOT IN ('"preferred"'::jsonb,'"avoid"'::jsonb) OR
    NOT EXISTS(SELECT 1 FROM public.boss_mapping b WHERE
      choice.key='main_'||b.boss_type OR
      choice.key=CASE WHEN b.encounter_index>0 THEN 'side_' ELSE 'main_' END||b.boss_name)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local boss preference choice'; END IF;
 END LOOP;
 NEW.preferences_updated_at=statement_timestamp();
 RETURN NEW;
END $preferences$;
REVOKE ALL ON FUNCTION public.desktop_validate_boss_preferences() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_boss_preferences_write BEFORE UPDATE OF boss_preferences ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_boss_preferences();
GRANT UPDATE(boss_preferences) ON public.current_user_player_mapping TO authenticated;

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

-- Canonical roster read model and an explicit, unverified local own-key cache.
CREATE TABLE public.player_roster (
    id bigint NOT NULL,
    user_id uuid,
    hero_mapping_id integer,
    rank_name text NOT NULL,
    stars integer DEFAULT 0,
    crit_item_id text,
    crit_item_level integer,
    booster_item_id text,
    booster_item_level integer,
    defensive_item_id text,
    defensive_item_level integer,
    synced_at timestamp with time zone DEFAULT now(),
    rarity text,
    xp integer,
    xp_level integer,
    progression_index integer,
    shards integer,
    mythic_shards integer,
    active_ability_level integer,
    passive_ability_level integer,
    upgrades integer[],
    player_mapping_id integer
);

CREATE SEQUENCE public.player_roster_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.hero_mappings ADD PRIMARY KEY (id);
ALTER TABLE public.hero_mappings ADD UNIQUE (unit_id);
ALTER SEQUENCE public.player_roster_id_seq OWNED BY public.player_roster.id;
ALTER TABLE public.player_roster ALTER COLUMN id SET DEFAULT nextval('public.player_roster_id_seq'::regclass);
ALTER TABLE public.player_roster ADD PRIMARY KEY (id);
ALTER TABLE public.player_roster ADD UNIQUE (user_id,hero_mapping_id);
CREATE UNIQUE INDEX player_roster_mapping_hero_key ON public.player_roster(player_mapping_id,hero_mapping_id);
ALTER TABLE public.player_roster ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.player_roster ADD FOREIGN KEY (hero_mapping_id) REFERENCES public.hero_mappings(id) ON DELETE CASCADE;
ALTER TABLE public.player_roster ADD FOREIGN KEY (player_mapping_id) REFERENCES public.player_mapping(id) ON DELETE CASCADE;
ALTER TABLE public.player_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_roster FORCE ROW LEVEL SECURITY;
CREATE ROLE desktop_roster_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_roster_writer;
GRANT EXECUTE ON FUNCTION auth.uid() TO desktop_roster_writer;
REVOKE ALL ON public.player_roster FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.player_roster TO authenticated,service_role;
GRANT SELECT ON public.player_roster TO desktop_roster_writer;
GRANT INSERT,UPDATE,DELETE ON public.player_roster TO desktop_roster_writer;
REVOKE ALL ON SEQUENCE public.player_roster_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.player_roster_id_seq TO desktop_roster_writer;
GRANT SELECT (id,unit_id) ON public.hero_mappings TO desktop_roster_writer;
CREATE POLICY desktop_roster_catalog ON public.hero_mappings FOR SELECT TO desktop_roster_writer USING (true);
GRANT SELECT (subject_user_id,guild_code,identity_mode,singleton) ON public.desktop_preview_setup TO desktop_roster_writer;
CREATE POLICY desktop_roster_setup ON public.desktop_preview_setup FOR SELECT TO desktop_roster_writer USING (subject_user_id=auth.uid());
GRANT SELECT (id,user_id,guild_code,is_current) ON public.player_mapping TO desktop_roster_writer;
GRANT UPDATE (player_power,updated_at) ON public.player_mapping TO desktop_roster_writer;
CREATE POLICY desktop_roster_mapping ON public.player_mapping TO desktop_roster_writer USING (user_id=auth.uid() AND is_current) WITH CHECK (user_id=auth.uid() AND is_current);
CREATE POLICY desktop_roster_read ON public.player_roster FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY desktop_roster_write ON public.player_roster TO desktop_roster_writer USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND player_mapping_id IS NULL);

CREATE TABLE public.desktop_roster_snapshots (
  subject_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  guild_code text NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text)<=8388608),
  source text NOT NULL DEFAULT 'official-own-key-local-claim' CHECK (source='official-own-key-local-claim'),
  cached_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.desktop_roster_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_roster_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.desktop_roster_snapshots FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.desktop_roster_snapshots TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.desktop_roster_snapshots TO desktop_roster_writer;
CREATE POLICY desktop_roster_snapshot_read ON public.desktop_roster_snapshots FOR SELECT TO authenticated USING (subject_user_id=auth.uid());
CREATE POLICY desktop_roster_snapshot_write ON public.desktop_roster_snapshots TO desktop_roster_writer USING (subject_user_id=auth.uid()) WITH CHECK (subject_user_id=auth.uid());

CREATE FUNCTION public.desktop_save_roster(p_snapshot jsonb,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $roster$
DECLARE target text; count_units integer; count_rows integer;
BEGIN
 SELECT s.guild_code INTO STRICT target FROM public.desktop_preview_setup s WHERE s.singleton AND s.subject_user_id=auth.uid() AND s.identity_mode='local-file';
 IF target IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR
    p_snapshot->>'format' IS DISTINCT FROM 'ta-official-roster-v1' OR p_snapshot->>'guildCode' IS DISTINCT FROM target OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_snapshot) AS keys(name) WHERE name NOT IN ('format','guildCode','playerName','powerLevel','units','machinesOfWar')) OR
    jsonb_typeof(p_snapshot->'playerName') IS DISTINCT FROM 'string' OR length(p_snapshot->>'playerName') NOT BETWEEN 1 AND 128 OR
    jsonb_typeof(p_snapshot->'powerLevel') IS DISTINCT FROM 'number' OR
    jsonb_typeof(p_snapshot->'units') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'machinesOfWar') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_snapshot->'units')>1024 OR jsonb_array_length(p_snapshot->'machinesOfWar')>128 OR
    octet_length(p_snapshot::text)>8388608 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 IF (p_snapshot->>'powerLevel')::bigint NOT BETWEEN 0 AND 2147483647 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE
     jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'id' IS NULL OR u->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR
     u->>'progressionIndex' IS NULL OR (u->>'progressionIndex')::integer NOT BETWEEN 0 AND 15 OR
     u->>'rank' IS NULL OR (u->>'rank')::integer NOT BETWEEN 0 AND 17 OR
     u->>'xpLevel' IS NULL OR (u->>'xpLevel')::integer NOT BETWEEN 1 AND 50 OR
     u->>'xp' IS NULL OR (u->>'xp')::integer<0 OR u->>'shards' IS NULL OR (u->>'shards')::integer<0 OR u->>'mythicShards' IS NULL OR (u->>'mythicShards')::integer<0 OR
     jsonb_typeof(u->'abilities') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'abilities')>2 OR
     jsonb_typeof(u->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'items')>3 OR
     jsonb_typeof(u->'upgrades') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'upgrades')>6
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 count_rows:=jsonb_array_length(p_rows);
 SELECT count(DISTINCT value->>'id') INTO count_units FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar'));
 IF count_rows>count_units OR count_rows>1152 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.hero_mappings h ON h.id=(r->>'hero_mapping_id')::integer
   WHERE h.id IS NULL OR h.unit_id IS DISTINCT FROM r->>'source_unit_id' OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE u->>'id'=h.unit_id)
 ) OR EXISTS (
   SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r WHERE
     r.user_id IS DISTINCT FROM auth.uid() OR r.player_mapping_id IS NOT NULL OR r.hero_mapping_id IS NULL OR
     r.rank_name IS NULL OR length(r.rank_name) NOT BETWEEN 1 AND 32 OR
     r.stars IS NULL OR r.stars NOT BETWEEN 0 AND 15 OR r.progression_index IS NULL OR r.progression_index NOT BETWEEN 0 AND 15 OR
     r.rarity IS NULL OR r.rarity NOT IN ('Common','Uncommon','Rare','Epic','Legendary','Mythic') OR
     r.xp IS NULL OR r.xp<0 OR r.xp_level IS NULL OR r.xp_level NOT BETWEEN 1 AND 50 OR
     r.shards IS NULL OR r.shards<0 OR r.mythic_shards IS NULL OR r.mythic_shards<0 OR
     (r.active_ability_level IS NOT NULL AND r.active_ability_level NOT BETWEEN 0 AND 50) OR
     (r.passive_ability_level IS NOT NULL AND r.passive_ability_level NOT BETWEEN 0 AND 50) OR
     (r.crit_item_level IS NOT NULL AND r.crit_item_level NOT BETWEEN 1 AND 11) OR
     (r.defensive_item_level IS NOT NULL AND r.defensive_item_level NOT BETWEEN 1 AND 11) OR
     (r.booster_item_level IS NOT NULL AND r.booster_item_level NOT BETWEEN 1 AND 11) OR
     r.upgrades IS NULL OR cardinality(r.upgrades)>6 OR EXISTS (SELECT 1 FROM unnest(r.upgrades) value WHERE value IS NULL OR value NOT BETWEEN 0 AND 5)
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 PERFORM pg_advisory_xact_lock(74832020);
 DELETE FROM public.player_roster r WHERE r.user_id=auth.uid() AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) n WHERE n.hero_mapping_id=r.hero_mapping_id);
 INSERT INTO public.player_roster(user_id,hero_mapping_id,rank_name,stars,crit_item_id,crit_item_level,booster_item_id,booster_item_level,defensive_item_id,defensive_item_level,synced_at,rarity,xp,xp_level,progression_index,shards,mythic_shards,active_ability_level,passive_ability_level,upgrades)
 SELECT r.user_id,r.hero_mapping_id,r.rank_name,r.stars,r.crit_item_id,r.crit_item_level,r.booster_item_id,r.booster_item_level,r.defensive_item_id,r.defensive_item_level,now(),r.rarity,r.xp,r.xp_level,r.progression_index,r.shards,r.mythic_shards,r.active_ability_level,r.passive_ability_level,r.upgrades FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r
 ON CONFLICT (user_id,hero_mapping_id) DO UPDATE SET rank_name=EXCLUDED.rank_name,stars=EXCLUDED.stars,crit_item_id=EXCLUDED.crit_item_id,crit_item_level=EXCLUDED.crit_item_level,booster_item_id=EXCLUDED.booster_item_id,booster_item_level=EXCLUDED.booster_item_level,defensive_item_id=EXCLUDED.defensive_item_id,defensive_item_level=EXCLUDED.defensive_item_level,synced_at=EXCLUDED.synced_at,rarity=EXCLUDED.rarity,xp=EXCLUDED.xp,xp_level=EXCLUDED.xp_level,progression_index=EXCLUDED.progression_index,shards=EXCLUDED.shards,mythic_shards=EXCLUDED.mythic_shards,active_ability_level=EXCLUDED.active_ability_level,passive_ability_level=EXCLUDED.passive_ability_level,upgrades=EXCLUDED.upgrades;
 UPDATE public.player_mapping SET player_power=(p_snapshot->>'powerLevel')::integer,updated_at=now() WHERE user_id=auth.uid() AND is_current AND guild_code=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Local roster subject changed'; END IF;
 INSERT INTO public.desktop_roster_snapshots(subject_user_id,guild_code,payload) VALUES(auth.uid(),target,p_snapshot)
 ON CONFLICT(subject_user_id) DO UPDATE SET guild_code=EXCLUDED.guild_code,payload=EXCLUDED.payload,cached_at=now();
 RETURN jsonb_build_object('units',count_units,'mapped',count_rows,'unmapped',count_units-count_rows);
END $roster$;
ALTER FUNCTION public.desktop_save_roster(jsonb,jsonb) OWNER TO desktop_roster_writer;
REVOKE ALL ON FUNCTION public.desktop_save_roster(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_save_roster(jsonb,jsonb) TO desktop_owner;

-- Local planner links are editable only through the canonical owner projection.
-- Validate this column's writes without rejecting unrelated updates to legacy rows.
CREATE FUNCTION public.desktop_validate_planner_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $planner$
BEGIN
 IF NEW.tacticus_share_url IS NOT NULL AND (
   length(NEW.tacticus_share_url) NOT BETWEEN 1 AND 2048 OR
   NEW.tacticus_share_url !~ '^https?://[^/?#[:space:]@]+([/?#][^[:cntrl:]]*)?$'
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local planner link'; END IF;
 RETURN NEW;
END $planner$;
REVOKE ALL ON FUNCTION public.desktop_validate_planner_link() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_planner_link_write BEFORE UPDATE OF tacticus_share_url ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_planner_link();
GRANT UPDATE (tacticus_share_url) ON public.current_user_player_mapping TO authenticated;

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

CREATE TABLE public.gdpr_data_exports (
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    data_package jsonb,
    download_url text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gdpr_data_exports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);

CREATE TABLE public.gdpr_processing_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    data_type text NOT NULL,
    processing_purpose text NOT NULL,
    legal_basis text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    retention_until timestamp with time zone,
    consent_given boolean,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gdpr_processing_log_legal_basis_check CHECK ((legal_basis = ANY (ARRAY['consent'::text, 'contract'::text, 'legal_obligation'::text, 'vital_interests'::text, 'public_task'::text, 'legitimate_interest'::text])))
);

CREATE TABLE public.user_token_alert_prefs (
    user_id uuid NOT NULL,
    alert_on_full boolean DEFAULT false NOT NULL,
    alert_before_full boolean DEFAULT false NOT NULL,
    alert_before_full_minutes integer DEFAULT 120 NOT NULL,
    alert_on_token_gained boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    alert_on_bomb_ready boolean DEFAULT false NOT NULL,
    alert_before_bomb_ready boolean DEFAULT false NOT NULL,
    alert_before_bomb_ready_minutes integer DEFAULT 120 NOT NULL,
    quiet_hours_start smallint,
    quiet_hours_end smallint,
    quiet_hours_timezone text,
    alert_on_full_repeat_hours integer,
    alert_before_quiet_hours boolean DEFAULT false NOT NULL,
    alert_before_quiet_hours_minutes integer DEFAULT 30 NOT NULL,
    alert_before_burn boolean DEFAULT false NOT NULL,
    alert_before_burn_minutes integer DEFAULT 30 NOT NULL,
    CONSTRAINT user_token_alert_prefs_bomb_minutes_range CHECK (((alert_before_bomb_ready_minutes >= 15) AND (alert_before_bomb_ready_minutes <= 960))),
    CONSTRAINT user_token_alert_prefs_burn_minutes_range CHECK (((alert_before_burn_minutes >= 15) AND (alert_before_burn_minutes <= 360))),
    CONSTRAINT user_token_alert_prefs_full_repeat_hours_range CHECK (((alert_on_full_repeat_hours IS NULL) OR ((alert_on_full_repeat_hours >= 11) AND (alert_on_full_repeat_hours <= 168)))),
    CONSTRAINT user_token_alert_prefs_full_repeat_requires_full CHECK ((alert_on_full OR (alert_on_full_repeat_hours IS NULL))),
    CONSTRAINT user_token_alert_prefs_minutes_range CHECK (((alert_before_full_minutes >= 15) AND (alert_before_full_minutes <= 720))),
    CONSTRAINT user_token_alert_prefs_pre_quiet_minutes_range CHECK (((alert_before_quiet_hours_minutes >= 15) AND (alert_before_quiet_hours_minutes <= 180))),
    CONSTRAINT user_token_alert_prefs_pre_quiet_requires_quiet_hours CHECK (((NOT alert_before_quiet_hours) OR (quiet_hours_start IS NOT NULL))),
    CONSTRAINT user_token_alert_prefs_quiet_end_range CHECK (((quiet_hours_end >= 0) AND (quiet_hours_end <= 23))),
    CONSTRAINT user_token_alert_prefs_quiet_hours_complete CHECK ((num_nonnulls(quiet_hours_start, quiet_hours_end, quiet_hours_timezone) = ANY (ARRAY[0, 3]))),
    CONSTRAINT user_token_alert_prefs_quiet_start_range CHECK (((quiet_hours_start >= 0) AND (quiet_hours_start <= 23))),
    CONSTRAINT user_token_alert_prefs_quiet_tz_length CHECK (((quiet_hours_timezone IS NULL) OR ((length(quiet_hours_timezone) >= 1) AND (length(quiet_hours_timezone) <= 64))))
);

CREATE TABLE public.user_token_alert_state (
    user_id uuid NOT NULL,
    last_tokens integer,
    last_time_to_full_seconds integer,
    last_scan_at timestamp with time zone,
    last_full_alert_at timestamp with time zone,
    last_prewarn_alert_at timestamp with time zone,
    last_gain_alert_at timestamp with time zone,
    consecutive_dm_failures integer DEFAULT 0 NOT NULL,
    dm_blocked_at timestamp with time zone,
    dm_channel_id text,
    dm_channel_recipient_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_bombs integer,
    last_time_to_bomb_seconds integer,
    last_bomb_ready_alert_at timestamp with time zone,
    last_bomb_prewarn_alert_at timestamp with time zone,
    quiet_hours_deferred_since timestamp with time zone,
    capped_since timestamp with time zone,
    last_pre_quiet_alert_at timestamp with time zone,
    last_burn_prewarn_alert_at timestamp with time zone
);

CREATE FUNCTION public.get_user_data_for_export(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
    result JSONB;
    user_data JSONB;
    player_data JSONB;
    battle_data JSONB;
    processing_data JSONB;
    alert_prefs_data JSONB;
    alert_state_data JSONB;
    caller_uid UUID;
BEGIN
    caller_uid := auth.uid();

    IF caller_uid IS NULL AND current_setting('role', true) <> 'service_role' THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    IF caller_uid IS NOT NULL AND caller_uid <> p_user_id THEN
        RAISE EXCEPTION 'Forbidden: can only export your own data'
            USING ERRCODE = '42501';
    END IF;

    SELECT to_jsonb(auth.users.*) INTO user_data
    FROM auth.users
    WHERE id = p_user_id;

    SELECT jsonb_agg(to_jsonb(pm.*)) INTO player_data
    FROM player_mapping pm
    WHERE pm.user_id = p_user_id;

    SELECT jsonb_agg(battle_subset.*)
    INTO battle_data
    FROM (
        SELECT gr.*
        FROM "EOT_GR_data" gr
        JOIN player_mapping pm ON gr."displayName" = pm.display_name
        WHERE pm.user_id = p_user_id
        ORDER BY COALESCE(gr."completedOn", gr."timestamp") DESC
        LIMIT 1000
    ) battle_subset;

    SELECT jsonb_agg(processing_subset.*)
    INTO processing_data
    FROM (
        SELECT gpl.*
        FROM gdpr_processing_log gpl
        WHERE gpl.user_id = p_user_id
        ORDER BY gpl.timestamp DESC
        LIMIT 100
    ) processing_subset;

    SELECT to_jsonb(utap.*) INTO alert_prefs_data
    FROM user_token_alert_prefs utap
    WHERE utap.user_id = p_user_id;

    SELECT to_jsonb(utas.*) INTO alert_state_data
    FROM user_token_alert_state utas
    WHERE utas.user_id = p_user_id;

    result := jsonb_build_object(
        'export_generated_at', NOW(),
        'user_id', p_user_id,
        'data', jsonb_build_object(
            'profile', COALESCE(user_data, '{}'),
            'player_mappings', COALESCE(player_data, '[]'),
            'battle_data', COALESCE(battle_data, '[]'),
            'processing_history', COALESCE(processing_data, '[]'),
            'token_alert_preferences', COALESCE(alert_prefs_data, '{}'),
            'token_alert_state', COALESCE(alert_state_data, '{}')
        ),
        'data_summary', jsonb_build_object(
            'total_battles', COALESCE(jsonb_array_length(battle_data), 0),
            'total_players', COALESCE(jsonb_array_length(player_data), 0),
            'data_retention_info', 'Battle data: indefinite, Processing logs: 7 years'
        )
    );

    RETURN result;
END;
$$;

-- Local exports use canonical request shapes and a restricted local reader.
ALTER TABLE public.gdpr_data_exports ADD PRIMARY KEY(request_id);
ALTER TABLE public.gdpr_data_exports ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.gdpr_data_exports ADD COLUMN processing_started_at timestamptz;
ALTER TABLE public.gdpr_data_exports ADD CONSTRAINT desktop_export_package_bound CHECK(data_package IS NULL OR (jsonb_typeof(data_package)='object' AND octet_length(data_package::text)<=16777216));
ALTER TABLE public.gdpr_data_exports ADD CONSTRAINT desktop_export_download_path CHECK(download_url IS NULL OR download_url='/api/gdpr/my-data/'||request_id::text||'/download');
ALTER TABLE public.gdpr_processing_log ADD PRIMARY KEY(id);
ALTER TABLE public.gdpr_processing_log ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_token_alert_prefs ADD PRIMARY KEY(user_id);
ALTER TABLE public.user_token_alert_prefs ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_token_alert_state ADD PRIMARY KEY(user_id);
ALTER TABLE public.user_token_alert_state ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.gdpr_data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_data_exports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_processing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_processing_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_prefs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_data_exports,public.gdpr_processing_log,public.user_token_alert_prefs,public.user_token_alert_state FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE ROLE desktop_export_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_export_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO desktop_export_reader;
GRANT SELECT(subject_user_id,guild_code,singleton) ON public.desktop_preview_setup TO desktop_export_reader;
CREATE POLICY desktop_export_context ON public.desktop_preview_setup FOR SELECT TO desktop_export_reader USING(singleton AND (subject_user_id=auth.uid() OR auth.jwt()->>'role'='service_role'));
CREATE FUNCTION public.desktop_personal_export_subject() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $subject$
 SELECT subject_user_id FROM public.desktop_preview_setup WHERE singleton;
$subject$;
ALTER FUNCTION public.desktop_personal_export_subject() OWNER TO desktop_export_reader;
REVOKE ALL ON FUNCTION public.desktop_personal_export_subject() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_personal_export_subject() TO authenticated,service_role,desktop_export_reader;
GRANT SELECT(id,email,created_at,last_sign_in_at) ON auth.users TO desktop_export_reader;
CREATE POLICY desktop_export_auth_profile ON auth.users FOR SELECT TO desktop_export_reader USING(id=public.desktop_personal_export_subject());
GRANT SELECT ON public.player_mapping,public."EOT_GR_data",public.gdpr_processing_log,public.user_token_alert_prefs,public.user_token_alert_state,public.player_roster,public.player_achievements,public.player_meta_roles,public.desktop_roster_snapshots TO desktop_export_reader;
CREATE POLICY desktop_export_mapping ON public.player_mapping FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_battle ON public."EOT_GR_data" FOR SELECT TO desktop_export_reader USING(EXISTS(SELECT 1 FROM public.player_mapping p WHERE p.user_id=public.desktop_personal_export_subject() AND p.player_id="EOT_GR_data"."userId" AND p.guild_code="EOT_GR_data"."Guild"));
CREATE POLICY desktop_export_roster ON public.player_roster FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_achievements ON public.player_achievements FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_meta ON public.player_meta_roles FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_roster_snapshot ON public.desktop_roster_snapshots FOR SELECT TO desktop_export_reader USING(subject_user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_processing ON public.gdpr_processing_log FOR SELECT TO desktop_export_reader,service_role USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_processing_write ON public.gdpr_processing_log FOR INSERT TO service_role WITH CHECK(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_alert_preferences ON public.user_token_alert_prefs FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_alert_state ON public.user_token_alert_state FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
GRANT SELECT ON public.gdpr_data_exports TO authenticated,service_role;
GRANT INSERT(user_id) ON public.gdpr_data_exports TO authenticated;
GRANT UPDATE(status,processing_started_at,completed_at,data_package,download_url,expires_at) ON public.gdpr_data_exports TO service_role;
GRANT SELECT,INSERT ON public.gdpr_processing_log TO service_role;
CREATE POLICY desktop_export_request_read ON public.gdpr_data_exports FOR SELECT TO authenticated USING(user_id=public.desktop_personal_export_subject() AND user_id=auth.uid() AND (expires_at IS NULL OR expires_at>statement_timestamp()));
CREATE POLICY desktop_export_request_create ON public.gdpr_data_exports FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_request_worker ON public.gdpr_data_exports TO service_role USING(user_id=public.desktop_personal_export_subject()) WITH CHECK(user_id=public.desktop_personal_export_subject());
CREATE OR REPLACE FUNCTION public.get_user_data_for_export(p_user_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $export$
DECLARE profile jsonb; mappings jsonb; battles jsonb; processing jsonb; prefs jsonb; state jsonb; roster jsonb; achievements jsonb; memberships jsonb;
BEGIN
 IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM public.desktop_personal_export_subject() THEN
  RAISE EXCEPTION 'Local export subject refused' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('id',id,'email',email,'created_at',created_at,'last_sign_in_at',last_sign_in_at) INTO profile FROM auth.users WHERE id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) INTO mappings FROM (
  SELECT id,user_id,player_id,display_name,guild_code,is_current,role,timezone,discord_username,theme_preference,tacticus_share_url,primary_team,secondary_team,tertiary_team,boss_preferences,preferences_updated_at,avatar_unit_id FROM public.player_mapping WHERE user_id=p_user_id
 ) p;
 SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) INTO battles FROM (
  SELECT r.* FROM public."EOT_GR_data" r WHERE EXISTS(SELECT 1 FROM public.player_mapping p WHERE p.user_id=p_user_id AND p.player_id=r."userId" AND p.guild_code=r."Guild") ORDER BY coalesce(r."completedOn",r."timestamp") DESC,r.id DESC LIMIT 1000
 ) b;
 SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO processing FROM (SELECT l.* FROM public.gdpr_processing_log l WHERE user_id=p_user_id ORDER BY "timestamp" DESC,id DESC LIMIT 100) p;
 SELECT to_jsonb(p) INTO prefs FROM public.user_token_alert_prefs p WHERE user_id=p_user_id;
 SELECT to_jsonb(s) INTO state FROM public.user_token_alert_state s WHERE user_id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) INTO roster FROM public.player_roster r WHERE user_id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY achievement_key),'[]'::jsonb) INTO achievements FROM public.player_achievements a WHERE user_id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) INTO memberships FROM public.player_meta_roles m WHERE user_id=p_user_id;
 RETURN jsonb_build_object('export_generated_at',statement_timestamp(),'user_id',p_user_id,'data',jsonb_build_object(
  'profile',coalesce(profile,'{}'::jsonb),'player_mappings',mappings,'battle_data',battles,'processing_history',processing,
  'token_alert_preferences',coalesce(prefs,'{}'::jsonb),'token_alert_state',coalesce(state,'{}'::jsonb),
  'local_roster',roster,'local_achievements',achievements,'local_meta_memberships',memberships,
  'local_roster_snapshot',(SELECT payload FROM public.desktop_roster_snapshots WHERE subject_user_id=p_user_id),
  'identity_verification',jsonb_build_object('scope','local-workspace','game_account_verified',false)),
  'data_summary',jsonb_build_object('total_battles',jsonb_array_length(battles),'total_players',jsonb_array_length(mappings),'battle_limit',1000,'processing_history_limit',100));
END $export$;
ALTER FUNCTION public.get_user_data_for_export(uuid) OWNER TO desktop_export_reader;
REVOKE ALL ON FUNCTION public.get_user_data_for_export(uuid) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_user_data_for_export(uuid) TO authenticated,service_role;
ALTER TABLE public.work_queue DROP CONSTRAINT desktop_local_job_type;
ALTER TABLE public.work_queue ADD CONSTRAINT desktop_local_job_type CHECK(job_type IN ('refresh-explore-snapshots','refresh-local-achievements','export-local-profile-data'));

-- Update the local roster projection for Mythic units and third machine abilities.
CREATE OR REPLACE FUNCTION public.desktop_save_roster(p_snapshot jsonb,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $roster$
DECLARE target text; count_units integer; count_rows integer;
BEGIN
 SELECT s.guild_code INTO STRICT target FROM public.desktop_preview_setup s WHERE s.singleton AND s.subject_user_id=auth.uid() AND s.identity_mode='local-file';
 IF target IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR
    p_snapshot->>'format' IS DISTINCT FROM 'ta-official-roster-v1' OR p_snapshot->>'guildCode' IS DISTINCT FROM target OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_snapshot) AS keys(name) WHERE name NOT IN ('format','guildCode','playerName','powerLevel','units','machinesOfWar')) OR
    jsonb_typeof(p_snapshot->'playerName') IS DISTINCT FROM 'string' OR length(p_snapshot->>'playerName') NOT BETWEEN 1 AND 128 OR
    jsonb_typeof(p_snapshot->'powerLevel') IS DISTINCT FROM 'number' OR
    jsonb_typeof(p_snapshot->'units') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'machinesOfWar') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_snapshot->'units')>1024 OR jsonb_array_length(p_snapshot->'machinesOfWar')>128 OR
    octet_length(p_snapshot::text)>8388608 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 IF (p_snapshot->>'powerLevel')::bigint NOT BETWEEN 0 AND 2147483647 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE
     jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'id' IS NULL OR u->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR
     u->>'progressionIndex' IS NULL OR (u->>'progressionIndex')::integer NOT BETWEEN 0 AND 19 OR
     u->>'rank' IS NULL OR (u->>'rank')::integer NOT BETWEEN 0 AND 23 OR
     u->>'xpLevel' IS NULL OR (u->>'xpLevel')::integer NOT BETWEEN 1 AND 32767 OR
     u->>'xp' IS NULL OR (u->>'xp')::integer<0 OR u->>'shards' IS NULL OR (u->>'shards')::integer<0 OR u->>'mythicShards' IS NULL OR (u->>'mythicShards')::integer<0 OR
     jsonb_typeof(u->'abilities') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'abilities')>3 OR
     jsonb_typeof(u->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'items')>3 OR
     jsonb_typeof(u->'upgrades') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'upgrades')>6
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 count_rows:=jsonb_array_length(p_rows);
 SELECT count(DISTINCT value->>'id') INTO count_units FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar'));
 IF count_rows>count_units OR count_rows>1152 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.hero_mappings h ON h.id=(r->>'hero_mapping_id')::integer
   WHERE h.id IS NULL OR h.unit_id IS DISTINCT FROM r->>'source_unit_id' OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE u->>'id'=h.unit_id)
 ) OR EXISTS (
   SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r WHERE
     r.user_id IS DISTINCT FROM auth.uid() OR r.player_mapping_id IS NOT NULL OR r.hero_mapping_id IS NULL OR
     r.rank_name IS NULL OR length(r.rank_name) NOT BETWEEN 1 AND 32 OR
     r.stars IS NULL OR r.stars NOT BETWEEN 0 AND 19 OR r.progression_index IS NULL OR r.progression_index NOT BETWEEN 0 AND 19 OR
     r.rarity IS NULL OR r.rarity NOT IN ('Common','Uncommon','Rare','Epic','Legendary','Mythic') OR
     r.xp IS NULL OR r.xp<0 OR r.xp_level IS NULL OR r.xp_level NOT BETWEEN 1 AND 32767 OR
     r.shards IS NULL OR r.shards<0 OR r.mythic_shards IS NULL OR r.mythic_shards<0 OR
     (r.active_ability_level IS NOT NULL AND r.active_ability_level NOT BETWEEN 0 AND 32767) OR
     (r.passive_ability_level IS NOT NULL AND r.passive_ability_level NOT BETWEEN 0 AND 32767) OR
     (r.crit_item_level IS NOT NULL AND r.crit_item_level NOT BETWEEN 1 AND 32767) OR
     (r.defensive_item_level IS NOT NULL AND r.defensive_item_level NOT BETWEEN 1 AND 32767) OR
     (r.booster_item_level IS NOT NULL AND r.booster_item_level NOT BETWEEN 1 AND 32767) OR
     r.upgrades IS NULL OR cardinality(r.upgrades)>6 OR EXISTS (SELECT 1 FROM unnest(r.upgrades) value WHERE value IS NULL OR value NOT BETWEEN 0 AND 5)
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 PERFORM pg_advisory_xact_lock(74832020);
 DELETE FROM public.player_roster r WHERE r.user_id=auth.uid() AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) n WHERE n.hero_mapping_id=r.hero_mapping_id);
 INSERT INTO public.player_roster(user_id,hero_mapping_id,rank_name,stars,crit_item_id,crit_item_level,booster_item_id,booster_item_level,defensive_item_id,defensive_item_level,synced_at,rarity,xp,xp_level,progression_index,shards,mythic_shards,active_ability_level,passive_ability_level,upgrades)
 SELECT r.user_id,r.hero_mapping_id,r.rank_name,r.stars,r.crit_item_id,r.crit_item_level,r.booster_item_id,r.booster_item_level,r.defensive_item_id,r.defensive_item_level,now(),r.rarity,r.xp,r.xp_level,r.progression_index,r.shards,r.mythic_shards,r.active_ability_level,r.passive_ability_level,r.upgrades FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r
 ON CONFLICT (user_id,hero_mapping_id) DO UPDATE SET rank_name=EXCLUDED.rank_name,stars=EXCLUDED.stars,crit_item_id=EXCLUDED.crit_item_id,crit_item_level=EXCLUDED.crit_item_level,booster_item_id=EXCLUDED.booster_item_id,booster_item_level=EXCLUDED.booster_item_level,defensive_item_id=EXCLUDED.defensive_item_id,defensive_item_level=EXCLUDED.defensive_item_level,synced_at=EXCLUDED.synced_at,rarity=EXCLUDED.rarity,xp=EXCLUDED.xp,xp_level=EXCLUDED.xp_level,progression_index=EXCLUDED.progression_index,shards=EXCLUDED.shards,mythic_shards=EXCLUDED.mythic_shards,active_ability_level=EXCLUDED.active_ability_level,passive_ability_level=EXCLUDED.passive_ability_level,upgrades=EXCLUDED.upgrades;
 UPDATE public.player_mapping SET player_power=(p_snapshot->>'powerLevel')::integer,updated_at=now() WHERE user_id=auth.uid() AND is_current AND guild_code=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Local roster subject changed'; END IF;
 INSERT INTO public.desktop_roster_snapshots(subject_user_id,guild_code,payload) VALUES(auth.uid(),target,p_snapshot)
 ON CONFLICT(subject_user_id) DO UPDATE SET guild_code=EXCLUDED.guild_code,payload=EXCLUDED.payload,cached_at=now();
 RETURN jsonb_build_object('units',count_units,'mapped',count_rows,'unmapped',count_units-count_rows);
END $roster$;
ALTER FUNCTION public.desktop_save_roster(jsonb,jsonb) OWNER TO desktop_roster_writer;
REVOKE ALL ON FUNCTION public.desktop_save_roster(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_save_roster(jsonb,jsonb) TO desktop_owner;


-- Add the source-pinned canonical team-roster projection and scoped local reader.
CREATE FUNCTION public.get_guild_team_roster(p_guild_code text, p_unit_ids text[]) RETURNS TABLE(player_display_name text, guild_role text, unit_id text, hero_display_name text, category text, web_icon_url text, stars integer, progression_index integer, rarity text, rank_name text, xp_level integer, active_ability_level integer, passive_ability_level integer, synced_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_effective_role text := COALESCE(
    NULLIF(
      NULLIF(pg_catalog.current_setting('role', true), ''),
      'none'
    ),
    NULLIF(session_user, '')
  );
  v_uid uuid;
  v_mapping_count integer := 0;
  v_mapping record;
  v_caller_guild_code text;
  v_caller_role text;
  v_caller_is_app_admin boolean := false;
  v_caller_config_count integer := 0;
  v_caller_config record;
  v_caller_cluster_id uuid;
  v_target_config_count integer := 0;
  v_target_config record;
  v_target_cluster_id uuid;
  v_self_only boolean := false;
BEGIN
  -- Malformed or unscoped requests never enter the private roster query.
  IF p_guild_code IS NULL
     OR p_unit_ids IS NULL
     OR pg_catalog.cardinality(p_unit_ids) = 0 THEN
    RETURN;
  END IF;

  -- A target must resolve to exactly one server-owned guild_config row.
  BEGIN
    FOR v_target_config IN
      SELECT gc.cluster_id
      FROM public.guild_config AS gc
      WHERE gc.guild_code = p_guild_code
    LOOP
      v_target_config_count := v_target_config_count + 1;
      IF v_target_config_count > 1 THEN
        RETURN;
      END IF;
      v_target_cluster_id := v_target_config.cluster_id;
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN;
  END;

  IF v_target_config_count <> 1 THEN
    RETURN;
  END IF;

  IF v_effective_role <> 'service_role' THEN
    -- auth.uid() and membership lookup errors fail closed before roster reads.
    BEGIN
      v_uid := auth.uid();
      IF v_uid IS NULL THEN
        RETURN;
      END IF;

      FOR v_mapping IN
        SELECT
          pm.guild_code,
          pg_catalog.lower(pg_catalog.btrim(pm.role::text)) AS normalized_role,
          COALESCE(pm.is_app_admin, false) AS is_app_admin
        FROM public.player_mapping AS pm
        WHERE pm.user_id = v_uid
          AND pm.is_current IS TRUE
      LOOP
        v_mapping_count := v_mapping_count + 1;
        IF v_mapping_count > 1 THEN
          RETURN;
        END IF;
        v_caller_guild_code := v_mapping.guild_code;
        v_caller_role := v_mapping.normalized_role;
        v_caller_is_app_admin := v_mapping.is_app_admin;
      END LOOP;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN;
    END;

    IF v_mapping_count <> 1
       OR v_caller_guild_code IS NULL
       OR v_caller_role IS NULL
       OR v_caller_role NOT IN ('member', 'officer', 'leader') THEN
      RETURN;
    END IF;

    IF v_caller_is_app_admin THEN
      -- Current app-admins retain the full requested-guild projection.
      NULL;
    ELSIF v_caller_role = 'member' THEN
      -- Ordinary members may see only their own row in their own guild.
      IF p_guild_code IS DISTINCT FROM v_caller_guild_code THEN
        RETURN;
      END IF;
      v_self_only := true;
    ELSIF p_guild_code IS DISTINCT FROM v_caller_guild_code THEN
      -- Officer/leader foreign-guild access requires an exact, non-null,
      -- server-derived cluster match for the current and target guilds.
      BEGIN
        FOR v_caller_config IN
          SELECT gc.cluster_id
          FROM public.guild_config AS gc
          WHERE gc.guild_code = v_caller_guild_code
        LOOP
          v_caller_config_count := v_caller_config_count + 1;
          IF v_caller_config_count > 1 THEN
            RETURN;
          END IF;
          v_caller_cluster_id := v_caller_config.cluster_id;
        END LOOP;
      EXCEPTION
        WHEN OTHERS THEN
          RETURN;
      END;

      IF v_caller_config_count <> 1
         OR v_caller_cluster_id IS NULL
         OR v_target_cluster_id IS NULL
         OR v_caller_cluster_id IS DISTINCT FROM v_target_cluster_id THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      pm.display_name,
      pm.role::text,
      hm.unit_id,
      hm.display_name,
      hm.category,
      hm.web_icon_url,
      pr.stars,
      pr.progression_index,
      pr.rarity,
      pr.rank_name,
      pr.xp_level,
      pr.active_ability_level,
      pr.passive_ability_level,
      pr.synced_at
    FROM public.player_mapping AS pm
    CROSS JOIN public.hero_mappings AS hm
    LEFT JOIN LATERAL (
      SELECT
        r.stars,
        r.progression_index,
        r.rarity,
        r.rank_name,
        r.xp_level,
        r.active_ability_level,
        r.passive_ability_level,
        r.synced_at
      FROM public.player_roster AS r
      WHERE r.hero_mapping_id = hm.id
        AND (
          r.player_mapping_id = pm.id
          OR (
            r.player_mapping_id IS NULL
            AND pm.user_id IS NOT NULL
            AND r.user_id = pm.user_id
          )
        )
      ORDER BY
        r.synced_at DESC NULLS LAST,
        ((r.player_mapping_id = pm.id) IS TRUE) DESC
      LIMIT 1
    ) AS pr ON true
    WHERE pm.guild_code = p_guild_code
      AND pm.is_current IS TRUE
      AND hm.unit_id = ANY(p_unit_ids)
      AND (NOT v_self_only OR pm.user_id = v_uid)
    ORDER BY pm.display_name, hm.display_name;
END;
$$;

-- The canonical team projection keeps its own non-login, non-bypass reader.
-- Only the RPC can use this role; its member branch remains self-only.
CREATE ROLE desktop_team_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_team_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),public._pm_caller_guild_codes(),public._pm_caller_cluster_guild_codes(),public._pm_caller_is_app_admin() TO desktop_team_reader;
GRANT SELECT ON public.player_mapping,public.guild_config,public.hero_mappings,public.player_roster TO desktop_team_reader;
CREATE POLICY desktop_team_mapping ON public.player_mapping FOR SELECT TO desktop_team_reader USING (
 user_id=auth.uid() OR guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_team_guild ON public.guild_config FOR SELECT TO desktop_team_reader USING (
 guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_team_catalog ON public.hero_mappings FOR SELECT TO desktop_team_reader USING (true);
CREATE POLICY desktop_team_roster ON public.player_roster FOR SELECT TO desktop_team_reader USING (
 EXISTS (SELECT 1 FROM public.player_mapping pm WHERE pm.is_current AND
   (pm.id=player_roster.player_mapping_id OR (player_roster.player_mapping_id IS NULL AND pm.user_id=player_roster.user_id)) AND
   (pm.guild_code IN (SELECT public._pm_caller_guild_codes()) OR pm.guild_code IN (SELECT public._pm_caller_cluster_guild_codes())))
);
ALTER FUNCTION public.get_guild_team_roster(text,text[]) OWNER TO desktop_team_reader;
REVOKE ALL ON FUNCTION public.get_guild_team_roster(text,text[]) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_guild_team_roster(text,text[]) TO authenticated;

-- Add canonical cached-token and season-scoped target closure.


CREATE TABLE public.season_calendar (
    season_id integer NOT NULL,
    season_label text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    tokens_per_player_cap integer DEFAULT 28 NOT NULL,
    regen_interval_hours integer DEFAULT 12 NOT NULL,
    regen_tokens_per_interval integer DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE FUNCTION public.calculate_player_tokens_by_user(p_user_id text, p_guild_code text, p_season text DEFAULT NULL::text) RETURNS TABLE(player_user_id text, guild_code text, tokens_available integer, battles_today integer, last_battle_time timestamp with time zone, time_until_next_token interval, is_capped boolean)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_season TEXT;
    v_battle_count INT;
    v_max_tokens INT := 3;
    v_initial_tokens INT := 2;
    v_twelve_hours_secs BIGINT := 12 * 60 * 60;
    v_now_secs BIGINT;
    v_token_count INT;
    v_refresh_time BIGINT;
    v_anchor_ts BIGINT := NULL;
    v_n_recharged INT;
    v_time_since_refresh BIGINT;
    v_time_until_next INTERVAL := NULL;
    v_last_battle TIMESTAMPTZ;
    v_battle RECORD;
    v_battle_ts BIGINT;
    v_prev_count INT;
BEGIN
    v_now_secs := EXTRACT(EPOCH FROM NOW())::BIGINT;

    IF p_season IS NULL THEN
        SELECT MAX(season_num)::text INTO v_season
        FROM "EOT_GR_data"
        WHERE "Guild" = p_guild_code;
    ELSE
        v_season := p_season;
    END IF;

    SELECT COUNT(DISTINCT "startedOn")
    INTO v_battle_count
    FROM "EOT_GR_data"
    WHERE "userId" = p_user_id
    AND "Guild" = p_guild_code
    AND "Season" = v_season
    AND "damageType" = 'Battle';

    IF v_season ~ '^\d+$' THEN
        SELECT EXTRACT(EPOCH FROM sc.starts_at)::BIGINT INTO v_anchor_ts
        FROM public.season_calendar sc
        WHERE sc.season_id = (v_season::INT - 1);

        IF v_anchor_ts IS NULL THEN
            SELECT EXTRACT(EPOCH FROM sc.starts_at)::BIGINT INTO v_anchor_ts
            FROM public.season_calendar sc
            WHERE sc.season_id = v_season::INT;
        END IF;

        IF v_anchor_ts IS NOT NULL AND v_anchor_ts > v_now_secs THEN
            v_anchor_ts := NULL;
        END IF;
    END IF;

    v_token_count := v_initial_tokens;
    v_refresh_time := NULL;

    FOR v_battle IN
        SELECT DISTINCT "startedOn"::TIMESTAMPTZ as battle_time
        FROM "EOT_GR_data"
        WHERE "userId" = p_user_id
        AND "Guild" = p_guild_code
        AND "damageType" = 'Battle'
        AND "startedOn" IS NOT NULL
        AND "Season" IN (v_season, (v_season::INT - 1)::TEXT)
        ORDER BY "startedOn"::TIMESTAMPTZ ASC
    LOOP
        v_battle_ts := EXTRACT(EPOCH FROM v_battle.battle_time)::BIGINT;
        v_last_battle := v_battle.battle_time;

        IF v_refresh_time IS NULL THEN
            v_refresh_time := LEAST(COALESCE(v_anchor_ts, v_battle_ts), v_battle_ts);
        END IF;

        IF v_token_count < v_max_tokens THEN
            v_n_recharged := FLOOR((v_battle_ts - v_refresh_time)::NUMERIC / v_twelve_hours_secs);

            IF v_n_recharged + v_token_count >= v_max_tokens THEN
                v_token_count := v_max_tokens;
                v_refresh_time := v_battle_ts;
            ELSE
                v_token_count := v_token_count + v_n_recharged;
                v_refresh_time := v_refresh_time + (v_n_recharged * v_twelve_hours_secs);
            END IF;
        END IF;

        v_prev_count := v_token_count;
        v_token_count := v_token_count - 1;

        IF v_prev_count = v_max_tokens THEN
            v_refresh_time := v_battle_ts;
        END IF;

        IF v_token_count <= 0 THEN
            v_token_count := 0;
        END IF;
    END LOOP;

    IF v_refresh_time IS NULL AND v_anchor_ts IS NOT NULL THEN
        v_refresh_time := v_anchor_ts;
    END IF;

    IF v_token_count < v_max_tokens AND v_refresh_time IS NOT NULL THEN
        v_n_recharged := FLOOR((v_now_secs - v_refresh_time)::NUMERIC / v_twelve_hours_secs);

        IF v_n_recharged + v_token_count >= v_max_tokens THEN
            v_token_count := v_max_tokens;
            v_refresh_time := v_now_secs;
        ELSE
            v_token_count := v_token_count + v_n_recharged;
            v_refresh_time := v_refresh_time + (v_n_recharged * v_twelve_hours_secs);
        END IF;
    END IF;

    IF v_token_count < v_max_tokens AND v_refresh_time IS NOT NULL THEN
        v_time_since_refresh := v_now_secs - v_refresh_time;
        v_time_until_next := make_interval(secs => (v_twelve_hours_secs - (v_time_since_refresh % v_twelve_hours_secs)));
    END IF;

    v_token_count := LEAST(v_max_tokens, GREATEST(0, v_token_count));

    RETURN QUERY
    SELECT
        p_user_id,
        p_guild_code,
        v_token_count,
        v_battle_count,
        v_last_battle,
        v_time_until_next,
        v_token_count = v_max_tokens;
END;
$_$;

CREATE FUNCTION public.project_token_snapshot(p_count integer, p_next_seconds integer, p_snapshot_at timestamp with time zone, p_spends timestamp with time zone[], p_now timestamp with time zone, p_cap integer, p_regen_secs bigint) RETURNS TABLE(available integer, next_in_seconds integer)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  pts_now_secs bigint;
  pts_snap_secs bigint;
  pts_count int;
  pts_refresh bigint;      -- NULL while paused at cap with no spend yet
  pts_spend_ts timestamptz;
  pts_spend_secs bigint;
  pts_recharged int;
  pts_prev_count int;
  pts_elapsed bigint;
BEGIN
  IF p_count IS NULL OR p_snapshot_at IS NULL OR p_now IS NULL
     OR p_cap IS NULL OR p_cap <= 0
     OR p_regen_secs IS NULL OR p_regen_secs <= 0 THEN
    available := NULL;
    next_in_seconds := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  pts_now_secs := EXTRACT(EPOCH FROM p_now)::bigint;
  pts_snap_secs := EXTRACT(EPOCH FROM p_snapshot_at)::bigint;
  pts_count := LEAST(p_cap, GREATEST(0, p_count));

  IF pts_count >= p_cap THEN
    pts_refresh := NULL;
  ELSIF p_next_seconds IS NULL OR p_next_seconds <= 0 THEN
    pts_refresh := pts_snap_secs;
  ELSE
    pts_refresh := pts_snap_secs + p_next_seconds - p_regen_secs;
  END IF;

  FOR pts_spend_ts IN
    SELECT u.spend_ts
    FROM unnest(p_spends) AS u(spend_ts)
    WHERE u.spend_ts IS NOT NULL
      AND u.spend_ts > p_snapshot_at
    ORDER BY u.spend_ts ASC
  LOOP
    pts_spend_secs := EXTRACT(EPOCH FROM pts_spend_ts)::bigint;

    IF pts_count < p_cap THEN
      pts_recharged := GREATEST(
        0,
        FLOOR((pts_spend_secs - pts_refresh)::numeric / p_regen_secs)
      )::int;

      IF pts_recharged + pts_count >= p_cap THEN
        pts_count := p_cap;
        pts_refresh := pts_spend_secs;
      ELSE
        pts_count := pts_count + pts_recharged;
        pts_refresh := pts_refresh + (pts_recharged::bigint * p_regen_secs);
      END IF;
    END IF;

    pts_prev_count := pts_count;
    pts_count := GREATEST(0, pts_count - 1);
    IF pts_prev_count = p_cap THEN
      pts_refresh := pts_spend_secs;
    END IF;
  END LOOP;

  IF pts_count < p_cap AND pts_refresh IS NOT NULL THEN
    pts_recharged := GREATEST(
      0,
      FLOOR((pts_now_secs - pts_refresh)::numeric / p_regen_secs)
    )::int;

    IF pts_recharged + pts_count >= p_cap THEN
      pts_count := p_cap;
      pts_refresh := pts_now_secs;
    ELSE
      pts_count := pts_count + pts_recharged;
      pts_refresh := pts_refresh + (pts_recharged::bigint * p_regen_secs);
    END IF;
  END IF;

  available := LEAST(p_cap, GREATEST(0, pts_count));

  IF available >= p_cap OR pts_refresh IS NULL THEN
    next_in_seconds := NULL;
  ELSE
    pts_elapsed := GREATEST(0, pts_now_secs - pts_refresh);
    next_in_seconds := (p_regen_secs - (pts_elapsed % p_regen_secs))::int;
  END IF;

  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.get_player_token_state(p_guild_code text, p_season text DEFAULT NULL::text, p_cluster_code text DEFAULT NULL::text, p_player_id text DEFAULT NULL::text) RETURNS TABLE(player_id text, display_name text, discord_user_id text, tokens_available integer, is_capped boolean, time_to_next_token interval, data_source text, token_next_in_seconds integer, last_sync_at timestamp with time zone, tokens_used integer, max_possible integer, burned_tokens integer, time_over_cap_seconds integer, last_battle_time timestamp with time zone, bombs_available integer, bomb_next_in_seconds integer, post_snapshot_spends integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $_$
declare
  v_season text;
  v_is_service boolean := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  ) = 'service_role';
  v_requester_id uuid := auth.uid();
  v_requester_role text := null;
  v_requester_guild text := null;
  v_requester_cluster text := null;
  v_target_cluster text := null;
begin
  if not v_is_service then
    if v_requester_id is null then
      return;
    end if;

    select pm.guild_code, pm.cluster_code, pm.role
      into v_requester_guild, v_requester_cluster, v_requester_role
    from public.player_with_cluster pm
    where pm.user_id = v_requester_id
      and pm.is_current = true
    limit 1;

    select gc.cluster_code::text
      into v_target_cluster
    from public.guild_config gc
    where gc.guild_code = p_guild_code
    limit 1;

    if v_requester_guild is distinct from p_guild_code then
      if v_requester_role not in ('officer', 'admin') then
        return;
      end if;
      if v_target_cluster is null or v_requester_cluster is distinct from v_target_cluster then
        return;
      end if;
    end if;
  end if;

  if p_season is null or trim(p_season) = '' then
    select max(d.season_num)::text into v_season
    from "EOT_GR_data" d
    where d."Guild" = p_guild_code
      and (p_cluster_code is null or d.cluster_code = p_cluster_code);
  else
    v_season := trim(p_season);
  end if;

  if v_season is null then
    return;
  end if;

  return query
  with members as (
    select
      pm.player_id,
      pm.display_name,
      pm.discord_user_id::text as discord_user_id,
      pm.last_sync_tokens,
      pm.next_token_seconds,
      pm.last_sync_at::timestamptz as last_sync_at,
      pm.api_key_is_valid,
      pm.tacticus_api_key_encrypted,
      pm.last_sync_bombs,
      pm.next_bomb_seconds
    from public.player_mapping pm
    where pm.guild_code = p_guild_code
      and pm.is_current = true
      and (p_player_id is null or pm.player_id = p_player_id)
  ),
  recent_spend as (
    select
      m2.player_id,
      count(distinct d."startedOn") filter (where d."damageType" = 'Battle')::int as battles_after_sync,
      count(distinct d."startedOn") filter (where d."damageType" = 'Bomb')::int as bombs_after_sync,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Battle') as battle_spends,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Bomb') as bomb_spends
    from members m2
    join public."EOT_GR_data" d
      on d."userId" = m2.player_id
      and d."Guild" = p_guild_code
      and (
        d."Season" = v_season
        or (v_season ~ '^\d+$' and d."Season" = (v_season::int - 1)::text)
      )
      and d."damageType" in ('Battle', 'Bomb')
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
    where m2.last_sync_at is not null
      and d."startedOn"::timestamptz > m2.last_sync_at
    group by m2.player_id
  ),
  battle_rows as (
    select
      d."userId" as player_id,
      d."damageType" as damage_type,
      d."damageDealt" as damage_dealt,
      d."startedOn"::timestamptz as started_on
    from public."EOT_GR_data" d
    where d."Guild" = p_guild_code
      and d."Season" = v_season
      and d."damageType" in ('Battle', 'Bomb')
      and d."userId" is not null
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
  ),
  current_season_totals as (
    select
      b.player_id,
      count(*) filter (
        where b.damage_type = 'Battle'
      )::int as tokens_used,
      max(b.started_on) filter (where b.damage_type = 'Battle') as last_battle_time
    from battle_rows b
    group by b.player_id
  ),
  max_tokens as (
    select coalesce(max(c.tokens_used), 0)::int as max_possible
    from current_season_totals c
  ),
  calculated as (
    select
      m.player_id,
      calc.tokens_available as calc_tokens_available,
      calc.is_capped as calc_is_capped,
      calc.time_until_next_token as calc_time_until_next_token,
      calc.last_battle_time as calc_last_battle_time
    from members m
    left join lateral (
      select *
      from public.calculate_player_tokens_by_user(m.player_id, p_guild_code, v_season)
      limit 1
    ) calc on true
  ),
  burn_state as (
    select
      m.player_id,
      cb.burned_tokens,
      cb.time_over_cap_seconds
    from members m
    cross join lateral public.compute_player_token_burn(
      p_guild_code := p_guild_code,
      p_season := v_season,
      p_player_id := m.player_id
    ) cb
  ),
  bomb_calc as (
    select
      b.player_id,
      max(b.started_on) as last_bomb_time,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then 0
        else 1
      end as calc_bombs_available,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then floor(64800 - extract(epoch from (now() - max(b.started_on))))::int
        else null
      end as calc_bomb_next_seconds
    from battle_rows b
    where b.damage_type = 'Bomb'
    group by b.player_id
  )
  select
    m.player_id,
    m.display_name,
    m.discord_user_id,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens
      when live_source.token_pure then tok_proj.proj_tokens
      else coalesce(c.calc_tokens_available, 3)
    end as tokens_available,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens >= 3
      when live_source.token_pure then tok_proj.proj_tokens >= 3
      else coalesce(c.calc_is_capped, coalesce(c.calc_tokens_available, 3) >= 3)
    end as is_capped,
    case
      when live_source.token_spent then
        case
          when tok_spend_proj.spent_next_seconds is null then null::interval
          else make_interval(secs => tok_spend_proj.spent_next_seconds)
        end
      when live_source.token_pure then
        case
          when tok_proj.proj_next_seconds is null then null::interval
          else make_interval(secs => tok_proj.proj_next_seconds)
        end
      else
        case
          when coalesce(c.calc_tokens_available, 3) >= 3 then null::interval
          else c.calc_time_until_next_token
        end
    end as time_to_next_token,
    case
      when live_source.token_live then 'live'::text
      else 'calculated'::text
    end as data_source,
    case
      when live_source.token_spent then tok_spend_proj.spent_next_seconds
      when live_source.token_pure then tok_proj.proj_next_seconds
      else floor(extract(epoch from c.calc_time_until_next_token))::int
    end as token_next_in_seconds,
    m.last_sync_at,
    coalesce(t.tokens_used, 0) as tokens_used,
    coalesce(mt.max_possible, 0) as max_possible,
    coalesce(bs.burned_tokens, 0) as burned_tokens,
    coalesce(bs.time_over_cap_seconds, 0) as time_over_cap_seconds,
    coalesce(t.last_battle_time, c.calc_last_battle_time) as last_battle_time,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bombs
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bombs
      else coalesce(bc.calc_bombs_available, 1)
    end as bombs_available,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bomb_next
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bomb_next
      else bc.calc_bomb_next_seconds
    end as bomb_next_in_seconds,
    case
      when live_source.token_live then coalesce(rs.battles_after_sync, 0)
      else null::int
    end as post_snapshot_spends
  from members m
  left join calculated c
    on c.player_id = m.player_id
  left join current_season_totals t
    on t.player_id = m.player_id
  cross join max_tokens mt
  left join burn_state bs
    on bs.player_id = m.player_id
  left join bomb_calc bc
    on bc.player_id = m.player_id
  left join recent_spend rs
    on rs.player_id = m.player_id
  cross join lateral (
    select
      base_live.ok as base_live,
      base_live.ok as token_live,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) = 0) as token_pure,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) > 0) as token_spent,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) = 0) as bomb_pure,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) > 0) as bomb_spent
    from (
      select (
        m.tacticus_api_key_encrypted is not null
        and coalesce(m.api_key_is_valid, false)
        and m.last_sync_tokens is not null
        and m.last_sync_at is not null
      ) as ok
    ) base_live
  ) live_source
  cross join lateral (
    select
      case
        when live_source.base_live
          then greatest(0::numeric, floor(extract(epoch from (now() - m.last_sync_at))))
        else null::numeric
      end as elapsed_secs,
      greatest(0, least(3, coalesce(m.last_sync_tokens, 3))) as synced_tokens
  ) sync_snap
  cross join lateral (
    select
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then 3
        when coalesce(m.next_token_seconds, 0) <= 0 then sync_snap.synced_tokens
        when sync_snap.elapsed_secs < m.next_token_seconds then sync_snap.synced_tokens
        else least(
          3,
          sync_snap.synced_tokens + 1 + floor(
            (sync_snap.elapsed_secs - m.next_token_seconds) / 43200.0
          )::int
        )
      end as proj_tokens,
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then null::int
        when coalesce(m.next_token_seconds, 0) <= 0 then null::int
        when sync_snap.elapsed_secs < m.next_token_seconds
          then (m.next_token_seconds - sync_snap.elapsed_secs)::int
        else (43200 - ((sync_snap.elapsed_secs - m.next_token_seconds)::bigint % 43200))::int
      end as proj_next_raw
  ) tok_proj0
  cross join lateral (
    select
      tok_proj0.proj_tokens,
      case
        when tok_proj0.proj_tokens is null then null::int
        when tok_proj0.proj_tokens >= 3 then null::int
        else tok_proj0.proj_next_raw
      end as proj_next_seconds
  ) tok_proj
  cross join lateral (
    select
      tsp.available as spent_tokens,
      tsp.next_in_seconds as spent_next_seconds
    from public.project_token_snapshot(
      case when live_source.token_spent then m.last_sync_tokens else null::int end,
      m.next_token_seconds,
      m.last_sync_at,
      coalesce(rs.battle_spends, array[]::timestamptz[]),
      now(),
      3,
      43200
    ) tsp
  ) tok_spend_proj
  cross join lateral (
    select
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds
          then greatest(1, coalesce(m.last_sync_bombs, 0))
        else greatest(0, coalesce(m.last_sync_bombs, 0))
      end as proj_bombs,
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds then null::int
        else (m.next_bomb_seconds - sync_snap.elapsed_secs)::int
      end as proj_bomb_next
  ) bomb_proj
  cross join lateral (
    select
      bsp.available as spent_bombs,
      bsp.next_in_seconds as spent_bomb_next
    from public.project_token_snapshot(
      case when live_source.bomb_spent then m.last_sync_bombs else null::int end,
      m.next_bomb_seconds,
      m.last_sync_at,
      coalesce(rs.bomb_spends, array[]::timestamptz[]),
      now(),
      1,
      64800
    ) bsp
  ) bomb_spend_proj
  order by m.display_name;
end;
$_$;

CREATE TABLE public.boss_target_tokens (
    guild_code text NOT NULL,
    boss_name text NOT NULL,
    rarity text NOT NULL,
    set integer NOT NULL,
    target_tokens numeric NOT NULL,
    source text NOT NULL,
    seeded_from_seasons text,
    notes text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    encounter_id integer DEFAULT 0 NOT NULL,
    skip boolean DEFAULT false NOT NULL,
    season_number text DEFAULT ''::text NOT NULL,
    board_id text,
    CONSTRAINT boss_target_tokens_encounter_id_check CHECK ((encounter_id = ANY (ARRAY[0, 1, 2]))),
    CONSTRAINT boss_target_tokens_rarity_check CHECK ((rarity = ANY (ARRAY['Legendary'::text, 'Mythic'::text]))),
    CONSTRAINT boss_target_tokens_set_check CHECK (((set >= 1) AND (set <= 5))),
    CONSTRAINT boss_target_tokens_source_check CHECK ((source = ANY (ARRAY['historical_seed'::text, 'officer_manual'::text]))),
    CONSTRAINT boss_target_tokens_target_tokens_check CHECK ((target_tokens > (0)::numeric))
);

CREATE TABLE public.herald_boss_config (
    id bigint NOT NULL,
    guild_code text NOT NULL,
    boss_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    webhook_config_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    discord_role_ids text[] DEFAULT '{}'::text[] NOT NULL,
    extra_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    extra_videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rarity_set text,
    custom_message_url text,
    notes text,
    side1_notes text,
    side2_notes text,
    side1_behaviour text DEFAULT 'kill'::text NOT NULL,
    side2_behaviour text DEFAULT 'kill'::text NOT NULL,
    side1_threshold_hp_pct smallint,
    side2_threshold_hp_pct smallint,
    ping_mode text DEFAULT 'per_side'::text NOT NULL,
    ping_mode_explicit boolean DEFAULT false NOT NULL,
    discord_role_labels jsonb DEFAULT '{}'::jsonb NOT NULL,
    pinned_replay_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    replay_auto_count integer DEFAULT 0 NOT NULL,
    replay_link_mode text DEFAULT 'inherit'::text NOT NULL,
    CONSTRAINT herald_boss_config_boss_id_format CHECK ((boss_id ~ '^[A-Za-z][A-Za-z0-9]*_E[0-9]{1,3}$'::text)),
    CONSTRAINT herald_boss_config_extra_links_is_array CHECK ((jsonb_typeof(extra_links) = 'array'::text)),
    CONSTRAINT herald_boss_config_extra_videos_is_array CHECK ((jsonb_typeof(extra_videos) = 'array'::text)),
    CONSTRAINT herald_boss_config_ping_mode_check CHECK ((ping_mode = ANY (ARRAY['combined'::text, 'per_side'::text, 'skip_all'::text]))),
    CONSTRAINT herald_boss_config_replay_link_mode_check CHECK ((replay_link_mode = ANY (ARRAY['inherit'::text, 'off'::text, 'pinned'::text, 'featured'::text, 'all'::text]))),
    CONSTRAINT herald_boss_config_rarity_set_format CHECK (((rarity_set IS NULL) OR (rarity_set ~ '^[LM][1-5]$'::text))),
    CONSTRAINT herald_boss_config_side1_behaviour_check CHECK ((side1_behaviour = ANY (ARRAY['skip'::text, 'kill'::text, 'threshold'::text]))),
    CONSTRAINT herald_boss_config_side1_threshold_hp_pct_check CHECK (((side1_threshold_hp_pct IS NULL) OR ((side1_threshold_hp_pct >= 1) AND (side1_threshold_hp_pct <= 100)))),
    CONSTRAINT herald_boss_config_side2_behaviour_check CHECK ((side2_behaviour = ANY (ARRAY['skip'::text, 'kill'::text, 'threshold'::text]))),
    CONSTRAINT herald_boss_config_side2_threshold_hp_pct_check CHECK (((side2_threshold_hp_pct IS NULL) OR ((side2_threshold_hp_pct >= 1) AND (side2_threshold_hp_pct <= 100))))
);

CREATE TABLE public.upcoming_season_bosses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_code text NOT NULL,
    season_number text NOT NULL,
    level text NOT NULL,
    boss_name text NOT NULL,
    selected_by uuid,
    selected_at timestamp with time zone DEFAULT now(),
    sub_bosses jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT upcoming_season_bosses_boss_name_nonempty CHECK ((boss_name <> ''::text)),
    CONSTRAINT upcoming_season_bosses_level_check CHECK ((level = ANY (ARRAY['L1'::text, 'L2'::text, 'L3'::text, 'L4'::text, 'L5'::text, 'M1'::text, 'M2'::text, 'M3'::text, 'M4'::text, 'M5'::text])))
);

CREATE FUNCTION public.boss_target_tokens_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.get_cluster_latest_season() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_guild_code   TEXT;
  v_cluster_code TEXT;
  v_latest_season TEXT;
BEGIN
  SELECT pm.guild_code, gc.cluster_code
  INTO v_guild_code, v_cluster_code
  FROM player_mapping pm
  LEFT JOIN guild_config gc ON gc.guild_code = pm.guild_code
  WHERE pm.user_id = auth.uid()
    AND pm.is_current = true
  LIMIT 1;

  IF v_cluster_code IS NOT NULL THEN
    SELECT max(per_guild.season_num)::text
    INTO v_latest_season
    FROM guild_config gc
    CROSS JOIN LATERAL (
      SELECT max(e.season_num) AS season_num
      FROM "EOT_GR_data" e
      WHERE e."Guild" = gc.guild_code
    ) AS per_guild
    WHERE gc.cluster_code = v_cluster_code;
  ELSIF v_guild_code IS NOT NULL THEN
    SELECT max(e.season_num)::text
    INTO v_latest_season
    FROM "EOT_GR_data" e
    WHERE e."Guild" = v_guild_code;
  END IF;

  RETURN v_latest_season;
END;
$$;

-- Cached token reads keep the signed-in caller and canonical membership checks.
-- Present durable snapshots remain useful after API access has been removed.
-- The adapter preserves the canonical calculation body, replaces the snapshot
-- credential predicate with snapshot presence, and labels that source cached.
CREATE FUNCTION public.desktop_get_player_token_state(p_guild_code text, p_season text DEFAULT NULL::text, p_cluster_code text DEFAULT NULL::text, p_player_id text DEFAULT NULL::text) RETURNS TABLE(player_id text, display_name text, discord_user_id text, tokens_available integer, is_capped boolean, time_to_next_token interval, data_source text, token_next_in_seconds integer, last_sync_at timestamp with time zone, tokens_used integer, max_possible integer, burned_tokens integer, time_over_cap_seconds integer, last_battle_time timestamp with time zone, bombs_available integer, bomb_next_in_seconds integer, post_snapshot_spends integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $_$
declare
  v_season text;
  v_is_service boolean := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  ) = 'service_role';
  v_requester_id uuid := auth.uid();
  v_requester_role text := null;
  v_requester_guild text := null;
  v_requester_cluster text := null;
  v_target_cluster text := null;
begin
  if not v_is_service then
    if v_requester_id is null then
      return;
    end if;

    select pm.guild_code, pm.cluster_code, pm.role
      into v_requester_guild, v_requester_cluster, v_requester_role
    from public.player_with_cluster pm
    where pm.user_id = v_requester_id
      and pm.is_current = true
    limit 1;

    select gc.cluster_code::text
      into v_target_cluster
    from public.guild_config gc
    where gc.guild_code = p_guild_code
    limit 1;

    if v_requester_guild is distinct from p_guild_code then
      if lower(v_requester_role) not in ('officer', 'leader') then
        return;
      end if;
      if v_target_cluster is null or v_requester_cluster is distinct from v_target_cluster then
        return;
      end if;
    end if;
  end if;

  if p_season is null or trim(p_season) = '' then
    select max(d.season_num)::text into v_season
    from "EOT_GR_data" d
    where d."Guild" = p_guild_code
      and (p_cluster_code is null or d.cluster_code = p_cluster_code);
  else
    v_season := trim(p_season);
  end if;

  if v_season is null then
    return;
  end if;

  return query
  with members as (
    select
      pm.player_id,
      pm.display_name,
      pm.discord_user_id::text as discord_user_id,
      pm.last_sync_tokens,
      pm.next_token_seconds,
      pm.last_sync_at::timestamptz as last_sync_at,
      pm.api_key_is_valid,
      pm.tacticus_api_key_encrypted,
      pm.last_sync_bombs,
      pm.next_bomb_seconds
    from public.player_mapping pm
    where pm.guild_code = p_guild_code
      and pm.is_current = true
      and (p_player_id is null or pm.player_id = p_player_id)
  ),
  recent_spend as (
    select
      m2.player_id,
      count(distinct d."startedOn") filter (where d."damageType" = 'Battle')::int as battles_after_sync,
      count(distinct d."startedOn") filter (where d."damageType" = 'Bomb')::int as bombs_after_sync,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Battle') as battle_spends,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Bomb') as bomb_spends
    from members m2
    join public."EOT_GR_data" d
      on d."userId" = m2.player_id
      and d."Guild" = p_guild_code
      and (
        d."Season" = v_season
        or (v_season ~ '^\d+$' and d."Season" = (v_season::int - 1)::text)
      )
      and d."damageType" in ('Battle', 'Bomb')
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
    where m2.last_sync_at is not null
      and d."startedOn"::timestamptz > m2.last_sync_at
    group by m2.player_id
  ),
  battle_rows as (
    select
      d."userId" as player_id,
      d."damageType" as damage_type,
      d."damageDealt" as damage_dealt,
      d."startedOn"::timestamptz as started_on
    from public."EOT_GR_data" d
    where d."Guild" = p_guild_code
      and d."Season" = v_season
      and d."damageType" in ('Battle', 'Bomb')
      and d."userId" is not null
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
  ),
  current_season_totals as (
    select
      b.player_id,
      count(*) filter (
        where b.damage_type = 'Battle'
      )::int as tokens_used,
      max(b.started_on) filter (where b.damage_type = 'Battle') as last_battle_time
    from battle_rows b
    group by b.player_id
  ),
  max_tokens as (
    select coalesce(max(c.tokens_used), 0)::int as max_possible
    from current_season_totals c
  ),
  calculated as (
    select
      m.player_id,
      calc.tokens_available as calc_tokens_available,
      calc.is_capped as calc_is_capped,
      calc.time_until_next_token as calc_time_until_next_token,
      calc.last_battle_time as calc_last_battle_time
    from members m
    left join lateral (
      select *
      from public.calculate_player_tokens_by_user(m.player_id, p_guild_code, v_season)
      limit 1
    ) calc on true
  ),
  burn_state as (
    select
      m.player_id,
      cb.burned_tokens,
      cb.time_over_cap_seconds
    from members m
    cross join lateral public.compute_player_token_burn(
      p_guild_code := p_guild_code,
      p_season := v_season,
      p_player_id := m.player_id
    ) cb
  ),
  bomb_calc as (
    select
      b.player_id,
      max(b.started_on) as last_bomb_time,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then 0
        else 1
      end as calc_bombs_available,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then floor(64800 - extract(epoch from (now() - max(b.started_on))))::int
        else null
      end as calc_bomb_next_seconds
    from battle_rows b
    where b.damage_type = 'Bomb'
    group by b.player_id
  )
  select
    m.player_id,
    m.display_name,
    m.discord_user_id,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens
      when live_source.token_pure then tok_proj.proj_tokens
      else coalesce(c.calc_tokens_available, 3)
    end as tokens_available,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens >= 3
      when live_source.token_pure then tok_proj.proj_tokens >= 3
      else coalesce(c.calc_is_capped, coalesce(c.calc_tokens_available, 3) >= 3)
    end as is_capped,
    case
      when live_source.token_spent then
        case
          when tok_spend_proj.spent_next_seconds is null then null::interval
          else make_interval(secs => tok_spend_proj.spent_next_seconds)
        end
      when live_source.token_pure then
        case
          when tok_proj.proj_next_seconds is null then null::interval
          else make_interval(secs => tok_proj.proj_next_seconds)
        end
      else
        case
          when coalesce(c.calc_tokens_available, 3) >= 3 then null::interval
          else c.calc_time_until_next_token
        end
    end as time_to_next_token,
    case
      when live_source.token_live then 'cached'::text
      else 'calculated'::text
    end as data_source,
    case
      when live_source.token_spent then tok_spend_proj.spent_next_seconds
      when live_source.token_pure then tok_proj.proj_next_seconds
      else floor(extract(epoch from c.calc_time_until_next_token))::int
    end as token_next_in_seconds,
    m.last_sync_at,
    coalesce(t.tokens_used, 0) as tokens_used,
    coalesce(mt.max_possible, 0) as max_possible,
    coalesce(bs.burned_tokens, 0) as burned_tokens,
    coalesce(bs.time_over_cap_seconds, 0) as time_over_cap_seconds,
    coalesce(t.last_battle_time, c.calc_last_battle_time) as last_battle_time,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bombs
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bombs
      else coalesce(bc.calc_bombs_available, 1)
    end as bombs_available,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bomb_next
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bomb_next
      else bc.calc_bomb_next_seconds
    end as bomb_next_in_seconds,
    case
      when live_source.token_live then coalesce(rs.battles_after_sync, 0)
      else null::int
    end as post_snapshot_spends
  from members m
  left join calculated c
    on c.player_id = m.player_id
  left join current_season_totals t
    on t.player_id = m.player_id
  cross join max_tokens mt
  left join burn_state bs
    on bs.player_id = m.player_id
  left join bomb_calc bc
    on bc.player_id = m.player_id
  left join recent_spend rs
    on rs.player_id = m.player_id
  cross join lateral (
    select
      base_live.ok as base_live,
      base_live.ok as token_live,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) = 0) as token_pure,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) > 0) as token_spent,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) = 0) as bomb_pure,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) > 0) as bomb_spent
    from (
      select (
        m.last_sync_tokens is not null
        and m.last_sync_at is not null
      ) as ok
    ) base_live
  ) live_source
  cross join lateral (
    select
      case
        when live_source.base_live
          then greatest(0::numeric, floor(extract(epoch from (now() - m.last_sync_at))))
        else null::numeric
      end as elapsed_secs,
      greatest(0, least(3, coalesce(m.last_sync_tokens, 3))) as synced_tokens
  ) sync_snap
  cross join lateral (
    select
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then 3
        when coalesce(m.next_token_seconds, 0) <= 0 then sync_snap.synced_tokens
        when sync_snap.elapsed_secs < m.next_token_seconds then sync_snap.synced_tokens
        else least(
          3,
          sync_snap.synced_tokens + 1 + floor(
            (sync_snap.elapsed_secs - m.next_token_seconds) / 43200.0
          )::int
        )
      end as proj_tokens,
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then null::int
        when coalesce(m.next_token_seconds, 0) <= 0 then null::int
        when sync_snap.elapsed_secs < m.next_token_seconds
          then (m.next_token_seconds - sync_snap.elapsed_secs)::int
        else (43200 - ((sync_snap.elapsed_secs - m.next_token_seconds)::bigint % 43200))::int
      end as proj_next_raw
  ) tok_proj0
  cross join lateral (
    select
      tok_proj0.proj_tokens,
      case
        when tok_proj0.proj_tokens is null then null::int
        when tok_proj0.proj_tokens >= 3 then null::int
        else tok_proj0.proj_next_raw
      end as proj_next_seconds
  ) tok_proj
  cross join lateral (
    select
      tsp.available as spent_tokens,
      tsp.next_in_seconds as spent_next_seconds
    from public.project_token_snapshot(
      case when live_source.token_spent then m.last_sync_tokens else null::int end,
      m.next_token_seconds,
      m.last_sync_at,
      coalesce(rs.battle_spends, array[]::timestamptz[]),
      now(),
      3,
      43200
    ) tsp
  ) tok_spend_proj
  cross join lateral (
    select
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds
          then greatest(1, coalesce(m.last_sync_bombs, 0))
        else greatest(0, coalesce(m.last_sync_bombs, 0))
      end as proj_bombs,
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds then null::int
        else (m.next_bomb_seconds - sync_snap.elapsed_secs)::int
      end as proj_bomb_next
  ) bomb_proj
  cross join lateral (
    select
      bsp.available as spent_bombs,
      bsp.next_in_seconds as spent_bomb_next
    from public.project_token_snapshot(
      case when live_source.bomb_spent then m.last_sync_bombs else null::int end,
      m.next_bomb_seconds,
      m.last_sync_at,
      coalesce(rs.bomb_spends, array[]::timestamptz[]),
      now(),
      1,
      64800
    ) bsp
  ) bomb_spend_proj
  order by m.display_name;
end;
$_$;

ALTER TABLE public.season_calendar ADD PRIMARY KEY(season_id);
ALTER TABLE public.season_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_calendar FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.season_calendar FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.season_calendar TO authenticated,service_role,desktop_rpc_reader;
CREATE POLICY desktop_season_calendar_read ON public.season_calendar FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.player_with_cluster TO desktop_rpc_reader;
REVOKE ALL ON FUNCTION public.calculate_player_tokens_by_user(text,text,text),public.project_token_snapshot(integer,integer,timestamptz,timestamptz[],timestamptz,integer,bigint),public.get_player_token_state(text,text,text,text),public.desktop_get_player_token_state(text,text,text,text),public.get_cluster_latest_season() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
ALTER FUNCTION public.get_player_token_state(text,text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.desktop_get_player_token_state(text,text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.get_cluster_latest_season() OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.calculate_player_tokens_by_user(text,text,text),public.project_token_snapshot(integer,integer,timestamptz,timestamptz[],timestamptz,integer,bigint) TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_token_state(text,text,text,text),public.desktop_get_player_token_state(text,text,text,text),public.get_cluster_latest_season() TO authenticated;

CREATE POLICY boss_target_tokens_write
  ON public.boss_target_tokens
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      WHERE pm.guild_code = boss_target_tokens.guild_code
        AND pm.is_current = true
        AND lower(pm.role::text) IN ('leader', 'officer')
    )
    OR EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      JOIN public.guild_config AS gc_user
        ON gc_user.guild_code = pm.guild_code
      JOIN public.guild_config AS gc_target
        ON gc_target.guild_code = boss_target_tokens.guild_code
      WHERE pm.is_current = true
        AND lower(pm.role::text) = 'leader'
        AND gc_user.cluster_code IS NOT NULL
        AND gc_user.cluster_code::text = gc_target.cluster_code::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      WHERE pm.guild_code = boss_target_tokens.guild_code
        AND pm.is_current = true
        AND lower(pm.role::text) IN ('leader', 'officer')
    )
    OR EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      JOIN public.guild_config AS gc_user
        ON gc_user.guild_code = pm.guild_code
      JOIN public.guild_config AS gc_target
        ON gc_target.guild_code = boss_target_tokens.guild_code
      WHERE pm.is_current = true
        AND lower(pm.role::text) = 'leader'
        AND gc_user.cluster_code IS NOT NULL
        AND gc_user.cluster_code::text = gc_target.cluster_code::text
    )
  );

ALTER TABLE ONLY public.boss_target_tokens
    ADD CONSTRAINT boss_target_tokens_pkey PRIMARY KEY (guild_code, boss_name, rarity, set, encounter_id, season_number);

ALTER TABLE ONLY public.boss_target_tokens
    ADD CONSTRAINT boss_target_tokens_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.boss_target_tokens
    ADD CONSTRAINT boss_target_tokens_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX boss_target_tokens_guild_idx ON public.boss_target_tokens USING btree (guild_code);

CREATE INDEX boss_target_tokens_skip_idx ON public.boss_target_tokens USING btree (guild_code, skip);

CREATE INDEX idx_boss_target_tokens_guild_rarity_set ON public.boss_target_tokens USING btree (guild_code, rarity, set);

CREATE TRIGGER boss_target_tokens_touch BEFORE UPDATE ON public.boss_target_tokens FOR EACH ROW EXECUTE FUNCTION public.boss_target_tokens_touch_updated_at();

ALTER TABLE public.boss_target_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY boss_target_tokens_read ON public.boss_target_tokens FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = boss_target_tokens.guild_code) AND (pm.is_current = true)))));

CREATE POLICY herald_boss_config_guild_read ON public.herald_boss_config FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (pm.guild_code = herald_boss_config.guild_code)))));

CREATE POLICY upcoming_season_bosses_member_read ON public.upcoming_season_bosses FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = upcoming_season_bosses.guild_code) AND (pm.is_current = true)))));

ALTER TABLE ONLY public.herald_boss_config
    ADD CONSTRAINT herald_boss_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.herald_boss_config
    ADD CONSTRAINT herald_boss_config_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_guild_code_season_number_level_key UNIQUE (guild_code, season_number, level);

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_selected_by_fkey FOREIGN KEY (selected_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.boss_target_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.herald_boss_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herald_boss_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_season_bosses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_season_bosses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.boss_target_tokens,public.herald_boss_config,public.upcoming_season_bosses FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.boss_target_tokens TO authenticated;
GRANT SELECT ON public.herald_boss_config,public.upcoming_season_bosses TO authenticated;
REVOKE ALL ON FUNCTION public.boss_target_tokens_touch_updated_at() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

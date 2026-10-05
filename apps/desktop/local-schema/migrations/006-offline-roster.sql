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

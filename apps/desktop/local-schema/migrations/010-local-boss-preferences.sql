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


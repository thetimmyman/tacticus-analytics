-- Local proof authority. Each installation has its own database and signing keys.
-- Read models retain canonical shapes; consumer writes go through the coordinator.
-- Completion commits with the preview import, never before it. Only the local
-- owner can inspect or change this coordinator ledger.
CREATE TABLE public.desktop_preview_setup (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  subject_user_id uuid NOT NULL REFERENCES auth.users(id),
  recovery_code_hash text CHECK (recovery_code_hash ~ '^[a-f0-9]{64}$')
);
ALTER TABLE public.desktop_preview_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_preview_setup FORCE ROW LEVEL SECURITY;
ALTER TABLE public."EOT_GR_data" ADD PRIMARY KEY (id);
ALTER TABLE public.player_mapping ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX desktop_current_subject ON public.player_mapping (user_id) WHERE is_current AND user_id IS NOT NULL;
ALTER TABLE public.guild_config ADD PRIMARY KEY (id);
ALTER TABLE public.guild_config ADD UNIQUE (guild_code);
ALTER TABLE public.player_identity_attestations ADD PRIMARY KEY (id);
ALTER TABLE public.player_identity_attestation_revocations ADD PRIMARY KEY (id);
ALTER TABLE public.player_identity_subject_authority_blocks ADD PRIMARY KEY (subject_user_id);
ALTER TABLE public.player_identity_attestations ADD FOREIGN KEY (mapping_id) REFERENCES public.player_mapping(id);
ALTER TABLE public.player_identity_attestations ADD FOREIGN KEY (subject_user_id) REFERENCES auth.users(id);
ALTER TABLE public.player_mapping ADD FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.player_mapping ADD FOREIGN KEY (ownership_attestation_id) REFERENCES public.player_identity_attestations(id);
ALTER TABLE public.player_identity_attestation_revocations ADD FOREIGN KEY (attestation_id) REFERENCES public.player_identity_attestations(id);

ALTER TABLE public."EOT_GR_data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EOT_GR_data" FORCE ROW LEVEL SECURITY;
ALTER TABLE public.player_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_mapping FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guild_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.player_identity_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_identity_attestation_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_identity_subject_authority_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY desktop_raid_read ON public."EOT_GR_data" FOR SELECT TO authenticated, desktop_rpc_reader USING (
  "Guild" IN (SELECT public._pm_caller_guild_codes()) OR "Guild" IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_mapping_read ON public.player_mapping FOR SELECT TO authenticated, desktop_rpc_reader USING (
  user_id = auth.uid() OR guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_guild_read ON public.guild_config FOR SELECT TO authenticated, desktop_rpc_reader USING (
  guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
-- Retain the canonical aggregate shape, with invoker authority instead of an
-- unscoped materialized-view grant. This explicit local difference prevents leaks.
CREATE VIEW public.mv_cluster_boss_averages WITH (security_invoker=true) AS
SELECT gc.cluster_code,e."Season",e."Name" AS boss_name,e."encounterId",e.rarity,e.set,
 AVG(e."damageDealt") AS cluster_avg,COUNT(*) AS battle_count
FROM public."EOT_GR_data" e JOIN public.guild_config gc ON gc.guild_code=e."Guild"
WHERE e."damageType"='Battle' AND e.rarity IN ('Legendary','Mythic') AND e."damageDealt">0
 AND NOT (e."remainingHp"=0 AND e."maxHp">0 AND e."damageDealt"<e."maxHp") AND gc.cluster_code IS NOT NULL
GROUP BY gc.cluster_code,e."Season",e."Name",e."encounterId",e.rarity,e.set;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public."EOT_GR_data",public.mv_cluster_boss_averages,public.current_user_player_mapping TO authenticated;
GRANT SELECT (player_id,display_name,is_current,is_active,guild_code,user_id) ON public.player_mapping TO authenticated;
GRANT SELECT (guild_code,guild_tag,display_name,enabled,onboarding_completed,cluster_code,cluster_id,user_id,api_key_is_valid,auto_sync_enabled,last_successful_sync,created_at) ON public.guild_config TO authenticated;
GRANT SELECT ON public."EOT_GR_data",public.guild_config,public.player_mapping TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public._pm_caller_guild_codes(),public._pm_caller_cluster_guild_codes(),public._pm_caller_is_app_admin(),public.qualifying_sweep_sum(numeric[],numeric),public.qualifying_sweep_count(numeric[],numeric),public.calc_effective_battle_count(numeric,numeric[],numeric,numeric),public.calc_boss_performance_pct(numeric,numeric,numeric[],numeric,numeric) TO authenticated,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_guild_boss_averages_batch(text,text[]),public.get_guild_player_scores_batch(text,text[]),public.calculate_player_reliability(text,text,text,text),public.get_player_performance_in_cluster(text,text,text,text) TO authenticated;
-- Canonical aggregate bodies, under a non-login, non-bypass owner. These definers
-- inherit the requesting JWT claims and remain bound by the raid RLS policies.
ALTER FUNCTION public.get_guild_boss_averages_batch(text,text[]) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.get_guild_player_scores_batch(text,text[]) OWNER TO desktop_rpc_reader;

-- Selected renderer closure: data stays scoped to the signed-in installation user.
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_access_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_cluster_read ON public.clusters FOR SELECT TO authenticated,desktop_rpc_reader USING (
 cluster_code IN (SELECT gc.cluster_code FROM public.guild_config gc)
);
CREATE POLICY desktop_theme_read ON public.guild_themes FOR SELECT TO authenticated,desktop_rpc_reader USING (
 guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_feature_access_read ON public.feature_access_grants FOR SELECT TO desktop_rpc_reader USING (user_id=auth.uid());
GRANT SELECT ON public.clusters,public.guild_themes,public.player_with_cluster TO authenticated,desktop_rpc_reader;
GRANT SELECT ON public.feature_access_grants TO desktop_rpc_reader;
GRANT SELECT (cluster_id,theme_preset,token_offender_threshold,token_abuser_threshold,primary_assignment_tokens,secondary_assignment_tokens,updated_at) ON public.guild_config TO authenticated;
GRANT SELECT (id,role,boss_preferences,updated_at) ON public.player_mapping TO authenticated;
GRANT UPDATE (last_active_at) ON public.current_user_player_mapping TO authenticated;
GRANT UPDATE (sync_tier,updated_at) ON public.guild_config TO service_role;
DO $selected_rpc$
DECLARE fn regprocedure;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('compute_player_token_burn','compute_player_tokens_available','get_distinct_seasons_for_guild','get_guild_vs_cluster_boss_performance','check_feature_access','get_duplicate_display_labels','get_player_performance_summary','get_player_prime_performance','get_season_token_stats','get_token_usage_for_guild','get_user_access_levels','get_player_boss_performance') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO desktop_rpc_reader',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role,desktop_rpc_reader',fn);
 END LOOP;
END;
$selected_rpc$;

GRANT SELECT ON public.feature_releases TO authenticated,desktop_rpc_reader;
ALTER TABLE public.work_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_guild_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votlw_winners ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.work_queue TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.work_queue_id_seq TO service_role;
GRANT SELECT ON public.public_guild_snapshots TO authenticated,service_role;
CREATE POLICY desktop_snapshot_read ON public.public_guild_snapshots FOR SELECT TO authenticated USING (guild_code IN (SELECT public._pm_caller_guild_codes()));
REVOKE ALL ON FUNCTION public.claim_next_work_job(text,text[]),public.complete_work_job(bigint,text,jsonb),public.fail_work_job(bigint,text,text,integer),public.reap_stuck_work_jobs(integer),public.manual_refresh_guild_snapshots(),public.refresh_public_guild_snapshots() FROM PUBLIC,anon,authenticated,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.claim_next_work_job(text,text[]),public.complete_work_job(bigint,text,jsonb),public.fail_work_job(bigint,text,text,integer),public.reap_stuck_work_jobs(integer),public.manual_refresh_guild_snapshots() TO service_role;

CREATE ROLE desktop_snapshot_owner NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO desktop_snapshot_owner;
GRANT SELECT ON public."EOT_GR_data",public.guild_config,public.clusters,public.votlw_winners,public.public_guild_snapshots TO desktop_snapshot_owner;
GRANT INSERT,TRUNCATE ON public.public_guild_snapshots TO desktop_snapshot_owner;
CREATE POLICY desktop_snapshot_raid_read ON public."EOT_GR_data" FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_guild_read ON public.guild_config FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_cluster_read ON public.clusters FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_winner_read ON public.votlw_winners FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_owner_read ON public.public_guild_snapshots FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_owner_write ON public.public_guild_snapshots FOR INSERT TO desktop_snapshot_owner WITH CHECK(true);
GRANT EXECUTE ON FUNCTION public.refresh_public_guild_snapshots() TO service_role;
ALTER FUNCTION public.refresh_public_guild_snapshots() OWNER TO desktop_snapshot_owner;

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

REVOKE ALL ON FUNCTION public.get_player_stats_comprehensive(text,text,text) FROM PUBLIC,anon,authenticated,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_stats_comprehensive(text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.get_player_damage_by_boss_loop(text,text,text),public.get_player_boss_rankings(text,text,text,text) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.get_player_damage_by_boss_loop(text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.get_player_boss_rankings(text,text,text,text) OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_damage_by_boss_loop(text,text,text),public.get_player_boss_rankings(text,text,text,text) TO authenticated,desktop_rpc_reader,service_role;

ALTER TABLE public.boss_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_name_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY desktop_boss_alias_read ON public.boss_name_aliases FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.boss_name_aliases TO authenticated,desktop_rpc_reader,service_role;
REVOKE ALL ON FUNCTION public.resolve_boss_name(text) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.resolve_boss_name(text) OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.resolve_boss_name(text) TO authenticated,desktop_rpc_reader,service_role;

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

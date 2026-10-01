-- Local proof authority. Each installation has its own database and signing keys.
-- Read models retain canonical shapes; consumer writes go through the coordinator.
-- Completion commits with the preview import, never before it. Only the local
-- owner can inspect or change this coordinator ledger.
CREATE TABLE public.desktop_preview_setup (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  subject_user_id uuid NOT NULL REFERENCES auth.users(id)
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

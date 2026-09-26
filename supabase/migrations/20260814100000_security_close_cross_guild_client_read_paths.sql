-- Close cross-guild client read paths; optional legacy objects are to_regclass()-guarded.

BEGIN;

-- Scope EOT_GR_data reads to the caller's guilds, their clusters (by guild_config link or
-- cluster_code, so unlinked rows stay visible) and app admins.
DO $sev1$
BEGIN
  IF to_regclass('public."EOT_GR_data"') IS NULL THEN RETURN; END IF;

  DROP POLICY IF EXISTS authenticated_users_read_all ON public."EOT_GR_data";
  DROP POLICY IF EXISTS eot_gr_data_caller_scope_read ON public."EOT_GR_data";

  CREATE POLICY eot_gr_data_caller_scope_read ON public."EOT_GR_data"
    FOR SELECT TO authenticated
    USING (
      "Guild" IN (SELECT public._pm_caller_guild_codes())
      OR "Guild" IN (SELECT public._pm_caller_cluster_guild_codes())
      OR (
        cluster_code IS NOT NULL
        AND cluster_code IN (
          SELECT pm.cluster_code
          FROM public._pm_caller_mapping_rows() pm
          WHERE pm.is_current AND pm.cluster_code IS NOT NULL
        )
      )
      OR EXISTS (
        SELECT 1 FROM public._pm_caller_mapping_rows() pm
        WHERE pm.is_app_admin = true
      )
    );
END $sev1$;

-- Matviews cannot enforce RLS and re-expose account UUIDs cross-guild; no client uses them.
DO $sev1b$
BEGIN
  IF to_regclass('public.mv_global_leaderboard') IS NOT NULL THEN
    REVOKE ALL ON public.mv_global_leaderboard FROM authenticated, anon;
  END IF;
  IF to_regclass('public.mv_cluster_season_rankings') IS NOT NULL THEN
    REVOKE ALL ON public.mv_cluster_season_rankings FROM authenticated, anon;
  END IF;
  -- member_stats_summary projects no UUID (verified live 2026-08-14) and has a
  -- guild-filtered client consumer: keep SELECT, drop the inert write bits.
  IF to_regclass('public.member_stats_summary') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE ON public.member_stats_summary
      FROM authenticated, anon;
  END IF;
END $sev1b$;

-- season_token_usage becomes invoker so the base-table policy scopes it.
DO $sev1c$
BEGIN
  IF to_regclass('public.boss_leaderboard_canonical') IS NOT NULL THEN
    REVOKE ALL ON public.boss_leaderboard_canonical FROM authenticated, anon;
  END IF;
  IF to_regclass('public.season_token_usage') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.season_token_usage SET (security_invoker = on)';
    REVOKE INSERT, UPDATE, DELETE ON public.season_token_usage
      FROM authenticated, anon;
  END IF;
END $sev1c$;

DO $sev2$
BEGIN
  IF to_regclass('public.guild_war_player_attempts_view') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.guild_war_player_attempts_view SET (security_invoker = on)';
  END IF;
END $sev2$;

-- Stop anon enumeration of guild names and cluster codes; authenticated SELECT is kept.
DO $sev3$
BEGIN
  IF to_regclass('public.guilds_public') IS NOT NULL THEN
    REVOKE ALL ON public.guilds_public FROM anon;
  END IF;
  IF to_regclass('public.clusters_public') IS NOT NULL THEN
    REVOKE ALL ON public.clusters_public FROM anon;
    REVOKE INSERT, UPDATE, DELETE ON public.clusters_public FROM authenticated;
  END IF;
END $sev3$;

-- Probes fire only when the object exists, so a from-scratch replay stays green.
DO $probe$
DECLARE
  n int;
BEGIN
  IF to_regclass('public."EOT_GR_data"') IS NOT NULL THEN
    SELECT count(*) INTO n FROM pg_policy
     WHERE polrelid = 'public."EOT_GR_data"'::regclass
       AND polname = 'authenticated_users_read_all';
    IF n <> 0 THEN
      RAISE EXCEPTION 'SEV-1: authenticated_users_read_all still present on EOT_GR_data';
    END IF;
    SELECT count(*) INTO n FROM pg_policy
     WHERE polrelid = 'public."EOT_GR_data"'::regclass
       AND polname = 'eot_gr_data_caller_scope_read';
    IF n <> 1 THEN
      RAISE EXCEPTION 'SEV-1: replacement policy eot_gr_data_caller_scope_read missing';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public."EOT_GR_data"', 'SELECT') THEN
      RAISE EXCEPTION 'SEV-1: authenticated lost SELECT on EOT_GR_data (own-guild reads would break)';
    END IF;
  END IF;

  IF to_regclass('public.mv_global_leaderboard') IS NOT NULL
     AND has_table_privilege('authenticated', 'public.mv_global_leaderboard', 'SELECT') THEN
    RAISE EXCEPTION 'SEV-1: authenticated still reads mv_global_leaderboard';
  END IF;
  IF to_regclass('public.mv_cluster_season_rankings') IS NOT NULL
     AND has_table_privilege('authenticated', 'public.mv_cluster_season_rankings', 'SELECT') THEN
    RAISE EXCEPTION 'SEV-1: authenticated still reads mv_cluster_season_rankings';
  END IF;
  IF to_regclass('public.member_stats_summary') IS NOT NULL
     AND NOT has_table_privilege('authenticated', 'public.member_stats_summary', 'SELECT') THEN
    RAISE EXCEPTION 'SEV-1: authenticated lost SELECT on member_stats_summary (members page would break)';
  END IF;
  IF to_regclass('public.boss_leaderboard_canonical') IS NOT NULL
     AND has_table_privilege('authenticated', 'public.boss_leaderboard_canonical', 'SELECT') THEN
    RAISE EXCEPTION 'SEV-1: authenticated still reads boss_leaderboard_canonical';
  END IF;

  IF to_regclass('public.season_token_usage') IS NOT NULL THEN
    SELECT count(*) INTO n FROM pg_class
     WHERE oid = 'public.season_token_usage'::regclass
       AND reloptions @> ARRAY['security_invoker=on'];
    IF n <> 1 THEN
      RAISE EXCEPTION 'SEV-1: season_token_usage is not security_invoker=on';
    END IF;
  END IF;
  IF to_regclass('public.guild_war_player_attempts_view') IS NOT NULL THEN
    SELECT count(*) INTO n FROM pg_class
     WHERE oid = 'public.guild_war_player_attempts_view'::regclass
       AND reloptions @> ARRAY['security_invoker=on'];
    IF n <> 1 THEN
      RAISE EXCEPTION 'SEV-2: guild_war_player_attempts_view is not security_invoker=on';
    END IF;
  END IF;

  IF to_regclass('public.guilds_public') IS NOT NULL
     AND has_table_privilege('anon', 'public.guilds_public', 'SELECT') THEN
    RAISE EXCEPTION 'SEV-3: anon still reads guilds_public';
  END IF;
  IF to_regclass('public.clusters_public') IS NOT NULL
     AND has_table_privilege('anon', 'public.clusters_public', 'SELECT') THEN
    RAISE EXCEPTION 'SEV-3: anon still reads clusters_public';
  END IF;
END $probe$;

COMMIT;

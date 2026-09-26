-- Drop the audit's re-verified DEAD set and unschedule refresh jobs for dropped matviews.
-- target-db: general
-- Apply before the sibling application's copy.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'dead-set drop (general) requires database postgres, got %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Dynamic SQL: a static cron.job reference fails to parse (42P01) without the cron schema.
DO $unschedule$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT cron.unschedule(jobid) FROM cron.job
       WHERE jobname IN ('refresh-guild-performance-cache','refresh-guild-veterans',
                         'eot-refresh-guild-performance-cache','eot-refresh-guild-veterans')
    $sql$;
  END IF;
END;
$unschedule$;

DROP FUNCTION IF EXISTS public.add_column_if_not_exists(text, text, text);
DROP FUNCTION IF EXISTS public.debug_auth_system(uuid, text);
DROP FUNCTION IF EXISTS public.debug_jwt_claims();
DROP FUNCTION IF EXISTS public.diagnose_profile_claim_issues(text);
DROP FUNCTION IF EXISTS public.fetch_raw_tacticus_data();
DROP FUNCTION IF EXISTS public.generate_boss_assignments(text, text, boolean, integer, boolean, text[], text);
DROP FUNCTION IF EXISTS public.get_current_war_status(text);
DROP FUNCTION IF EXISTS public.get_guild_members_debug(text);
-- The 4- and 5-arg get_player_boss_performance overloads are live RPCs; kept.
DROP FUNCTION IF EXISTS public.get_war_analytics(text, integer);
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.notify_unmapped_entity();
DROP FUNCTION IF EXISTS public.refresh_all_materialized_views();
DROP FUNCTION IF EXISTS public.refresh_cluster_averages();
DROP FUNCTION IF EXISTS public.refresh_critical_views();
DROP FUNCTION IF EXISTS public.refresh_materialized_views();
DROP FUNCTION IF EXISTS public.refresh_player_materialized_views();
DROP FUNCTION IF EXISTS public.test_boss_rankings_simple(text, text);
DROP FUNCTION IF EXISTS public.test_player_search(text);
DROP FUNCTION IF EXISTS public.update_modified_column();
DROP FUNCTION IF EXISTS public.update_support_ticket_updated_at();
DROP FUNCTION IF EXISTS public.update_support_unread_counters();
DROP FUNCTION IF EXISTS public.update_boss_playbook(text, text);
-- Dropped before public.boss_playbooks so no RPC points at a missing table.
DROP FUNCTION IF EXISTS public.get_boss_playbook(text);

DROP VIEW IF EXISTS public.boss_identifiers;
DROP VIEW IF EXISTS public.boss_leaderboard_canonical;
DROP VIEW IF EXISTS public.clusters_public;
DROP VIEW IF EXISTS public.guild_war_player_attempts_view;
DROP VIEW IF EXISTS public.guilds_public;
DROP VIEW IF EXISTS public.meta_atlas_by_unit;
DROP VIEW IF EXISTS public.meta_atlas_by_unit_type;
DROP VIEW IF EXISTS public.player_architecture_health;
DROP VIEW IF EXISTS public.user_profiles_with_guild;

DROP MATERIALIZED VIEW IF EXISTS public.mv_boss_performance;
DROP MATERIALIZED VIEW IF EXISTS public.guild_veterans_count;
DROP MATERIALIZED VIEW IF EXISTS public.mv_guild_performance_cache;
DROP MATERIALIZED VIEW IF EXISTS public.mv_global_leaderboard;



-- Tables: children before parents.
DROP TABLE IF EXISTS public.boss_playbook_history;
DROP TABLE IF EXISTS public.boss_playbooks;
DROP TABLE IF EXISTS public.assignment_runs;
DROP TABLE IF EXISTS public.function_locks;
DROP TABLE IF EXISTS public.saved_compositions;
-- guild_war_defensive_lineups is kept: cleanup_long_stale_guilds still names it.

-- Writerless always-NULL columns; current_rank, error_reason, player_display_snapshot, game_id stay.
ALTER TABLE public.guild_war_leaderboards
  DROP COLUMN IF EXISTS previous_rank,
  DROP COLUMN IF EXISTS season_end_date,
  DROP COLUMN IF EXISTS season_start_date,
  DROP COLUMN IF EXISTS streak_type;
-- zone_result KEPT: selected explicitly by app/api/wars/[warId]/layout/route.ts.
ALTER TABLE public.guild_war_zones
  DROP COLUMN IF EXISTS zone_end_time,
  DROP COLUMN IF EXISTS zone_start_time;
ALTER TABLE public.hero_mappings
  DROP COLUMN IF EXISTS active_ability,
  DROP COLUMN IF EXISTS alliance_id,
  DROP COLUMN IF EXISTS base_rarity,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS faction_id,
  DROP COLUMN IF EXISTS long_name,
  DROP COLUMN IF EXISTS mow_active_abilities,
  DROP COLUMN IF EXISTS mythic_abilities,
  DROP COLUMN IF EXISTS passive_ability,
  DROP COLUMN IF EXISTS sorting;
ALTER TABLE public.maps DROP COLUMN IF EXISTS boss_mapping_id;   -- drops maps_boss_mapping_id_fkey + idx_maps_boss_id
ALTER TABLE public.player_roster
  DROP COLUMN IF EXISTS mythic_shards,
  DROP COLUMN IF EXISTS shards,
  DROP COLUMN IF EXISTS upgrades,
  DROP COLUMN IF EXISTS xp;
ALTER TABLE public.sync_metrics
  DROP COLUMN IF EXISTS queue_time_ms,
  DROP COLUMN IF EXISTS total_time_ms;

-- system_logs_log_type_message_key covers the log_type prefix.
DROP INDEX IF EXISTS public.idx_system_logs_type_created;
DROP INDEX IF EXISTS public.idx_system_logs_type_date;

COMMENT ON TABLE public.guild_war_raw_events IS 'Raw guild-war events from war sync (LIVE: rows present, pruned daily by prune_guild_war_raw_events()). The 2026-06-24 audit DEAD verdict predates the writer.';
COMMENT ON COLUMN public.hero_mappings.game_id IS 'Game-side unit id; populated by sync (audit 2026-06-24 always-NULL verdict no longer holds).';
COMMENT ON INDEX public.idx_guild_war_zones_war IS '(war_id, guild_code) lookup index; heavily scanned (audit 2026-06-24 VERIFY resolved: keep).';
COMMENT ON COLUMN public.guild_war_leaderboards.current_rank IS 'Always NULL today but projected as season_rank by get_guild_war_showcase_summary(); kept for that reader.';
COMMENT ON COLUMN public.guild_war_zones.zone_result IS 'Always NULL today (no writer) but selected explicitly by /api/wars/[warId]/layout; kept for that reader.';

DO $verify$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(n, ', ') INTO leftover
  FROM unnest(ARRAY['public.boss_identifiers','public.boss_leaderboard_canonical','public.clusters_public',
    'public.guild_war_player_attempts_view','public.guilds_public','public.meta_atlas_by_unit',
    'public.meta_atlas_by_unit_type','public.player_architecture_health','public.user_profiles_with_guild',
    'public.mv_boss_performance','public.guild_veterans_count','public.mv_guild_performance_cache',
    'public.boss_playbook_history','public.boss_playbooks','public.assignment_runs','public.function_locks',
    'public.saved_compositions','public.mv_global_leaderboard',
    'public.idx_system_logs_type_created','public.idx_system_logs_type_date']) n
  WHERE to_regclass(n) IS NOT NULL;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'dead-set drop: relations still present: %', leftover;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftover
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
    'add_column_if_not_exists','debug_auth_system','debug_jwt_claims','diagnose_profile_claim_issues',
    'fetch_raw_tacticus_data','generate_boss_assignments','get_current_war_status','get_guild_members_debug',
    'get_war_analytics','handle_new_user','notify_unmapped_entity','refresh_all_materialized_views',
    'refresh_cluster_averages','refresh_critical_views','refresh_materialized_views',
    'refresh_player_materialized_views','test_boss_rankings_simple','test_player_search',
    'update_modified_column','update_support_ticket_updated_at','update_support_unread_counters',
    'update_boss_playbook','get_boss_playbook');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'dead-set drop: functions still present: %', leftover;
  END IF;

  IF to_regprocedure('public.get_player_boss_performance(text,text)') IS NULL THEN
    RAISE EXCEPTION 'dead-set drop: the LIVE 2-arg get_player_boss_performance is missing';
  END IF;

  -- Dynamic SQL: a static reference to cron.job fails to PARSE (42P01) where
  -- the schema is absent, regardless of short-circuiting (see the unschedule
  -- step above and supabase/tests/pgtap/wi4000_bomb_alerts_quiet_hours.sql).
  IF to_regnamespace('cron') IS NOT NULL THEN
    DECLARE
      cron_job_survived boolean;
    BEGIN
      EXECUTE $sql$
        SELECT EXISTS (
          SELECT 1 FROM cron.job
           WHERE jobname IN ('refresh-guild-performance-cache','refresh-guild-veterans','eot-refresh-guild-performance-cache','eot-refresh-guild-veterans')
        )
      $sql$ INTO cron_job_survived;
      IF cron_job_survived THEN
        RAISE EXCEPTION 'dead-set drop: a matview refresh cron job survived';
      END IF;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.hero_mappings'::regclass
             AND NOT attisdropped AND attname IN ('sorting','long_name','description')) THEN
    RAISE EXCEPTION 'dead-set drop: hero_mappings dead columns survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.guild_war_leaderboards'::regclass
             AND NOT attisdropped AND attname = 'current_rank') THEN
    RAISE EXCEPTION 'dead-set drop: current_rank must be KEPT (read by get_guild_war_showcase_summary)';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;

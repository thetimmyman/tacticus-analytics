-- Retire the orphaned Competitive Intel schema from General; nothing references it.
-- The guard keeps this off the sibling database's copy.
-- target-db: general

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
SET LOCAL statement_timeout = '120s';

-- CASCADE only reaches each table's own triggers, indexes and policies.
DROP TABLE IF EXISTS public.competitive_rival_replay_target_snapshot_entry CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_target_snapshot CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_target_member CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_target CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_projection CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_observation CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_analysis_attempt CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_ingestion_run CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_upload_reservation CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_access_audit CASCADE;
DROP TABLE IF EXISTS public.competitive_rival_replay_blob CASCADE;
DROP TABLE IF EXISTS public.competitive_public_totals CASCADE;
DROP TABLE IF EXISTS public.competitive_guild_labels CASCADE;
DROP TABLE IF EXISTS public.rival_reconstructed_hits_sweep_backup_20260716 CASCADE;
DROP TABLE IF EXISTS public.rival_reconstructed_hits CASCADE;
DROP TABLE IF EXISTS public.rival_hit_overrides CASCADE;
DROP TABLE IF EXISTS public.rival_guild_names CASCADE;
DROP TABLE IF EXISTS public.rival_diff_state CASCADE;

-- Functions after tables and without CASCADE, so a missed dependency fails, not vanishes.
DROP FUNCTION IF EXISTS public._competitive_rival_replay_boss_evidence(p_unit_id text);
DROP FUNCTION IF EXISTS public._competitive_rival_replay_enrich_projection();
DROP FUNCTION IF EXISTS public._competitive_rival_replay_hit_comparison_batch(p_observation_ids uuid[]);
DROP FUNCTION IF EXISTS public._competitive_rival_replay_invalidate_analysis();
DROP FUNCTION IF EXISTS public._competitive_rival_replay_prime_hp_band(p_percent numeric);
DROP FUNCTION IF EXISTS public._pm_caller_is_competitive_reader();
DROP FUNCTION IF EXISTS public.apply_competitive_guild_label(p_guild_id text, p_short_code text, p_display_name text);
DROP FUNCTION IF EXISTS public.apply_public_total_snapshots(p_season integer, p_observed_at timestamp with time zone, p_rows jsonb);
DROP FUNCTION IF EXISTS public.apply_rival_hit_override(p_target_hit_id bigint, p_action text, p_override_damage bigint, p_note text, p_expected_version integer);
DROP FUNCTION IF EXISTS public.apply_rival_reconstruction(p_guild_id uuid, p_season integer, p_guild_tag text, p_expected_prev_total bigint, p_hits jsonb, p_new_cursor jsonb);
DROP FUNCTION IF EXISTS public.backfill_competitive_rival_replay_blob_user_id(p_entries jsonb);
DROP FUNCTION IF EXISTS public.backfill_competitive_rival_replay_boss_max_health(p_entries jsonb);
DROP FUNCTION IF EXISTS public.begin_competitive_rival_replay_ingestion_run(p_capture_job_id uuid, p_provider_guild_id text, p_catalog_sha256 text, p_catalog_cursor text);
DROP FUNCTION IF EXISTS public.claim_competitive_rival_capture_target(p_capture_job_id uuid, p_provider_guild_id text);
DROP FUNCTION IF EXISTS public.claim_competitive_rival_replay_blob(p_content_sha256 text, p_byte_count bigint);
DROP FUNCTION IF EXISTS public.claim_competitive_rival_roster_refresh_scope(p_max_targets integer);
DROP FUNCTION IF EXISTS public.clear_competitive_rival_roster_on_retirement();
DROP FUNCTION IF EXISTS public.commit_competitive_rival_replay_analysis(p_observation_id uuid, p_taxonomy_version text, p_scorer_version text, p_axes jsonb, p_luck jsonb, p_luck_details jsonb, p_boss_health bigint, p_boss_remaining_health bigint);
DROP FUNCTION IF EXISTS public.commit_competitive_rival_replay_observation(p_run_id uuid, p_provider_guild_id text, p_provider_replay_hash text, p_catalog_sha256 text, p_catalog_ordinal bigint, p_replay_observed_at timestamp with time zone, p_listed_for_provider_player_id text);
DROP FUNCTION IF EXISTS public.commit_competitive_rival_replay_projection(p_observation_id uuid, p_blob_id uuid, p_projection jsonb);
DROP FUNCTION IF EXISTS public.commit_competitive_rival_target_snapshot(p_generation text, p_leaderboard_season text, p_observed_at timestamp with time zone, p_entries jsonb);
DROP FUNCTION IF EXISTS public.confirm_competitive_rival_orphan_cleanup(p_content_sha256 text, p_temporary_object_key text, p_final_object_key text);
DROP FUNCTION IF EXISTS public.confirm_competitive_rival_replay_blob_purge(p_blob_id uuid, p_object_key text, p_actor_user_id uuid, p_purpose text);
DROP FUNCTION IF EXISTS public.delete_competitive_rival_replay_observation(p_observation_id uuid, p_actor_user_id uuid, p_purpose text);
DROP FUNCTION IF EXISTS public.finalize_competitive_rival_replay_blob(p_content_sha256 text, p_reservation_token uuid, p_final_object_key text, p_byte_count bigint);
DROP FUNCTION IF EXISTS public.finish_competitive_rival_replay_ingestion_run(p_run_id uuid, p_status competitive_rival_replay_run_status, p_list_calls integer, p_physical_http_attempts integer, p_download_count integer, p_downloaded_bytes bigint, p_retry_count integer, p_redacted_error_class text);
DROP FUNCTION IF EXISTS public.get_competitive_boss_hits(p_season integer, p_guild_code text, p_after_id bigint, p_limit integer);
DROP FUNCTION IF EXISTS public.get_competitive_rival_capture_scope(p_max_targets integer, p_require_fresh_roster boolean);
DROP FUNCTION IF EXISTS public.get_competitive_rival_ledger_boss_hits(p_season integer, p_guild_id text, p_after text, p_limit integer);
DROP FUNCTION IF EXISTS public.get_competitive_rival_ledger_reconciliation(p_season integer);
DROP FUNCTION IF EXISTS public.get_competitive_rival_orphan_cleanup_candidates(p_limit integer);
DROP FUNCTION IF EXISTS public.get_competitive_rival_replay_catalog(p_filters jsonb, p_limit integer, p_cursor jsonb, p_sort text);
DROP FUNCTION IF EXISTS public.get_competitive_rival_replay_catalog_wi4060(p_filters jsonb, p_limit integer, p_cursor jsonb, p_sort text);
DROP FUNCTION IF EXISTS public.get_competitive_rival_replay_gc_candidates(p_limit integer);
DROP FUNCTION IF EXISTS public.get_competitive_rival_replay_hit_ledger(p_provider_guild_id text, p_season integer, p_limit integer, p_cursor_at timestamp with time zone, p_cursor_id uuid);
DROP FUNCTION IF EXISTS public.get_rival_boss_hits(p_season integer, p_guild_id uuid, p_after_id bigint, p_limit integer);
DROP FUNCTION IF EXISTS public.get_rival_boss_hp(p_season integer);
DROP FUNCTION IF EXISTS public.get_rival_exact_loop_overlay(p_season integer, p_guild_id text, p_after text, p_limit integer);
DROP FUNCTION IF EXISTS public.get_rival_guild_fingerprints(p_season integer);
DROP FUNCTION IF EXISTS public.get_rival_seasons();
DROP FUNCTION IF EXISTS public.guard_competitive_rival_saved_observation_blob();
DROP FUNCTION IF EXISTS public.list_competitive_rival_replay_blob_user_id_backfill(p_limit integer, p_after uuid);
DROP FUNCTION IF EXISTS public.list_competitive_rival_replay_boss_max_health_backfill(p_limit integer, p_after uuid);
DROP FUNCTION IF EXISTS public.list_competitive_rival_replays_for_analysis(p_taxonomy_version text, p_scorer_version text, p_limit integer, p_after uuid);
DROP FUNCTION IF EXISTS public.lock_competitive_rival_departed_rosters();
DROP FUNCTION IF EXISTS public.mark_competitive_rival_replay_observation_terminal(p_observation_id uuid);
DROP FUNCTION IF EXISTS public.prune_competitive_rival_replay_private_state(p_limit integer);
DROP FUNCTION IF EXISTS public.reconcile_competitive_rival_target_roster(p_provider_guild_id text, p_roster_generation text, p_observed_at timestamp with time zone, p_player_ids jsonb);
DROP FUNCTION IF EXISTS public.resolve_competitive_rival_replay_locator(p_playback_id text, p_user_id uuid, p_purpose text);

DROP TYPE IF EXISTS public.competitive_rival_replay_run_status;
DROP TYPE IF EXISTS public.competitive_rival_replay_observation_status;
DROP TYPE IF EXISTS public.competitive_rival_replay_blob_status;

DO $verify$
DECLARE
  leftover_tables integer;
  leftover_functions integer;
  leftover_types integer;
BEGIN
  SELECT count(*)::integer INTO leftover_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (c.relname LIKE 'competitive%' OR c.relname LIKE 'rival%');

  SELECT count(*)::integer INTO leftover_functions
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE '%competitive%' OR p.proname LIKE '%rival%'
         OR p.proname = 'apply_public_total_snapshots');

  SELECT count(*)::integer INTO leftover_types
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
    AND (t.typname LIKE '%competitive%' OR t.typname LIKE '%rival%');

  IF leftover_tables <> 0 OR leftover_functions <> 0 OR leftover_types <> 0 THEN
    RAISE EXCEPTION
      'Competitive Intel schema not fully retired: % tables, % functions, % types remain',
      leftover_tables, leftover_functions, leftover_types;
  END IF;
END;
$verify$;

COMMIT;

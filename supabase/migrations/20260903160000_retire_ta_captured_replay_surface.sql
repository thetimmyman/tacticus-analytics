-- Retire the captured-replay surface from General; only the Terminus community path
-- survives. Replay files stay in object storage; this drops only the index.
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
SET LOCAL statement_timeout = '180s';

-- Detach the surviving table and rebuild its writer without the dropped column.
ALTER TABLE public.guild_featured_replays
  DROP CONSTRAINT IF EXISTS guild_featured_replays_captured_replay_id_fkey;

CREATE OR REPLACE FUNCTION public.replace_guild_featured_pin(
  p_guild_code text,
  p_boss_id text,
  p_encounter_role text,
  p_replay_id uuid,
  p_pinned_by uuid
)
RETURNS guild_featured_replays
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.guild_featured_replays;
BEGIN
  IF nullif(btrim(p_guild_code), '') IS NULL
     OR nullif(btrim(p_boss_id), '') IS NULL
     OR p_encounter_role NOT IN ('boss', 'prime', 'sideboss')
     OR p_replay_id IS NULL THEN
    RAISE EXCEPTION 'invalid featured replay pin'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.guild_featured_replays AS featured (
    guild_code, boss_id, encounter_role, season,
    replay_id, pinned_by
  ) VALUES (
    p_guild_code, p_boss_id, p_encounter_role, NULL,
    p_replay_id, p_pinned_by
  )
  ON CONFLICT (guild_code, boss_id, encounter_role, COALESCE(season, ''))
  DO UPDATE SET
    replay_id = EXCLUDED.replay_id,
    pinned_by = EXCLUDED.pinned_by,
    pinned_at = now(),
    updated_at = now()
  RETURNING featured.* INTO v_row;

  RETURN v_row;
END
$function$;

ALTER TABLE public.guild_featured_replays DROP COLUMN IF EXISTS captured_replay_id;

-- CASCADE only reaches each table's own triggers, indexes and policies.
DROP TABLE IF EXISTS public.captured_replay_ingestion_observation CASCADE;
DROP TABLE IF EXISTS public.captured_replay_link_evaluation_audit CASCADE;
DROP TABLE IF EXISTS public.captured_replay_link_current CASCADE;
DROP TABLE IF EXISTS public.captured_replay_visibility_audit CASCADE;
DROP TABLE IF EXISTS public.captured_replay_analysis_runtime CASCADE;
DROP TABLE IF EXISTS public.captured_replay_move_index_build CASCADE;
DROP TABLE IF EXISTS public.captured_replay_move_index CASCADE;
DROP TABLE IF EXISTS public.captured_replay_serving_current CASCADE;
DROP TABLE IF EXISTS public.captured_replay_projection CASCADE;
DROP TABLE IF EXISTS public.captured_replay_private_source CASCADE;
DROP TABLE IF EXISTS public.captured_replay_ingestion_run CASCADE;
DROP TABLE IF EXISTS public.replay_luck_scoring_attempt CASCADE;
DROP TABLE IF EXISTS public.replay_encounter_axis_status CASCADE;
DROP TABLE IF EXISTS public.replay_encounter_profile CASCADE;
DROP TABLE IF EXISTS public.guildchat_replay_captures CASCADE;
DROP TABLE IF EXISTS public.guildchat_replay_cursors CASCADE;
DROP TABLE IF EXISTS public.guild_war_replay_link CASCADE;
DROP TABLE IF EXISTS public.guild_replay_capture_optin_audit CASCADE;
DROP TABLE IF EXISTS public.guild_replay_capture_optin CASCADE;
DROP TABLE IF EXISTS public.guild_replay_public_policy CASCADE;
DROP TABLE IF EXISTS public.guild_replay_scrape_source CASCADE;

-- Functions after tables and without CASCADE, so a missed dependency fails, not vanishes.
DROP FUNCTION IF EXISTS public._append_captured_replay_link_audit(p_replay_id uuid, p_previous_state captured_replay_link_state, p_new_state captured_replay_link_state, p_matcher_version text, p_index_version text, p_candidate_count integer, p_source_time_delta_ms bigint, p_evidence jsonb, p_selected_fingerprint text, p_current_eot_gr_data_id bigint, p_reason_codes text[], p_attempt integer, p_actor uuid);
DROP FUNCTION IF EXISTS public._append_captured_replay_visibility_audit(p_owning_guild_code text, p_replay_id uuid, p_action text, p_actor uuid, p_before_state jsonb, p_after_state jsonb, p_outcome text);
DROP FUNCTION IF EXISTS public._captured_replay_apply_prime_status(p_replay_id uuid);
DROP FUNCTION IF EXISTS public._captured_replay_bounded_token_list(p_values text[], p_max_items integer, p_max_length integer);
DROP FUNCTION IF EXISTS public._captured_replay_calculate_prime_status(p_replay_id uuid);
DROP FUNCTION IF EXISTS public._captured_replay_caller_scope();
DROP FUNCTION IF EXISTS public._captured_replay_catalog_axis_filter(p_axes jsonb, p_key text);
DROP FUNCTION IF EXISTS public._captured_replay_catalog_damage_bound(p_value jsonb, p_key text);
DROP FUNCTION IF EXISTS public._captured_replay_catalog_text_filter(p_value jsonb, p_key text);
DROP FUNCTION IF EXISTS public._captured_replay_displace_cross_guild_link(p_incumbent_replay_id uuid, p_claimant_replay_id uuid);
DROP FUNCTION IF EXISTS public._captured_replay_eot_team_unit_ids(p_hero_details text, p_machine_of_war_details text);
DROP FUNCTION IF EXISTS public._captured_replay_hit_comparison_batch(p_download_ids text[]);
DROP FUNCTION IF EXISTS public._captured_replay_link_is_cross_guild(p_replay_id uuid);
DROP FUNCTION IF EXISTS public._captured_replay_meta_team_key(p_team_unit_ids text[]);
DROP FUNCTION IF EXISTS public._captured_replay_player_history_scope(p_target_mapping_id bigint);
DROP FUNCTION IF EXISTS public._captured_replay_player_visible_rows(p_target_mapping_id bigint, p_modes text[]);
DROP FUNCTION IF EXISTS public._captured_replay_prime_history_side(p_linked_eot_id bigint, p_boss_type text, p_side integer, p_attacked boolean);
DROP FUNCTION IF EXISTS public._captured_replay_prime_hp_band(p_percent numeric);
DROP FUNCTION IF EXISTS public._captured_replay_prime_resolve_family(p_encounter_index integer, p_unit_id text, p_raid_type text);
DROP FUNCTION IF EXISTS public._captured_replay_projection_enrich_meta_team();
DROP FUNCTION IF EXISTS public._captured_replay_require_service();
DROP FUNCTION IF EXISTS public._captured_replay_visible_player_name(p_display_name text, p_viewer_relationship text, p_player_name_audience text);
DROP FUNCTION IF EXISTS public._set_guild_replay_capture_optin_audience(p_guild_code text, p_enabled boolean, p_consent_version text, p_actor uuid, p_authority_scope text, p_capture_audience_scope text);
DROP FUNCTION IF EXISTS public.acquire_captured_replay_ingestion_run(p_guild_code text, p_catalog_sha text, p_expected_count bigint, p_pointer_generated_at timestamp with time zone, p_lease_ttl_seconds integer);
DROP FUNCTION IF EXISTS public.append_herald_captured_replay_link(p_guild_code text, p_boss_id text, p_label text, p_url text, p_updated_by uuid);
DROP FUNCTION IF EXISTS public.backfill_captured_replay_listing_metadata(p_guild_code text, p_rows jsonb);
DROP FUNCTION IF EXISTS public.captured_replay_battle_fingerprint_v1(p_guild text, p_season integer, p_player_id text, p_encounter_id integer, p_started_at timestamp with time zone, p_completed_at timestamp with time zone, p_damage bigint, p_damage_type text);
DROP FUNCTION IF EXISTS public.captured_replay_frozen_modes_visible();
DROP FUNCTION IF EXISTS public.captured_replay_hidden_modes();
DROP FUNCTION IF EXISTS public.captured_replay_ingestion_run_guard_immutable();
DROP FUNCTION IF EXISTS public.captured_replay_private_source_guard_immutable();
DROP FUNCTION IF EXISTS public.captured_replay_reject_mutation();
DROP FUNCTION IF EXISTS public.captured_replay_role_from_boss_id(p_boss_id text);
DROP FUNCTION IF EXISTS public.captured_replay_visible_mode_allowlist();
DROP FUNCTION IF EXISTS public.commit_captured_replay_ingestion_batch(p_guild_code text, p_catalog_sha text, p_lease_owner uuid, p_lease_generation bigint, p_expected_ordinal bigint, p_rows jsonb);
DROP FUNCTION IF EXISTS public.commit_guild_war_replay_link(p_replay_id uuid, p_payload jsonb);
DROP FUNCTION IF EXISTS public.commit_replay_encounter_profiles(p_rows jsonb, p_taxonomy_version text);
DROP FUNCTION IF EXISTS public.commit_replay_encounter_verdicts(p_rows jsonb);
DROP FUNCTION IF EXISTS public.copy_captured_replay_prime_status_to_serving();
DROP FUNCTION IF EXISTS public.get_captured_replay_battle_record_links(p_eot_gr_data_ids bigint[]);
DROP FUNCTION IF EXISTS public.get_captured_replay_catalog(p_filters jsonb, p_limit integer, p_cursor jsonb, p_sort text, p_include_facets boolean);
DROP FUNCTION IF EXISTS public.get_captured_replay_catalog_wi4070(p_filters jsonb, p_limit integer, p_cursor jsonb, p_sort text, p_include_facets boolean);
DROP FUNCTION IF EXISTS public.get_captured_replay_catalog_wi4080(p_filters jsonb, p_limit integer, p_cursor jsonb, p_sort text, p_include_facets boolean);
DROP FUNCTION IF EXISTS public.get_captured_replay_herald_candidates(p_target_guild_code text, p_season integer, p_boss_unit_id text, p_rarity text, p_set_number integer, p_encounter_index integer, p_limit integer);
DROP FUNCTION IF EXISTS public.get_captured_replay_ingestion_source_status(p_guild_code text, p_provider_hashes text[]);
DROP FUNCTION IF EXISTS public.get_captured_replay_pipeline_health(p_requesting_guild_code text, p_window_hours integer);
DROP FUNCTION IF EXISTS public.get_captured_replay_playbook_candidates(p_seasons integer[], p_limit_per_encounter integer);
DROP FUNCTION IF EXISTS public.get_captured_replay_player_history(p_target_mapping_id bigint, p_seasons integer[], p_boss_query text, p_board_query text, p_meta_team_query text, p_team_unit_id text, p_min_damage bigint, p_max_damage bigint, p_before_occurred_at timestamp with time zone, p_before_replay_id uuid, p_limit integer, p_modes text[], p_outcome text, p_boss_ids text[], p_board_ids text[], p_meta_team_keys text[], p_team_unit_ids text[], p_outcomes text[]);
DROP FUNCTION IF EXISTS public.get_captured_replay_player_history_facets(p_target_mapping_id bigint, p_modes text[]);
DROP FUNCTION IF EXISTS public.get_captured_replay_player_mode_counts(p_target_mapping_id bigint);
DROP FUNCTION IF EXISTS public.get_guild_war_battle_catalog(p_filters jsonb, p_limit integer, p_cursor jsonb, p_sort text, p_include_facets boolean);
DROP FUNCTION IF EXISTS public.get_move_index_build_locators(p_board_id text, p_boss_id text, p_encounter_id integer, p_limit integer, p_offset integer, p_rarity text, p_season integer, p_set_number integer);
DROP FUNCTION IF EXISTS public.get_my_guild_replay_sharing_settings();
DROP FUNCTION IF EXISTS public.get_replay_encounter_profile(p_download_id text);
DROP FUNCTION IF EXISTS public.guild_replay_capture_optin_touch_updated_at();
DROP FUNCTION IF EXISTS public.guild_replay_scrape_source_reset_verification();
DROP FUNCTION IF EXISTS public.invalidate_guild_featured_pins_on_capture_move();
DROP FUNCTION IF EXISTS public.invalidate_guild_featured_pins_on_capture_optout();
DROP FUNCTION IF EXISTS public.list_captured_replays_for_relink(p_limit integer);
DROP FUNCTION IF EXISTS public.list_guild_war_replays_for_linking(p_limit integer, p_after uuid);
DROP FUNCTION IF EXISTS public.list_replays_for_classification(p_taxonomy_version text, p_limit integer, p_after uuid);
DROP FUNCTION IF EXISTS public.list_replays_for_luck_scoring(p_taxonomy_version text, p_scorer_version text, p_limit integer, p_after uuid);
DROP FUNCTION IF EXISTS public.locate_captured_replay_media(p_download_id text, p_owning_guild_code text);
DROP FUNCTION IF EXISTS public.manually_assign_captured_replay_link(p_replay_id uuid, p_current_eot_gr_data_id bigint, p_actor uuid, p_reason text);
DROP FUNCTION IF EXISTS public.mark_replay_luck_scoring_attempt(p_replay_id uuid, p_taxonomy_version text, p_scorer_version text, p_status text, p_reason text);
DROP FUNCTION IF EXISTS public.match_captured_replay_next_move(p_canonical_board_id text, p_canonical_boss_id text, p_encounter_id integer, p_positions jsonb, p_rarity text, p_season integer, p_set_number integer, p_team_unit_ids text[], p_turn integer, p_hp_bands jsonb, p_limit integer);
DROP FUNCTION IF EXISTS public.preview_captured_replay_prime_status(p_replay_ids uuid[]);
DROP FUNCTION IF EXISTS public.record_captured_replay_ingestion_retryable(p_guild_code text, p_catalog_sha text, p_lease_owner uuid, p_lease_generation bigint, p_expected_ordinal bigint, p_replay_id uuid, p_reason_code text, p_matcher_version text, p_next_attempt_at timestamp with time zone);
DROP FUNCTION IF EXISTS public.refresh_captured_replay_prime_status_on_link();
DROP FUNCTION IF EXISTS public.relink_captured_replay_raid_links(p_guild_code text, p_rows jsonb);
DROP FUNCTION IF EXISTS public.rename_guild_code(p_old_guild_code text, p_new_guild_code text, p_allow_immutable_skips boolean);
DROP FUNCTION IF EXISTS public.renew_captured_replay_ingestion_lease(p_guild_code text, p_catalog_sha text, p_lease_owner uuid, p_lease_generation bigint, p_lease_ttl_seconds integer);
DROP FUNCTION IF EXISTS public.replace_guild_featured_captured_replay(p_guild_code text, p_boss_id text, p_encounter_role text, p_captured_replay_id uuid, p_pinned_by uuid);
DROP FUNCTION IF EXISTS public.reproject_captured_replay_prime_status(p_replay_ids uuid[], p_guild_code text, p_limit integer);
DROP FUNCTION IF EXISTS public.reproject_captured_replay_team_units(p_guild_code text, p_rows jsonb);
DROP FUNCTION IF EXISTS public.resolve_captured_replay_gateway_locator(p_download_id text, p_user_id uuid);
DROP FUNCTION IF EXISTS public.set_captured_replay_hidden_by_locator(p_download_id text, p_hidden boolean);
DROP FUNCTION IF EXISTS public.set_captured_replay_prime_status_runtime(p_calculation_enabled boolean, p_catalog_exposure_enabled boolean, p_updated_by uuid);
DROP FUNCTION IF EXISTS public.set_captured_replay_visibility(p_replay_id uuid, p_visibility text);
DROP FUNCTION IF EXISTS public.set_captured_replay_visibility_by_locator(p_download_id text, p_visibility text);
DROP FUNCTION IF EXISTS public.set_guild_replay_capture_optin_audience(p_guild_code text, p_enabled boolean, p_consent_version text, p_actor uuid, p_authority_scope text, p_capture_audience_scope text);
DROP FUNCTION IF EXISTS public.set_my_guild_replay_player_name_audience(p_audience text);
DROP FUNCTION IF EXISTS public.set_my_guild_replay_public_policy(p_enabled boolean);
DROP FUNCTION IF EXISTS public.set_my_guild_replay_public_sharing(p_enabled boolean);
DROP FUNCTION IF EXISTS public.upsert_captured_replay_move_index(p_index_version text, p_parser_version text, p_replay_id uuid, p_rows jsonb);
DROP FUNCTION IF EXISTS public.upsert_guild_replay_capture_optin(p_guild_code text, p_cluster_code text, p_enabled boolean, p_consent_version text, p_actor uuid, p_authority_scope text);

DO $verify$
DECLARE
  leftover_tables integer;
  leftover_functions integer;
  featured_column integer;
BEGIN
  SELECT count(*)::integer INTO leftover_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname IN (
      'captured_replay_ingestion_observation','captured_replay_projection',
      'captured_replay_serving_current','captured_replay_move_index',
      'captured_replay_private_source','replay_encounter_profile',
      'replay_luck_scoring_attempt','captured_replay_link_current',
      'captured_replay_link_evaluation_audit','captured_replay_ingestion_run',
      'guild_war_replay_link','guildchat_replay_captures',
      'captured_replay_move_index_build','replay_encounter_axis_status',
      'guild_replay_capture_optin','guild_replay_scrape_source',
      'guildchat_replay_cursors','guild_replay_capture_optin_audit',
      'captured_replay_visibility_audit','guild_replay_public_policy',
      'captured_replay_analysis_runtime'
    );

  SELECT count(*)::integer INTO leftover_functions
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> 'replace_guild_featured_pin'
    AND p.proname NOT ILIKE '%competitive%'
    AND p.proname NOT ILIKE '%rival%'
    AND pg_get_functiondef(p.oid) ~* '(captured_replay_|guildchat_replay_|guild_replay_|replay_encounter_|replay_luck_scoring_attempt|guild_war_replay_link)';

  SELECT count(*)::integer INTO featured_column
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'guild_featured_replays'
    AND column_name = 'captured_replay_id';

  IF leftover_tables <> 0 OR leftover_functions <> 0 OR featured_column <> 0 THEN
    RAISE EXCEPTION
      'Replay surface not fully retired: % tables, % functions, % featured columns remain',
      leftover_tables, leftover_functions, featured_column;
  END IF;

  -- Positive control: the Terminus community path must still be here.
  IF to_regclass('public.boss_playbook_replays') IS NULL
     OR to_regclass('public.replay_ingest_queue') IS NULL
     OR to_regclass('public.guild_featured_replays') IS NULL THEN
    RAISE EXCEPTION 'Terminus community replay tables were removed; they must survive';
  END IF;
END
$verify$;

COMMIT;

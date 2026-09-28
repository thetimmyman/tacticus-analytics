-- target-db: general
-- A sibling repo retired these 70 functions live as consumer-free (one sibling in
-- that batch, get_all_boss_hp, is excluded here -- see
-- 20260928060000_recreate_get_all_boss_hp.sql, it has a real caller). This repo's
-- clean baseline still creates all 70, so replaying these migrations against a fresh
-- database does not match production. Every drop is signature-specific and confirmed
-- absent live already, so IF EXISTS makes this a no-op against production.

BEGIN;

DROP FUNCTION IF EXISTS public.add_guild_to_cluster(text,text,text,text);
DROP FUNCTION IF EXISTS public.add_guild_to_cluster_safe(text,text,text,text);
DROP FUNCTION IF EXISTS public.analyze_player_progression(text,text);
DROP FUNCTION IF EXISTS public.batch_repair_unmapped_players(text,jsonb);
DROP FUNCTION IF EXISTS public.bulk_insert_battle_data(jsonb,text);
DROP FUNCTION IF EXISTS public.bulk_upsert_player_mappings(jsonb);
DROP FUNCTION IF EXISTS public.calculate_votlw_for_season(text,text);
DROP FUNCTION IF EXISTS public.calculate_votlw_if_scheduled();
DROP FUNCTION IF EXISTS public.can_view_playbook_full(character varying,text,text,uuid);
DROP FUNCTION IF EXISTS public.check_database_health();
DROP FUNCTION IF EXISTS public.compare_guilds(text[],text);
DROP FUNCTION IF EXISTS public.debug_player_duplicates(text);
DROP FUNCTION IF EXISTS public.delete_user_profile(uuid);
DROP FUNCTION IF EXISTS public.expire_ended_trials();
DROP FUNCTION IF EXISTS public.format_team_composition(jsonb,text);
DROP FUNCTION IF EXISTS public.get_ability_stat(integer,integer,text);
DROP FUNCTION IF EXISTS public.get_active_clusters();
DROP FUNCTION IF EXISTS public.get_admin_support_unread_count();
DROP FUNCTION IF EXISTS public.get_boss_encounters(text,text,boolean);
DROP FUNCTION IF EXISTS public.get_boss_encounters_cluster(text,text);
DROP FUNCTION IF EXISTS public.get_boss_leaderboard(text,text,text,integer);
DROP FUNCTION IF EXISTS public.get_boss_playbook(text);
DROP FUNCTION IF EXISTS public.get_checkout_session_data(text);
DROP FUNCTION IF EXISTS public.get_cluster_battle_data(text);
DROP FUNCTION IF EXISTS public.get_cluster_discord_webhooks(character varying);
DROP FUNCTION IF EXISTS public.get_five_season_averages(text,integer);
DROP FUNCTION IF EXISTS public.get_flexible_token_coverage(text,text);
DROP FUNCTION IF EXISTS public.get_guild_boss_leaderboard_v2(text,text,text);
DROP FUNCTION IF EXISTS public.get_guild_historical_performance(text,integer);
DROP FUNCTION IF EXISTS public.get_guild_member_counts();
DROP FUNCTION IF EXISTS public.get_guild_overall_leaderboard_v2(text,text);
DROP FUNCTION IF EXISTS public.get_homepage_statistics();
DROP FUNCTION IF EXISTS public.get_latest_guild_snapshots(text,text);
DROP FUNCTION IF EXISTS public.get_mythic_boss_hp();
DROP FUNCTION IF EXISTS public.get_player_boss_performance_cluster(text,text,text);
DROP FUNCTION IF EXISTS public.get_player_boss_performance_historical_cluster(text,text);
DROP FUNCTION IF EXISTS public.get_player_context(text,text);
DROP FUNCTION IF EXISTS public.get_player_historical_performance(text,text,text);
DROP FUNCTION IF EXISTS public.get_player_mapping_debug(uuid);
DROP FUNCTION IF EXISTS public.get_player_performance(text,text);
DROP FUNCTION IF EXISTS public.get_player_performance_in_cluster_v2(text,text,text,text);
DROP FUNCTION IF EXISTS public.get_player_team_compositions_simple(text,integer);
DROP FUNCTION IF EXISTS public.get_public_stats_cached();
DROP FUNCTION IF EXISTS public.get_public_stats_v2();
DROP FUNCTION IF EXISTS public.get_table_columns(text);
DROP FUNCTION IF EXISTS public.get_user_profile(uuid);
DROP FUNCTION IF EXISTS public.get_user_support_unread_count(uuid);
DROP FUNCTION IF EXISTS public.get_veteran_players_stats(text);
DROP FUNCTION IF EXISTS public.get_war_battle_history(text,text);
DROP FUNCTION IF EXISTS public.handle_guild_sync_request(text,uuid);
DROP FUNCTION IF EXISTS public.hash_password(text);
DROP FUNCTION IF EXISTS public.is_user_officer_or_leader(uuid);
DROP FUNCTION IF EXISTS public.log_edge_function_execution(character varying,character varying,character varying,jsonb);
DROP FUNCTION IF EXISTS public.mark_support_messages_read(uuid,uuid,boolean);
DROP FUNCTION IF EXISTS public.migrate_player_api_key(text,text);
DROP FUNCTION IF EXISTS public.migrate_to_v2_functions();
DROP FUNCTION IF EXISTS public.recommend_boss_teams(text,text[]);
DROP FUNCTION IF EXISTS public.refresh_member_stats_summary();
DROP FUNCTION IF EXISTS public.register_user(text,text,text);
DROP FUNCTION IF EXISTS public.schedule_tacticus_data_import(interval);
DROP FUNCTION IF EXISTS public.search_players_simple(text);
DROP FUNCTION IF EXISTS public.test_performance_calculations(text,text);
DROP FUNCTION IF EXISTS public.trigger_historical_backfill();
DROP FUNCTION IF EXISTS public.trigger_historical_backfill_all();
DROP FUNCTION IF EXISTS public.update_player_api_key(text,text);
DROP FUNCTION IF EXISTS public.update_user_profile(uuid,text);
DROP FUNCTION IF EXISTS public.upsert_subscription_from_stripe(text,text,text,text,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone);
DROP FUNCTION IF EXISTS public.validate_player_consistency();
DROP FUNCTION IF EXISTS public.validate_player_id_architecture();
DROP FUNCTION IF EXISTS public.verify_password(text,text);

DO $verify$
DECLARE
  still_present text[];
BEGIN
  SELECT array_agg(sig) INTO still_present FROM unnest(ARRAY[
    'add_guild_to_cluster(text,text,text,text)',
    'add_guild_to_cluster_safe(text,text,text,text)',
    'analyze_player_progression(text,text)',
    'batch_repair_unmapped_players(text,jsonb)',
    'bulk_insert_battle_data(jsonb,text)',
    'bulk_upsert_player_mappings(jsonb)',
    'calculate_votlw_for_season(text,text)',
    'calculate_votlw_if_scheduled()',
    'can_view_playbook_full(character varying,text,text,uuid)',
    'check_database_health()',
    'compare_guilds(text[],text)',
    'debug_player_duplicates(text)',
    'delete_user_profile(uuid)',
    'expire_ended_trials()',
    'format_team_composition(jsonb,text)',
    'get_ability_stat(integer,integer,text)',
    'get_active_clusters()',
    'get_admin_support_unread_count()',
    'get_boss_encounters(text,text,boolean)',
    'get_boss_encounters_cluster(text,text)',
    'get_boss_leaderboard(text,text,text,integer)',
    'get_boss_playbook(text)',
    'get_checkout_session_data(text)',
    'get_cluster_battle_data(text)',
    'get_cluster_discord_webhooks(character varying)',
    'get_five_season_averages(text,integer)',
    'get_flexible_token_coverage(text,text)',
    'get_guild_boss_leaderboard_v2(text,text,text)',
    'get_guild_historical_performance(text,integer)',
    'get_guild_member_counts()',
    'get_guild_overall_leaderboard_v2(text,text)',
    'get_homepage_statistics()',
    'get_latest_guild_snapshots(text,text)',
    'get_mythic_boss_hp()',
    'get_player_boss_performance_cluster(text,text,text)',
    'get_player_boss_performance_historical_cluster(text,text)',
    'get_player_context(text,text)',
    'get_player_historical_performance(text,text,text)',
    'get_player_mapping_debug(uuid)',
    'get_player_performance(text,text)',
    'get_player_performance_in_cluster_v2(text,text,text,text)',
    'get_player_team_compositions_simple(text,integer)',
    'get_public_stats_cached()',
    'get_public_stats_v2()',
    'get_table_columns(text)',
    'get_user_profile(uuid)',
    'get_user_support_unread_count(uuid)',
    'get_veteran_players_stats(text)',
    'get_war_battle_history(text,text)',
    'handle_guild_sync_request(text,uuid)',
    'hash_password(text)',
    'is_user_officer_or_leader(uuid)',
    'log_edge_function_execution(character varying,character varying,character varying,jsonb)',
    'mark_support_messages_read(uuid,uuid,boolean)',
    'migrate_player_api_key(text,text)',
    'migrate_to_v2_functions()',
    'recommend_boss_teams(text,text[])',
    'refresh_member_stats_summary()',
    'register_user(text,text,text)',
    'schedule_tacticus_data_import(interval)',
    'search_players_simple(text)',
    'test_performance_calculations(text,text)',
    'trigger_historical_backfill()',
    'trigger_historical_backfill_all()',
    'update_player_api_key(text,text)',
    'update_user_profile(uuid,text)',
    'upsert_subscription_from_stripe(text,text,text,text,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone)',
    'validate_player_consistency()',
    'validate_player_id_architecture()',
    'verify_password(text,text)'
  ]) AS sig
  WHERE to_regprocedure('public.' || sig) IS NOT NULL;

  IF still_present IS NOT NULL THEN
    RAISE EXCEPTION 'still live after the carried-forward retirement: %', still_present;
  END IF;

  IF to_regprocedure('public.get_all_boss_hp(text)') IS NULL THEN
    RAISE EXCEPTION 'get_all_boss_hp must stay live -- it is not part of this retirement';
  END IF;
END;
$verify$;

COMMIT;

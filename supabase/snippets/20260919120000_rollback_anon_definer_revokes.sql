-- Rollback of 20260919120000: re-opens 23 anon corridors into SECURITY DEFINER
-- functions; use only for a confirmed regression. PUBLIC is deliberately not restored.

BEGIN;

GRANT EXECUTE ON FUNCTION public.assert_matview_health() TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_boss_mapping_unit_ids() TO anon;
GRANT EXECUTE ON FUNCTION public.calculate_votlw_for_completed_seasons() TO anon;
GRANT EXECUTE ON FUNCTION public.check_duplicate_current_records() TO anon;
GRANT EXECUTE ON FUNCTION public.check_http_response_errors() TO anon;
GRANT EXECUTE ON FUNCTION public.check_pgnet_freshness() TO anon;
GRANT EXECUTE ON FUNCTION public.check_votlw_data_freshness() TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_onboarding(boolean, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_coaching_task_deliveries_v1(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_gdpr_data() TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_incomplete_registrations() TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_guilds() TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_write_queue(interval, interval) TO anon;
GRANT EXECUTE ON FUNCTION public.dispatch_token_notification_events_discord(integer, integer, timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public.export_meta_atlas_for_modeling(integer, text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_duplicate_current_mappings() TO anon;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_player_mappings() TO anon;
GRANT EXECUTE ON FUNCTION public.queue_proactive_token_notifications(text, text, timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public.queue_token_burn_notifications(text, text, timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public.recalculate_sync_tiers() TO anon;
GRANT EXECUTE ON FUNCTION public.refresh_guild_snapshots(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.refresh_meta_atlas_all() TO anon;
GRANT EXECUTE ON FUNCTION public.refresh_public_stats() TO anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

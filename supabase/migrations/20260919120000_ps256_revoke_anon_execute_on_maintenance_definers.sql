-- Revoke PUBLIC/anon EXECUTE on 23 unused SECURITY DEFINER maintenance functions
-- exposed at /rpc/ by default privileges. authenticated and service_role keep it.
-- target-db: general
-- In production General, calculate_votlw_*, refresh_member_stats_summary,
-- schedule_tacticus_data_import and trigger_historical_backfill* are absent.

BEGIN;

-- to_regprocedure pins each signature, so a drifted overload fails loudly.
DO $ps256_preflight$
DECLARE
  v_signature text;
  v_missing text[] := ARRAY[]::text[];
  v_not_definer text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.assert_matview_health()',
    'public.backfill_boss_mapping_unit_ids()',
    'public.calculate_votlw_for_completed_seasons()',
    'public.check_duplicate_current_records()',
    'public.check_http_response_errors()',
    'public.check_pgnet_freshness()',
    'public.check_votlw_data_freshness()',
    'public.cleanup_abandoned_onboarding(boolean, integer)',
    'public.cleanup_expired_coaching_task_deliveries_v1(integer)',
    'public.cleanup_expired_gdpr_data()',
    'public.cleanup_incomplete_registrations()',
    'public.cleanup_orphaned_guilds()',
    'public.cleanup_write_queue(interval, interval)',
    'public.dispatch_token_notification_events_discord(integer, integer, timestamp with time zone)',
    'public.export_meta_atlas_for_modeling(integer, text[])',
    'public.fix_duplicate_current_mappings()',
    'public.merge_duplicate_player_mappings()',
    'public.queue_proactive_token_notifications(text, text, timestamp with time zone)',
    'public.queue_token_burn_notifications(text, text, timestamp with time zone)',
    'public.recalculate_sync_tiers()',
    'public.refresh_guild_snapshots(integer)',
    'public.refresh_meta_atlas_all()',
    'public.refresh_public_stats()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      v_missing := v_missing || v_signature;
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(v_signature) AND prosecdef
    ) THEN
      v_not_definer := v_not_definer || v_signature;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PS-256 preflight: these functions do not exist on this database: %', array_to_string(v_missing, ', ');
  END IF;
  IF array_length(v_not_definer, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PS-256 preflight: these functions are no longer SECURITY DEFINER, so this migration is reasoning about something else: %', array_to_string(v_not_definer, ', ');
  END IF;
END
$ps256_preflight$;

-- PUBLIC always goes with anon: anon inherits PUBLIC.
REVOKE EXECUTE ON FUNCTION public.assert_matview_health() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.backfill_boss_mapping_unit_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.calculate_votlw_for_completed_seasons() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_duplicate_current_records() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_http_response_errors() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_pgnet_freshness() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_votlw_data_freshness() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_abandoned_onboarding(boolean, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_coaching_task_deliveries_v1(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_gdpr_data() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_incomplete_registrations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_guilds() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_write_queue(interval, interval) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_token_notification_events_discord(integer, integer, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.export_meta_atlas_for_modeling(integer, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fix_duplicate_current_mappings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.merge_duplicate_player_mappings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.queue_proactive_token_notifications(text, text, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.queue_token_burn_notifications(text, text, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_sync_tiers() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_guild_snapshots(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_meta_atlas_all() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_public_stats() FROM PUBLIC, anon;

DO $ps256_verify$
DECLARE
  v_signature text;
  v_fn regprocedure;
  v_still_open text[] := ARRAY[]::text[];
  v_locked_out text[] := ARRAY[]::text[];
  v_closed integer := 0;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.assert_matview_health()',
    'public.backfill_boss_mapping_unit_ids()',
    'public.calculate_votlw_for_completed_seasons()',
    'public.check_duplicate_current_records()',
    'public.check_http_response_errors()',
    'public.check_pgnet_freshness()',
    'public.check_votlw_data_freshness()',
    'public.cleanup_abandoned_onboarding(boolean, integer)',
    'public.cleanup_expired_coaching_task_deliveries_v1(integer)',
    'public.cleanup_expired_gdpr_data()',
    'public.cleanup_incomplete_registrations()',
    'public.cleanup_orphaned_guilds()',
    'public.cleanup_write_queue(interval, interval)',
    'public.dispatch_token_notification_events_discord(integer, integer, timestamp with time zone)',
    'public.export_meta_atlas_for_modeling(integer, text[])',
    'public.fix_duplicate_current_mappings()',
    'public.merge_duplicate_player_mappings()',
    'public.queue_proactive_token_notifications(text, text, timestamp with time zone)',
    'public.queue_token_burn_notifications(text, text, timestamp with time zone)',
    'public.recalculate_sync_tiers()',
    'public.refresh_guild_snapshots(integer)',
    'public.refresh_meta_atlas_all()',
    'public.refresh_public_stats()'
  ] LOOP
    v_fn := to_regprocedure(v_signature);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      v_still_open := v_still_open || v_signature;
    ELSIF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) AS a
      WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      v_still_open := v_still_open || v_signature;
    ELSE
      v_closed := v_closed + 1;
    END IF;

    -- Not a lockout. Both retained roles are asserted POSITIVELY.
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      v_locked_out := v_locked_out || v_signature;
    END IF;
  END LOOP;

  IF array_length(v_still_open, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PS-256 verify: anon (or PUBLIC, which anon inherits) still holds EXECUTE on: %', array_to_string(v_still_open, ', ');
  END IF;
  IF array_length(v_locked_out, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PS-256 verify: service_role lost EXECUTE on: % -- this migration is a gate, not a removal', array_to_string(v_locked_out, ', ');
  END IF;

  IF v_closed <> 23 THEN
    RAISE EXCEPTION 'PS-256 verify: expected 23 closed corridor(s), counted %', v_closed;
  END IF;

  RAISE NOTICE 'PS-256 verify: OK -- % anon corridor(s) closed, service_role retained on every one', v_closed;
END
$ps256_verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

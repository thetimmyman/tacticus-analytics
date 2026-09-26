-- Default privileges grant anon EXECUTE on new functions, so revokes must be
-- explicit. grantee = 0 is PUBLIC in proacl.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(7);

CREATE TEMP TABLE ps256_revoked(signature text) ON COMMIT DROP;
INSERT INTO ps256_revoked(signature) VALUES
    ('public.assert_matview_health()'),
    ('public.backfill_boss_mapping_unit_ids()'),
    ('public.calculate_votlw_for_completed_seasons()'),
    ('public.check_duplicate_current_records()'),
    ('public.check_http_response_errors()'),
    ('public.check_pgnet_freshness()'),
    ('public.check_votlw_data_freshness()'),
    ('public.cleanup_abandoned_onboarding(boolean, integer)'),
    ('public.cleanup_expired_coaching_task_deliveries_v1(integer)'),
    ('public.cleanup_expired_gdpr_data()'),
    ('public.cleanup_incomplete_registrations()'),
    ('public.cleanup_orphaned_guilds()'),
    ('public.cleanup_write_queue(interval, interval)'),
    ('public.dispatch_token_notification_events_discord(integer, integer, timestamp with time zone)'),
    ('public.export_meta_atlas_for_modeling(integer, text[])'),
    ('public.fix_duplicate_current_mappings()'),
    ('public.merge_duplicate_player_mappings()'),
    ('public.queue_proactive_token_notifications(text, text, timestamp with time zone)'),
    ('public.queue_token_burn_notifications(text, text, timestamp with time zone)'),
    ('public.recalculate_sync_tiers()'),
    ('public.refresh_guild_snapshots(integer)'),
    ('public.refresh_meta_atlas_all()'),
    ('public.refresh_public_stats()');

SELECT is(
  (SELECT count(*)::integer FROM ps256_revoked
    WHERE to_regprocedure(signature) IS NOT NULL),
  23,
  'all 23 functions still exist with the signatures the migration names'
);

SELECT is(
  (SELECT count(*)::integer FROM ps256_revoked r
     JOIN pg_proc p ON p.oid = to_regprocedure(r.signature)
    WHERE p.prosecdef),
  23,
  'all 23 are still SECURITY DEFINER (the fix is a gate, not a downgrade)'
);

SELECT is(
  (SELECT count(*)::integer FROM ps256_revoked
    WHERE has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')),
  0,
  'anon holds EXECUTE on none of the 23'
);

SELECT is(
  (SELECT count(*)::integer
     FROM ps256_revoked r, pg_proc p, aclexplode(p.proacl) AS a
    WHERE p.oid = to_regprocedure(r.signature)
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC holds EXECUTE on none of them either, so a new role cannot inherit the grant'
);

-- Not a lockout.
SELECT is(
  (SELECT count(*)::integer FROM ps256_revoked
    WHERE has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE')),
  23,
  'service_role retains EXECUTE on all 23 (the cron and server callers still work)'
);

-- intentionallyPublic corridors in config/anon-definer-allowlist.json stay open.
SELECT ok(
  has_function_privilege('anon', 'public.get_public_global_leaderboard(integer)', 'EXECUTE'),
  'get_public_global_leaderboard(integer) is still anon-executable (the logged-out homepage calls it)'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_invite_code_info(text)', 'EXECUTE'),
  'get_invite_code_info(text) is still anon-executable (the logged-out claim page calls it)'
);

SELECT * FROM finish();
ROLLBACK;

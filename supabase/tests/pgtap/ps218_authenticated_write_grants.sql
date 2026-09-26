-- After the sweep: swept tables grant authenticated no writes, kept tables keep
-- theirs, and nothing outside the census gains one. 9-11 pin the census to the schema.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

CREATE TEMP TABLE ps218_swept (relname text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO ps218_swept (relname) SELECT unnest(ARRAY[
    '_ha_state',
    'ability_metadata',
    'audit_logs',
    'boss_mapping',
    'boss_name_aliases',
    'boss_tiers',
    'cluster_rankings_refresh_state',
    'coaching_task_deliveries',
    'coaching_task_delivery_dedup',
    'coaching_task_delivery_rate_buckets',
    'discord_message_tracking',
    'discord_user_permissions',
    'gdpr_processing_log',
    'global_strength_thresholds',
    'guild_api_incident_notification_state',
    'guild_boss_season_rotation',
    'guild_code_legacy_map',
    'guild_historical_backfill_history',
    'guild_historical_backfill_status',
    'guild_raid_boss_difficulty',
    'guild_sync_history',
    'guild_war_leaderboards',
    'guild_war_visibility_audit',
    'guild_war_zone_events',
    'login_audit',
    'maps',
    'meta_atlas_dag_edges',
    'meta_atlas_data',
    'pgnet_watchdog_state',
    'player_achievements',
    'player_identity_attestation_revocations',
    'player_identity_attestations',
    'player_identity_discord_generation_activations',
    'player_identity_discord_invalidation_events',
    'player_identity_discord_unlink_pending',
    'player_identity_quarantine_events',
    'player_identity_quarantine_evidence',
    'player_identity_quarantine_pii',
    'player_identity_subject_authority_blocks',
    'player_invite_codes',
    'schema_migrations',
    'season_boss_lineup',
    'season_summary_tracking',
    'sync_metrics',
    'sync_queue',
    'system_config',
    'system_logs',
    'token_audit_snapshots',
    'token_burn_state',
    'token_notification_events',
    'token_notification_preferences',
    'user_token_alert_state',
    'votlw_winners',
    'work_queue',
    'write_queue'
  ]::text[]);

-- Census keep sets; the census --scan fails if they disagree.
CREATE TEMP TABLE ps218_kept (
  relname text PRIMARY KEY,
  decision text NOT NULL
) ON COMMIT DROP;
INSERT INTO ps218_kept (relname, decision)
SELECT relname, 'keep-policy-governed' FROM unnest(ARRAY[ -- ps218_kept_policy
    'bomb_tracking',
    'boss_assignment_configs',
    'boss_playbook_tactics',
    'boss_playbook_tactics_history',
    'boss_playbook_team_requirements',
    'boss_target_tokens',
    'carousel_items',
    'clusters',
    'discord_invite_codes',
    'feature_access_grants',
    'feature_releases',
    'gdpr_data_exports',
    'gdpr_deletion_requests',
    'gdpr_user_consent',
    'guild_config',
    'guild_raid_season_plan_assignments',
    'guild_raid_season_plan_sessions',
    'guild_raid_season_plans',
    'guild_sync_status',
    'guild_war_defensive_lineups',
    'guild_war_lineups',
    'guild_war_meta_teams',
    'guild_war_settings',
    'guild_war_zone_assignment_entries',
    'guild_war_zone_assignments',
    'herald_boss_config',
    'herald_config_versions',
    'herald_meta_role_mapping',
    'log_export_requests',
    'onboarding_progress',
    'player_avatar_frames',
    'player_mapping',
    'player_meta_roles',
    'player_roster',
    'raid_progression_config',
    'season_calendar',
    'season_tracking',
    'token_cap_notifications',
    'upcoming_season_assignments',
    'upcoming_season_bosses',
    'user_briefing_state',
    'user_token_alert_prefs',
    'war_player_lineups',
    'webhook_config',
    'webhook_cron_jobs'
  ]::text[]) AS relname;
INSERT INTO ps218_kept (relname, decision)
SELECT relname, 'keep-undecided' FROM unnest(ARRAY[ -- ps218_kept_undecided
    'coaching_tasks',
    'discord_channel_guilds',
    'discord_server_guilds',
    'discord_token_reminders',
    'discord_user_guild_defaults',
    'discord_webhook_logs',
    'EOT_GR_data',
    'execution_locks',
    'guild_roster_scoring_config',
    'guild_themes',
    'guild_war_battles',
    'guild_war_matches',
    'guild_war_participation',
    'guild_war_player_attempts',
    'guild_war_zones',
    'herald_boss_availability',
    'herald_posted_events',
    'hero_mappings',
    'onboarding_jobs',
    'player_claim_audit',
    'role_reconciliation_events',
    'sync_health'
  ]::text[]) AS relname;

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260925080000'
    AND name = 'ps218_revoke_authenticated_write_grants'
) AS ps218_not_applied \gset

\if :ps218_not_applied
SELECT plan(11);
SELECT * FROM skip(
  11,
  'this database predates PS-218; apply 20260925080000 and this suite executes fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(11);

-- 1. The ledger row, so a suite that matched nothing cannot pass.
SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260925080000'
      AND name = 'ps218_revoke_authenticated_write_grants'),
  1,
  'PS-218 migration 20260925080000 is recorded as applied'
);

-- 2. The population this suite judges is the population the census names.
SELECT is(
  (SELECT count(*)::integer FROM ps218_swept),
  55,
  'the swept population is 55 tables (matches scripts/security/ps218-authenticated-write-census.json)'
);

-- 3. Every swept table exists, or 4 could pass with nothing to check.
SELECT is(
  (SELECT count(*)::integer
     FROM ps218_swept s
    WHERE to_regclass('public.' || quote_ident(s.relname)) IS NULL),
  0,
  'every swept table still exists in the public schema'
);

SELECT is(
  (SELECT coalesce(string_agg(s.relname || '.' || p, ', ' ORDER BY s.relname, p), '')
     FROM ps218_swept s
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || quote_ident(s.relname), p)),
  '',
  'authenticated holds no INSERT/UPDATE/DELETE on any swept table'
);

SELECT is(
  (SELECT coalesce(string_agg(s.relname, ', ' ORDER BY s.relname), '')
     FROM ps218_swept s
    WHERE NOT has_table_privilege('authenticated', 'public.' || quote_ident(s.relname), 'SELECT')),
  '',
  'every swept table still grants authenticated SELECT'
);

SELECT is(
  (SELECT coalesce(string_agg(s.relname, ', ' ORDER BY s.relname), '')
     FROM ps218_swept s
    WHERE NOT (
      has_table_privilege('service_role', 'public.' || quote_ident(s.relname), 'INSERT')
      AND has_table_privilege('service_role', 'public.' || quote_ident(s.relname), 'UPDATE')
      AND has_table_privilege('service_role', 'public.' || quote_ident(s.relname), 'DELETE')
    )),
  '',
  'service_role still writes every swept table'
);

-- 7. Negative control: kept tables still carry their write grants.
SELECT is(
  (SELECT coalesce(string_agg(k.relname, ', ' ORDER BY k.relname), '')
     FROM ps218_kept k
    WHERE to_regclass('public.' || quote_ident(k.relname)) IS NOT NULL
      AND NOT (
        has_table_privilege('authenticated', 'public.' || quote_ident(k.relname), 'INSERT')
        OR has_table_privilege('authenticated', 'public.' || quote_ident(k.relname), 'UPDATE')
        OR has_table_privilege('authenticated', 'public.' || quote_ident(k.relname), 'DELETE')
      )),
  '',
  'every table the census left alone still holds an authenticated write grant (negative control)'
);

-- 8. Ratchet: writable public tables are a subset of the keep sets.
SELECT is(
  (SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE')
      )
      AND NOT EXISTS (SELECT 1 FROM ps218_kept k WHERE k.relname = c.relname)),
  '',
  'no public table outside the census keep sets grants authenticated a write'
);

-- 9. Every keep-set table exists (7 and 8 cannot see a missing relation).
SELECT is(
  (SELECT coalesce(string_agg(k.relname, ', ' ORDER BY k.relname), '')
     FROM ps218_kept k
    WHERE to_regclass('public.' || quote_ident(k.relname)) IS NULL),
  '',
  'every table in the census keep sets still exists in the public schema'
);

-- 10. Each keep-policy-governed table still has a policy arming its authenticated write.
SELECT is(
  (SELECT coalesce(string_agg(k.relname, ', ' ORDER BY k.relname), '')
     FROM ps218_kept k
    WHERE k.decision = 'keep-policy-governed'
      AND NOT EXISTS (
        SELECT 1
          FROM pg_policy p
         WHERE p.polrelid = to_regclass('public.' || quote_ident(k.relname))
           AND p.polcmd IN ('a', 'w', 'd', '*')
           AND EXISTS (
             SELECT 1 FROM unnest(p.polroles) AS r(role_oid)
              WHERE r.role_oid = 0
                 OR pg_has_role('authenticated'::regrole, r.role_oid, 'USAGE')
           )
      )),
  '',
  'every keep-policy-governed table still has a write policy that applies to authenticated'
);

-- 11. A keep-undecided table that gained an arming policy must be reclassified.
SELECT is(
  (SELECT coalesce(string_agg(k.relname, ', ' ORDER BY k.relname), '')
     FROM ps218_kept k
    WHERE k.decision = 'keep-undecided'
      AND EXISTS (
        SELECT 1
          FROM pg_policy p
         WHERE p.polrelid = to_regclass('public.' || quote_ident(k.relname))
           AND p.polcmd IN ('a', 'w', 'd', '*')
           AND EXISTS (
             SELECT 1 FROM unnest(p.polroles) AS r(role_oid)
              WHERE r.role_oid = 0
                 OR pg_has_role('authenticated'::regrole, r.role_oid, 'USAGE')
           )
      )),
  '',
  'no keep-undecided table has gained a write policy for authenticated'
);

SELECT * FROM finish();
ROLLBACK;
\endif

-- Revoke authenticated writes on 55 RLS tables with no arming policy and only
-- service-role writers, before a future policy arms them silently.
-- target-db: general
-- Rollback re-grants exactly the revoke NOTICE's table:PRIVS entries, never all 55.

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

-- The census's revoke set verbatim; the census check fails if they disagree.
CREATE TEMP TABLE ps218_swept (relname text PRIMARY KEY) ON COMMIT DROP;

INSERT INTO ps218_swept (relname)
SELECT unnest(ARRAY[
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

-- State as found. Tables with no authenticated or service_role write are no-ops,
-- exempt from the service_role-must-survive check.
CREATE TEMP TABLE ps218_before (
  relname text PRIMARY KEY,
  auth_insert boolean NOT NULL,
  auth_update boolean NOT NULL,
  auth_delete boolean NOT NULL,
  auth_writes boolean GENERATED ALWAYS AS
    (auth_insert OR auth_update OR auth_delete) STORED,
  auth_select boolean NOT NULL,
  svc_insert boolean NOT NULL,
  svc_update boolean NOT NULL,
  svc_delete boolean NOT NULL
) ON COMMIT DROP;

-- Refuse if the database disagrees with any census claim.
DO $precondition$
DECLARE
  v_missing text[];
  v_no_rls text[];
  v_armed text[];
  v_no_service text[];
  v_skipped text[];
BEGIN
  SELECT coalesce(array_agg(s.relname ORDER BY s.relname), ARRAY[]::text[])
    INTO v_missing
    FROM ps218_swept s
   WHERE to_regclass('public.' || quote_ident(s.relname)) IS NULL;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218: % table(s) in the swept population do not exist: %',
      array_length(v_missing, 1), array_to_string(v_missing, ', ');
  END IF;

  -- Each authenticated write privilege is recorded separately: a drifted
  -- table may hold only a subset, and the revoke NOTICE (the ROLLBACK input)
  -- must name exactly that subset so a rollback cannot add privileges the
  -- table never had.
  INSERT INTO ps218_before
    (relname, auth_insert, auth_update, auth_delete, auth_select,
     svc_insert, svc_update, svc_delete)
  SELECT s.relname,
         has_table_privilege('authenticated', t.oid, 'INSERT'),
         has_table_privilege('authenticated', t.oid, 'UPDATE'),
         has_table_privilege('authenticated', t.oid, 'DELETE'),
         has_table_privilege('authenticated', t.oid, 'SELECT'),
         has_table_privilege('service_role', t.oid, 'INSERT'),
         has_table_privilege('service_role', t.oid, 'UPDATE'),
         has_table_privilege('service_role', t.oid, 'DELETE')
    FROM ps218_swept s
    CROSS JOIN LATERAL (
      SELECT to_regclass('public.' || quote_ident(s.relname))::oid AS oid
    ) t;

  -- RLS on every one of them. The whole premise of "these grants are inert
  -- today" is that RLS filters the write to zero rows; on a table without RLS
  -- the grant is LIVE, this migration would be a behaviour change rather than
  -- a hardening, and the census that said otherwise is wrong.
  SELECT coalesce(array_agg(s.relname ORDER BY s.relname), ARRAY[]::text[])
    INTO v_no_rls
    FROM ps218_swept s
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(s.relname))
   WHERE NOT c.relrowsecurity;
  IF array_length(v_no_rls, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218: % swept table(s) do not have RLS enabled, so their authenticated write grants are LIVE, not inert; refusing: %',
      array_length(v_no_rls, 1), array_to_string(v_no_rls, ', ');
  END IF;

  -- No policy may arm the grant for `authenticated` (polcmd a/w/d/* against
  -- PUBLIC or any role authenticated currently inherits). Checking only the
  -- authenticated OID misses policies addressed to a granted role: such a
  -- policy already lets authenticated write. If one appeared since the census,
  -- somebody intends these writes and this sweep must be re-judged.
  SELECT coalesce(array_agg(DISTINCT s.relname ORDER BY s.relname), ARRAY[]::text[])
    INTO v_armed
    FROM ps218_swept s
    JOIN pg_policy p ON p.polrelid = to_regclass('public.' || quote_ident(s.relname))
   WHERE p.polcmd IN ('a', 'w', 'd', '*')
     AND EXISTS (
       SELECT 1
       FROM unnest(p.polroles) AS policy_role(role_oid)
       WHERE CASE
         WHEN policy_role.role_oid = 0 THEN true  -- PUBLIC
         ELSE pg_has_role('authenticated'::regrole, policy_role.role_oid, 'USAGE')
       END
     );
  IF array_length(v_armed, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218: % swept table(s) gained a policy that grants authenticated a write command since the census; refusing: %',
      array_length(v_armed, 1), array_to_string(v_armed, ', ');
  END IF;

  -- The writer that must survive -- on every table this migration will
  -- actually revoke on. A swept table where `authenticated` already holds no
  -- write is not revoked on, so it cannot be left without a writer by this
  -- migration; it is skipped and named.
  SELECT coalesce(array_agg(b.relname ORDER BY b.relname), ARRAY[]::text[])
    INTO v_no_service
    FROM ps218_before b
   WHERE b.auth_writes
     AND NOT (b.svc_insert AND b.svc_update AND b.svc_delete);
  IF array_length(v_no_service, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218: service_role cannot write % swept table(s); revoking the end-user grants now would leave them with no writer at all: %',
      array_length(v_no_service, 1), array_to_string(v_no_service, ', ');
  END IF;

  SELECT coalesce(array_agg(b.relname ORDER BY b.relname), ARRAY[]::text[])
    INTO v_skipped
    FROM ps218_before b
   WHERE NOT b.auth_writes;
  IF array_length(v_skipped, 1) > 0 THEN
    RAISE NOTICE
      'PS-218: % swept table(s) already grant authenticated no INSERT/UPDATE/DELETE; nothing to revoke, skipped (service_role precondition not applied to them): %',
      array_length(v_skipped, 1), array_to_string(v_skipped, ', ');
  END IF;
END;
$precondition$;

DO $revoke$
DECLARE
  r record;
  v_privs text;
  v_revoked text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT * FROM ps218_before WHERE auth_writes ORDER BY relname LOOP
    v_privs := concat_ws(',',
      CASE WHEN r.auth_insert THEN 'INSERT' END,
      CASE WHEN r.auth_update THEN 'UPDATE' END,
      CASE WHEN r.auth_delete THEN 'DELETE' END);
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', r.relname);
    v_revoked := v_revoked || (r.relname || ':' || v_privs);
  END LOOP;
  -- Each entry is table:PRIVS, the privileges authenticated held on it
  -- before this migration -- the exact input the ROLLBACK block needs.
  RAISE NOTICE 'PS-218: revoked authenticated INSERT/UPDATE/DELETE on % table(s): %',
    coalesce(array_length(v_revoked, 1), 0), array_to_string(v_revoked, ', ');
END;
$revoke$;

-- Exactly 55 tables, all existing; authenticated keeps no write, and its SELECT
-- and service_role's writes are exactly as found.
DO $verify$
DECLARE
  v_count int;
  v_revoked int;
  v_remaining text[];
  v_select_changed text[];
  v_service_changed text[];
BEGIN
  SELECT count(*) INTO v_count FROM ps218_swept;
  IF v_count <> 55 THEN
    RAISE EXCEPTION
      'PS-218 verify: the swept population is % table(s), expected 55; this verification would otherwise judge the wrong set',
      v_count;
  END IF;
  SELECT count(*) INTO v_count FROM ps218_before;
  IF v_count <> 55 THEN
    RAISE EXCEPTION
      'PS-218 verify: the before-state covers % table(s), expected 55', v_count;
  END IF;

  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[])
    INTO v_remaining
    FROM (
      SELECT s.relname || '.' || p AS x
        FROM ps218_swept s
        CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
       WHERE has_table_privilege('authenticated', 'public.' || quote_ident(s.relname), p)
    ) q;
  IF array_length(v_remaining, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218 verify: authenticated still holds % write privilege(s) on swept tables: %',
      array_length(v_remaining, 1), array_to_string(v_remaining, ', ');
  END IF;

  -- SELECT is out of scope and must be exactly as found.
  SELECT coalesce(array_agg(b.relname ORDER BY b.relname), ARRAY[]::text[])
    INTO v_select_changed
    FROM ps218_before b
   WHERE has_table_privilege('authenticated', 'public.' || quote_ident(b.relname), 'SELECT')
         IS DISTINCT FROM b.auth_select;
  IF array_length(v_select_changed, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218 verify: authenticated SELECT changed on % swept table(s), which this migration must not touch: %',
      array_length(v_select_changed, 1), array_to_string(v_select_changed, ', ');
  END IF;

  SELECT coalesce(array_agg(b.relname ORDER BY b.relname), ARRAY[]::text[])
    INTO v_service_changed
    FROM ps218_before b
   WHERE has_table_privilege('service_role', 'public.' || quote_ident(b.relname), 'INSERT') IS DISTINCT FROM b.svc_insert
      OR has_table_privilege('service_role', 'public.' || quote_ident(b.relname), 'UPDATE') IS DISTINCT FROM b.svc_update
      OR has_table_privilege('service_role', 'public.' || quote_ident(b.relname), 'DELETE') IS DISTINCT FROM b.svc_delete
      OR (b.auth_writes AND NOT (b.svc_insert AND b.svc_update AND b.svc_delete));
  IF array_length(v_service_changed, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-218 verify: service_role write privileges changed, or are incomplete on a revoked table, on % swept table(s): %',
      array_length(v_service_changed, 1), array_to_string(v_service_changed, ', ');
  END IF;

  SELECT count(*) INTO v_revoked FROM ps218_before WHERE auth_writes;
  RAISE NOTICE 'PS-218 verify: OK -- authenticated holds no INSERT/UPDATE/DELETE on all 55 swept tables (% revoked here, % already without); authenticated SELECT and service_role unchanged',
    v_revoked, 55 - v_revoked;
END;
$verify$;

COMMIT;

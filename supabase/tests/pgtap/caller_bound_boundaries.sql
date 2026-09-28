BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- Caller-bound definer readers: own / same-cluster / app-admin only, NULL uid is never service.
-- Effective service_role comes from the database role, never JWT claims.

SELECT plan(31);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
   WHERE version = '20260801150000' AND name = 'wi3139_service_and_identity_boundaries'),
  1, 'Batch A migration is recorded exactly once');

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
   WHERE version = '20260801160000' AND name = 'wi3139_cluster_scoped_reader_boundaries'),
  1, 'Batch B migration is recorded exactly once');

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
   WHERE version = '20260801170000' AND name = 'wi3139_refresh_snapshot_boundary'),
  1, 'Batch C migration is recorded exactly once');

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc
   WHERE oid IN (
     'public.refresh_member_stats_summary()'::regprocedure,
     'public.get_player_team_usage(text,text,text)'::regprocedure,
     'public.get_player_token_state(text,text,text,text)'::regprocedure,
     'public.check_feature_access(uuid,text)'::regprocedure,
     'public.get_user_access_levels(uuid)'::regprocedure,
     'public.admin_update_feature_stage(text,text)'::regprocedure,
     'public.get_boss_performance_overview(text,text,text)'::regprocedure,
     'public.get_player_boss_performance_flexible(text,integer)'::regprocedure,
     'public.get_player_boss_performance_historical(text)'::regprocedure,
     'public.refresh_public_guild_snapshots()'::regprocedure,
     'public.manual_refresh_guild_snapshots()'::regprocedure
   )),
  11, 'all 11 exact caller-bound regprocedures exist');

-- Exact argument arrays: the 2-arg flexible overload still exists.
SELECT hasnt_function('public', 'check_assignment_conflicts', ARRAY['text','text']::name[],
  'check_assignment_conflicts(text,text) stays dropped');
SELECT hasnt_function('public', 'get_boss_assignment_stats', ARRAY['text','text']::name[],
  'get_boss_assignment_stats(text,text) stays dropped');
SELECT hasnt_function('public', 'get_player_boss_performance_flexible', ARRAY['text']::name[],
  'the 1-arg get_player_boss_performance_flexible(text) stays dropped; the 2-arg overload survives');

SELECT set_eq(
  $actual$
    SELECT p.oid::regprocedure::text || '|' || COALESCE(g.rolname, 'PUBLIC')
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    LEFT JOIN pg_catalog.pg_roles g ON g.oid = acl.grantee
    WHERE p.oid IN (
      'public.refresh_member_stats_summary()'::regprocedure,
      'public.get_player_team_usage(text,text,text)'::regprocedure,
      'public.get_player_token_state(text,text,text,text)'::regprocedure,
      'public.refresh_public_guild_snapshots()'::regprocedure,
      'public.manual_refresh_guild_snapshots()'::regprocedure)
      AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner
  $actual$,
  $expected$
    VALUES
      ('refresh_member_stats_summary()|service_role'),
      ('get_player_team_usage(text,text,text)|service_role'),
      ('get_player_token_state(text,text,text,text)|service_role'),
      ('refresh_public_guild_snapshots()|service_role'),
      ('manual_refresh_guild_snapshots()|service_role')
  $expected$,
  'the five service-only functions expose exactly service_role');

SELECT set_eq(
  $actual$
    SELECT p.oid::regprocedure::text || '|' || COALESCE(g.rolname, 'PUBLIC')
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    LEFT JOIN pg_catalog.pg_roles g ON g.oid = acl.grantee
    WHERE p.oid IN (
      'public.check_feature_access(uuid,text)'::regprocedure,
      'public.get_user_access_levels(uuid)'::regprocedure,
      'public.admin_update_feature_stage(text,text)'::regprocedure,
      'public.get_boss_performance_overview(text,text,text)'::regprocedure,
      'public.get_player_boss_performance_flexible(text,integer)'::regprocedure,
      'public.get_player_boss_performance_historical(text)'::regprocedure)
      AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner
  $actual$,
  $expected$
    VALUES
      ('check_feature_access(uuid,text)|authenticated'),
      ('check_feature_access(uuid,text)|service_role'),
      ('get_user_access_levels(uuid)|authenticated'),
      ('get_user_access_levels(uuid)|service_role'),
      ('admin_update_feature_stage(text,text)|authenticated'),
      ('admin_update_feature_stage(text,text)|service_role'),
      ('get_boss_performance_overview(text,text,text)|authenticated'),
      ('get_boss_performance_overview(text,text,text)|service_role'),
      ('get_player_boss_performance_flexible(text,integer)|authenticated'),
      ('get_player_boss_performance_flexible(text,integer)|service_role'),
      ('get_player_boss_performance_historical(text)|authenticated'),
      ('get_player_boss_performance_historical(text)|service_role')
  $expected$,
  'the six authenticated+service functions expose exactly that pair');

SELECT is(
  (SELECT count(*)::integer FROM (VALUES
     ('public.refresh_member_stats_summary()'),
     ('public.get_player_team_usage(text,text,text)'),
     ('public.get_player_token_state(text,text,text,text)'),
     ('public.check_feature_access(uuid,text)'),
     ('public.get_user_access_levels(uuid)'),
     ('public.admin_update_feature_stage(text,text)'),
     ('public.get_boss_performance_overview(text,text,text)'),
     ('public.get_player_boss_performance_flexible(text,integer)'),
     ('public.get_player_boss_performance_historical(text)'),
     ('public.refresh_public_guild_snapshots()'),
     ('public.manual_refresh_guild_snapshots()')) s(sig)
   WHERE pg_catalog.has_function_privilege('anon', s.sig, 'EXECUTE')),
  0, 'anon cannot execute any of the 11 caller-bound functions');

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
   WHERE p.oid IN (
     'public.refresh_member_stats_summary()'::regprocedure,
     'public.get_player_team_usage(text,text,text)'::regprocedure,
     'public.get_player_token_state(text,text,text,text)'::regprocedure,
     'public.check_feature_access(uuid,text)'::regprocedure,
     'public.get_user_access_levels(uuid)'::regprocedure,
     'public.admin_update_feature_stage(text,text)'::regprocedure,
     'public.get_boss_performance_overview(text,text,text)'::regprocedure,
     'public.get_player_boss_performance_flexible(text,integer)'::regprocedure,
     'public.get_player_boss_performance_historical(text)'::regprocedure,
     'public.refresh_public_guild_snapshots()'::regprocedure,
     'public.manual_refresh_guild_snapshots()'::regprocedure)
     AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'),
  0, 'PUBLIC has no execute path to any caller-bound function');

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
   WHERE p.oid IN (
     'public.refresh_member_stats_summary()'::regprocedure,
     'public.get_player_team_usage(text,text,text)'::regprocedure,
     'public.get_player_token_state(text,text,text,text)'::regprocedure,
     'public.check_feature_access(uuid,text)'::regprocedure,
     'public.get_user_access_levels(uuid)'::regprocedure,
     'public.admin_update_feature_stage(text,text)'::regprocedure,
     'public.get_boss_performance_overview(text,text,text)'::regprocedure,
     'public.get_player_boss_performance_flexible(text,integer)'::regprocedure,
     'public.get_player_boss_performance_historical(text)'::regprocedure,
     'public.refresh_public_guild_snapshots()'::regprocedure,
     'public.manual_refresh_guild_snapshots()'::regprocedure)
     AND acl.privilege_type = 'EXECUTE' AND acl.is_grantable),
  0, 'no caller-bound execute grant carries grant option');

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc
   WHERE oid IN (
     'public.check_feature_access(uuid,text)'::regprocedure,
     'public.get_user_access_levels(uuid)'::regprocedure)
     AND pg_get_userbyid(proowner) = 'command_center_rpc_owner'),
  2, 'check_feature_access/get_user_access_levels stay command_center_rpc_owner-owned');

SELECT ok(
  pg_catalog.pg_get_functiondef('public.get_player_token_state(text,text,text,text)'::regprocedure)
    NOT LIKE '%v_requester_role_claim%'
  AND pg_catalog.pg_get_functiondef('public.get_player_token_state(text,text,text,text)'::regprocedure)
    NOT LIKE '%do NOT remove this null guard%',
  'get_player_token_state no longer carries the null-as-service bypass');

SELECT ok(
  pg_catalog.pg_get_functiondef('public.get_player_token_state(text,text,text,text)'::regprocedure)
    LIKE '%current_setting(''role'', true)%'
  AND pg_catalog.pg_get_functiondef('public.get_player_token_state(text,text,text,text)'::regprocedure)
    LIKE '%session_user%'
  AND pg_catalog.pg_get_functiondef('public.get_player_token_state(text,text,text,text)'::regprocedure)
    LIKE '%v_is_service%',
  'get_player_token_state derives the service bypass from the effective database role');

SELECT ok(
  pg_catalog.pg_get_functiondef('public.admin_update_feature_stage(text,text)'::regprocedure)
    LIKE '%_pm_caller_is_app_admin%'
  AND pg_catalog.pg_get_functiondef('public.admin_update_feature_stage(text,text)'::regprocedure)
    NOT LIKE '%pm.role = ''leader''%',
  'admin_update_feature_stage enforces app-admin, not the old leader gate');

SELECT ok(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc
   WHERE oid IN (
     'public.get_boss_performance_overview(text,text,text)'::regprocedure,
     'public.get_player_boss_performance_flexible(text,integer)'::regprocedure,
     'public.get_player_boss_performance_historical(text)'::regprocedure)
     AND pg_catalog.pg_get_functiondef(oid) LIKE '%_pm_caller_guild_codes%'
     AND pg_catalog.pg_get_functiondef(oid) LIKE '%_pm_caller_cluster_guild_codes%'
     AND pg_catalog.pg_get_functiondef(oid) LIKE '%_pm_caller_is_app_admin%') = 3,
  'the three surviving Batch B readers use the broad own/cluster/app-admin scope contract');

ALTER TABLE auth.users DISABLE TRIGGER USER;
ALTER TABLE public.guild_config DISABLE TRIGGER USER;
ALTER TABLE public.player_mapping DISABLE TRIGGER USER;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('31390000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'own@example.test'),
  ('31390000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'same@example.test'),
  ('31390000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cross@example.test'),
  ('31390000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test');

INSERT INTO public.clusters (id, cluster_code, display_name, created_at, is_active)
VALUES
  ('31390000-0000-0000-0000-0000000000a0', 'W3139A', 'Test Cluster A', now(), true),
  ('31390000-0000-0000-0000-0000000000b0', 'W3139B', 'Test Cluster B', now(), true);

INSERT INTO public.guild_config (id, guild_code, guild_id, guild_tag, display_name, cluster_code, cluster_id, is_cluster, created_at, enabled)
VALUES
  (-313901, 'W3139-A1', 'tw3139-a1', 'W31A1', 'Test Guild A1', 'W3139A', '31390000-0000-0000-0000-0000000000a0', true, now(), true),
  (-313902, 'W3139-A2', 'tw3139-a2', 'W31A2', 'Test Guild A2', 'W3139A', '31390000-0000-0000-0000-0000000000a0', true, now(), true),
  (-313903, 'W3139-B1', 'tw3139-b1', 'W31B1', 'Test Guild B1', 'W3139B', '31390000-0000-0000-0000-0000000000b0', true, now(), true);

INSERT INTO public.player_mapping (id, user_id, player_id, display_name, guild_code, cluster_code, cluster_id, role, is_current, is_active, protected, is_app_admin, created_at, updated_at)
VALUES
  (-313901, '31390000-0000-0000-0000-000000000001', 'w3139-own', 'Test Own', 'W3139-A1', 'W3139A', '31390000-0000-0000-0000-0000000000a0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-313902, '31390000-0000-0000-0000-000000000002', 'w3139-same', 'Test Same', 'W3139-A2', 'W3139A', '31390000-0000-0000-0000-0000000000a0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (-313903, '31390000-0000-0000-0000-000000000003', 'w3139-cross', 'Test Cross', 'W3139-B1', 'W3139B', '31390000-0000-0000-0000-0000000000b0', 'leader'::public.app_role, true, true, false, false, now(), now()),
  (-313904, '31390000-0000-0000-0000-000000000004', 'w3139-admin', 'Test Admin', 'W3139-B1', 'W3139B', '31390000-0000-0000-0000-0000000000b0', 'member'::public.app_role, true, true, false, true, now(), now());

INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "displayName", "Name", "type", "damageType", "damageDealt", "maxHp", "remainingHp", tier, "set", "completedOn", "encounterId", rarity, "userId", "encounterIndex", cluster_code)
OVERRIDING SYSTEM VALUE
VALUES
  (-313901, 'W3139-A1', '4450', 'Test Own', 'W3139Boss', 'W3139Boss', 'Battle', 500, 100000, 40000, 5, 0, '2026-07-28 12:00:00+00', 0, 'Legendary', 'w3139-own', 0, 'W3139A'),
  (-313902, 'W3139-A1', '4450', 'Test Own', 'W3139Boss', 'W3139Boss', 'Battle', 600, 100000, 30000, 5, 0, '2026-07-28 12:05:00+00', 0, 'Legendary', 'w3139-own', 0, 'W3139A'),
  (-313903, 'W3139-A1', '4450', 'Test Own', 'W3139Boss', 'W3139Boss', 'Battle', 700, 100000, 20000, 5, 0, '2026-07-28 12:10:00+00', 0, 'Legendary', 'w3139-own', 0, 'W3139A'),
  -- Five rows: get_player_boss_performance_historical requires HAVING COUNT(*) >= 5.
  (-313904, 'W3139-A1', '4450', 'Test Own', 'W3139Boss', 'W3139Boss', 'Battle', 550, 100000, 45000, 5, 0, '2026-07-28 12:15:00+00', 0, 'Legendary', 'w3139-own', 0, 'W3139A'),
  (-313905, 'W3139-A1', '4450', 'Test Own', 'W3139Boss', 'W3139Boss', 'Battle', 650, 100000, 35000, 5, 0, '2026-07-28 12:20:00+00', 0, 'Legendary', 'w3139-own', 0, 'W3139A'),
  (-313906, 'W3139-A1', '4449', 'Test Own', 'W3139Boss', 'W3139Boss', 'Battle', 625, 100000, 37500, 5, 0, '2026-07-21 12:00:00+00', 0, 'Legendary', 'w3139-own', 0, 'W3139A');

INSERT INTO public.feature_releases (feature_key, display_name, description, release_stage, icon, route, value_proposition, sort_order)
VALUES ('tw3139-pgtap-feature', 'Test Feature', 'stage mutation target', 'alpha', 'star', '/tw3139', 'proves app-admin mutation gate', 3139);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.get_player_token_state('W3139-A1', '4450', NULL, NULL) $$,
  '42501', NULL,
  'authenticated direct execution of get_player_token_state is denied by the ACL');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (SELECT count(*)::integer
   FROM public.get_player_token_state('W3139-A1', '4450', NULL, NULL)),
  1, 'effective service_role executes get_player_token_state and sees the target guild member');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT ok(
  (SELECT count(*) FROM public.get_player_boss_performance_flexible('W3139-A1', 1)) >= 1,
  'own-guild member sees flexible boss performance rows');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (SELECT count(*)::integer FROM public.get_player_boss_performance_flexible('W3139-A1', 1)),
  0, 'cross-cluster leader gets zero flexible boss performance rows');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT ok(
  (SELECT count(*) FROM public.get_player_boss_performance_flexible('W3139-A1', 1)) >= 1,
  'effective service_role sees flexible boss performance rows');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT ok(
  (SELECT count(*) FROM public.get_player_boss_performance_historical('W3139-A1')) >= 1,
  'own-guild member sees historical boss performance rows (>=5 battles)');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (SELECT count(*)::integer FROM public.get_player_boss_performance_historical('W3139-A1')),
  0, 'cross-cluster leader gets zero historical boss performance rows');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT isnt(
  public.get_boss_performance_overview('W3139-A1', '4450', 'L1'), NULL,
  'own-guild member gets a non-null boss performance overview payload');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  public.get_boss_performance_overview('W3139-A1', '4450', 'L1'), NULL,
  'cross-cluster leader gets a NULL boss performance overview payload');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT isnt(
  public.get_boss_performance_overview('W3139-A1', '4450', 'L1'), NULL,
  'effective service_role gets a non-null boss performance overview payload');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (public.admin_update_feature_stage('tw3139-pgtap-feature', 'beta') ->> 'success')::boolean,
  false, 'a non-app-admin authenticated caller cannot update a feature stage');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (public.admin_update_feature_stage('tw3139-pgtap-feature', 'beta') ->> 'success')::boolean,
  true, 'an app-admin authenticated caller can update a feature stage');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (public.admin_update_feature_stage('tw3139-pgtap-feature', 'public') ->> 'success')::boolean,
  true, 'effective service_role can update a feature stage');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31390000-0000-0000-0000-00000000ffff', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (public.admin_update_feature_stage('tw3139-pgtap-feature', 'alpha') ->> 'success')::boolean,
  false, 'an authenticated subject without a mapping cannot update a feature stage');
RESET ROLE;

ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
ALTER TABLE public.guild_config ENABLE TRIGGER USER;
ALTER TABLE auth.users ENABLE TRIGGER USER;

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT * FROM finish();
ROLLBACK;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Membership-derived scopes are authoritative only if end users cannot rewrite authority first.

SELECT plan(52);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260712011500'
  ),
  'ACL hardening is recorded before the membership authority migration'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    WHERE function.oid =
      'public.update_player_guild_membership(text,text,text,text)'::regprocedure::oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the legacy membership definer corridor'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.update_player_guild_membership(text,text,text,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot execute the legacy membership definer corridor'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.update_player_guild_membership(text,text,text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot execute the legacy membership definer corridor'
);

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000313601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leader-a@example.test'),
  ('00000000-0000-0000-0000-000000313602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leader-b@example.test'),
  ('00000000-0000-0000-0000-000000313603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test'),
  ('00000000-0000-0000-0000-000000313604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test');

INSERT INTO public.clusters (
  id, cluster_code, display_name, created_by, created_at, is_active
)
VALUES
  ('00000000-0000-0000-0000-0000003136a0', 'W16A', 'TW3136 Cluster A', '00000000-0000-0000-0000-000000313601', now(), true),
  ('00000000-0000-0000-0000-0000003136b0', 'W16B', 'TW3136 Cluster B', '00000000-0000-0000-0000-000000313602', now(), true);

INSERT INTO public.guild_config (
  id, guild_code, guild_id, guild_tag, display_name, cluster_code, cluster_id,
  is_cluster, created_at, enabled, token_offender_threshold
)
VALUES
  (313601, 'TW3136-A1', 'tw3136-guild-id-a', 'W16A1', 'Guild A1', 'W16A', '00000000-0000-0000-0000-0000003136a0', true, now(), true, 4),
  (313602, 'TW3136-B1', 'tw3136-guild-id-b', 'W16B1', 'Guild B1', 'W16B', '00000000-0000-0000-0000-0000003136b0', true, now(), true, 4),
  (313603, 'TW3136-S1', 'tw3136-guild-id-s', 'W16S1', 'Service Fixture', NULL, NULL, false, now(), true, 4);

INSERT INTO public.player_mapping (
  id, user_id, player_id, display_name, guild_code, cluster_code, cluster_id,
  role, is_current, is_active, protected, is_app_admin, created_at, updated_at
)
VALUES
  (313601, '00000000-0000-0000-0000-000000313601', 'tw3136-leader-a', 'Leader A', 'TW3136-A1', 'W16A', '00000000-0000-0000-0000-0000003136a0', 'leader'::public.app_role, true, true, false, false, now(), now()),
  (313602, '00000000-0000-0000-0000-000000313602', 'tw3136-leader-b', 'Leader B', 'TW3136-B1', 'W16B', '00000000-0000-0000-0000-0000003136b0', 'leader'::public.app_role, true, true, false, false, now(), now()),
  (313603, '00000000-0000-0000-0000-000000313603', 'tw3136-member-a', 'Member A', 'TW3136-A1', 'W16A', '00000000-0000-0000-0000-0000003136a0', 'member'::public.app_role, true, true, false, false, now(), now()),
  (313604, '00000000-0000-0000-0000-000000313604', 'tw3136-admin', 'App Admin', 'TW3136-A1', 'W16A', '00000000-0000-0000-0000-0000003136a0', 'member'::public.app_role, true, true, false, true, now(), now()),
  (313605, NULL, 'tw3136-service', 'Service Fixture', 'TW3136-A1', 'W16A', '00000000-0000-0000-0000-0000003136a0', 'member'::public.app_role, false, true, false, false, now(), now());

GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313601', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT throws_ok(
  $$ SELECT public.update_player_guild_membership('tw3136-victim', 'FORGED-GUILD', NULL, 'leader') $$,
  '42501',
  'permission denied for function update_player_guild_membership',
  'authenticated caller is denied before the trusted definer can bypass the authority trigger'
);

SELECT throws_ok(
  $$ UPDATE public.player_mapping SET guild_code = 'TW3136-B1' WHERE id = 313601 $$,
  '42501',
  'player_mapping membership may only be modified by server authority',
  'end user cannot forge player guild membership'
);
SELECT is(
  (SELECT guild_code FROM public.player_mapping WHERE id = 313601),
  'TW3136-A1',
  'rejected player membership rewrite leaves the canonical guild intact'
);
SELECT throws_ok(
  $$ UPDATE public.player_mapping SET protected = true WHERE id = 313601 $$,
  '42501',
  'player_mapping membership may only be modified by server authority',
  'end user cannot hide a claimed row from synchronization'
);
SELECT throws_ok(
  $$ UPDATE public.player_mapping SET role = 'member'::public.app_role WHERE id = 313601 $$,
  '42501',
  'role may only be modified by server authority',
  'end user cannot rewrite their authority role'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT throws_ok(
  $$ UPDATE public.player_mapping SET cluster_code = 'W16B' WHERE id = 313601 $$,
  '42501',
  'player_mapping membership may only be modified by server authority',
  'spoofed service-role claim does not bypass the effective database role'
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT throws_ok(
  $$
    INSERT INTO public.player_mapping
      (id, user_id, player_id, display_name, guild_code, role, is_current)
    VALUES
      (313699, '00000000-0000-0000-0000-000000313601', 'tw3136-replacement', 'Replacement', 'TW3136-B1', 'leader'::public.app_role, true)
  $$,
  '42501',
  'player_mapping rows may only be created by server authority',
  'end user cannot delete and replace their authority row'
);
SELECT throws_ok(
  $$ DELETE FROM public.player_mapping WHERE id = 313601 $$,
  '42501',
  'player_mapping authority rows may only be deleted by server authority',
  'end user cannot directly delete their authority row'
);
SELECT lives_ok(
  $$ UPDATE public.player_mapping SET theme_preference = 'dark' WHERE id = 313601 $$,
  'benign own-row preference update remains available'
);
SELECT is(
  (SELECT theme_preference::text FROM public.player_mapping WHERE id = 313601),
  'dark',
  'benign player preference persisted'
);

SELECT throws_ok(
  $$
    UPDATE public.guild_config
    SET cluster_code = 'W16B', cluster_id = '00000000-0000-0000-0000-0000003136b0'
    WHERE guild_code = 'TW3136-A1'
  $$,
  '42501',
  'guild cluster membership may only be modified by server authority',
  'guild leader cannot forge their guild into another cluster'
);
SELECT is(
  (SELECT cluster_code::text FROM public.guild_config WHERE guild_code = 'TW3136-A1'),
  'W16A',
  'rejected guild cluster rewrite leaves canonical membership intact'
);
SELECT throws_ok(
  $$ UPDATE public.guild_config SET guild_id = 'victim-id' WHERE guild_code = 'TW3136-A1' $$,
  '42501',
  'guild identity may only be modified by server authority',
  'guild leader cannot rewrite the immutable Tacticus guild id'
);
SELECT lives_ok(
  $$ UPDATE public.guild_config SET token_offender_threshold = 3 WHERE guild_code = 'TW3136-A1' $$,
  'ordinary own-guild settings remain writable'
);
SELECT is(
  (SELECT token_offender_threshold FROM public.guild_config WHERE guild_code = 'TW3136-A1'),
  3,
  'ordinary guild setting persisted'
);

WITH updated AS (
  UPDATE public.clusters
  SET display_name = 'Foreign Rewrite'
  WHERE id = '00000000-0000-0000-0000-0000003136b0'
  RETURNING 1
)
SELECT is(
  (SELECT count(*)::integer FROM updated),
  0,
  'leader cannot update a foreign cluster'
);
SELECT lives_ok(
  $$ UPDATE public.clusters SET display_name = 'Cluster A Updated' WHERE id = '00000000-0000-0000-0000-0000003136a0' $$,
  'cluster creator/current leader can update benign identity fields'
);
SELECT is(
  (SELECT display_name::text FROM public.clusters WHERE id = '00000000-0000-0000-0000-0000003136a0'),
  'Cluster A Updated',
  'authorized direct cluster update persisted'
);
SELECT throws_ok(
  $$ UPDATE public.clusters SET cluster_code = 'W16X' WHERE id = '00000000-0000-0000-0000-0000003136a0' $$,
  '42501',
  'cluster identity and ownership are immutable to end users',
  'cluster leader cannot rewrite immutable cluster code'
);
WITH removed AS (
  DELETE FROM public.clusters
  WHERE id = '00000000-0000-0000-0000-0000003136b0'
  RETURNING 1
)
SELECT is(
  (SELECT count(*)::integer FROM removed),
  0,
  'leader cannot delete a foreign cluster'
);
SELECT throws_ok(
  $$
    INSERT INTO public.clusters (id, cluster_code, display_name, created_by)
    VALUES ('00000000-0000-0000-0000-0000003136c0', 'W16C', 'Forged Creator', '00000000-0000-0000-0000-000000313602')
  $$,
  '42501',
  'A cluster creator must be the authenticated user',
  'direct cluster insert cannot forge a different creator'
);
SELECT lives_ok(
  $$
    INSERT INTO public.clusters (id, cluster_code, display_name, created_by)
    VALUES ('00000000-0000-0000-0000-0000003136d0', 'W16D', 'Leader A Temp', '00000000-0000-0000-0000-000000313601')
  $$,
  'current guild leader can create a cluster bound to themselves'
);
SELECT lives_ok(
  $$ DELETE FROM public.clusters WHERE id = '00000000-0000-0000-0000-0000003136d0' $$,
  'cluster creator can delete their own temporary cluster'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT is(
  has_function_privilege('anon', 'public.update_cluster_identity(uuid,jsonb)', 'EXECUTE'),
  false,
  'anon cannot execute cluster identity updates'
);
SELECT is(
  has_function_privilege('authenticated', 'public.update_cluster_identity(uuid,jsonb)', 'EXECUTE'),
  true,
  'authenticated retains caller-bound cluster identity updates'
);
SELECT is(
  has_function_privilege('service_role', 'public.update_cluster_identity(uuid,jsonb)', 'EXECUTE'),
  true,
  'service role retains cluster identity updates'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313601', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT lives_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136a0', '{"tagline":"Authorized"}'::jsonb) $$,
  'target-cluster leader can call the identity RPC'
);
SELECT is(
  (SELECT tagline::text FROM public.clusters WHERE id = '00000000-0000-0000-0000-0000003136a0'),
  'Authorized',
  'authorized caller-bound identity update persisted'
);
SELECT throws_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136b0', '{"tagline":"Foreign"}'::jsonb) $$,
  '42501',
  'Caller may not update the requested cluster identity',
  'leader cannot call the identity RPC for a foreign cluster'
);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT throws_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136b0', '{"tagline":"Spoofed"}'::jsonb) $$,
  '42501',
  'Caller may not update the requested cluster identity',
  'spoofed service JWT claim cannot elevate the authenticated database role'
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136a0', '{"cluster_code":"W16X"}'::jsonb) $$,
  '22023',
  'Cluster identity update contains unsupported fields',
  'identity RPC rejects non-whitelisted authority fields'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313603', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136a0', '{"tagline":"Member"}'::jsonb) $$,
  '42501',
  'Caller may not update the requested cluster identity',
  'ordinary cluster member cannot mutate cluster identity'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313604', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT lives_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136b0', '{"tagline":"Admin"}'::jsonb) $$,
  'app admin can repair a cluster identity'
);
SELECT is(
  (SELECT tagline::text FROM public.clusters WHERE id = '00000000-0000-0000-0000-0000003136b0'),
  'Admin',
  'app-admin identity repair persisted'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313601', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  $$
    INSERT INTO public.sim_jobs
      (job_id, user_id, guild_code, cluster_code, status, visibility)
    VALUES
      ('tw3136-foreign-guild', '00000000-0000-0000-0000-000000313601', 'TW3136-B1', 'W16B', 'pending', 'guild')
  $$,
  '42501',
  'new row violates row-level security policy for table "sim_jobs"',
  'failed membership forgery cannot unlock a foreign Guild run'
);
SELECT throws_ok(
  $$
    INSERT INTO public.sim_jobs
      (job_id, user_id, guild_code, cluster_code, status, visibility)
    VALUES
      ('tw3136-foreign-cluster', '00000000-0000-0000-0000-000000313601', 'TW3136-B1', 'W16B', 'pending', 'cluster')
  $$,
  '42501',
  'new row violates row-level security policy for table "sim_jobs"',
  'failed membership forgery cannot unlock a foreign Cluster run'
);
SELECT lives_ok(
  $$
    INSERT INTO public.sim_jobs
      (job_id, user_id, guild_code, cluster_code, status, visibility)
    VALUES
      ('tw3136-own-guild', '00000000-0000-0000-0000-000000313601', 'TW3136-A1', 'W16A', 'pending', 'guild')
  $$,
  'current authoritative membership still permits an own-Guild run'
);
SELECT lives_ok(
  $$
    INSERT INTO public.sim_jobs
      (job_id, user_id, guild_code, cluster_code, status, visibility)
    VALUES
      ('tw3136-own-cluster', '00000000-0000-0000-0000-000000313601', 'TW3136-A1', 'W16A', 'pending', 'cluster')
  $$,
  'current authoritative membership still permits an own-Cluster run'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok(
  $$
    UPDATE public.player_mapping
    SET guild_code = 'TW3136-B1', cluster_code = 'W16B', cluster_id = '00000000-0000-0000-0000-0000003136b0', protected = true
    WHERE id = 313605
  $$,
  'service role retains player authority maintenance'
);
SELECT is(
  (SELECT guild_code || '|' || cluster_code || '|' || protected::text FROM public.player_mapping WHERE id = 313605),
  'TW3136-B1|W16B|true',
  'service player-authority update persisted'
);
SELECT lives_ok(
  $$
    UPDATE public.guild_config
    SET cluster_code = 'W16B', cluster_id = '00000000-0000-0000-0000-0000003136b0', is_cluster = true
    WHERE guild_code = 'TW3136-S1'
  $$,
  'service role retains guild cluster-membership maintenance'
);
SELECT is(
  (SELECT cluster_code::text FROM public.guild_config WHERE guild_code = 'TW3136-S1'),
  'W16B',
  'service guild-authority update persisted'
);
SELECT lives_ok(
  $$
    INSERT INTO public.clusters (id, cluster_code, display_name)
    VALUES ('00000000-0000-0000-0000-0000003136e0', 'W16E', 'Service Cluster')
  $$,
  'service role can create a cluster without end-user creator binding'
);
SELECT lives_ok(
  $$ UPDATE public.clusters SET cluster_code = 'W16E2' WHERE id = '00000000-0000-0000-0000-0000003136e0' $$,
  'service role can perform deliberate immutable cluster repair'
);
SELECT lives_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136b0', '{"tagline":"Service"}'::jsonb) $$,
  'service role can update cluster identity without an end-user session'
);
SELECT is(
  (SELECT tagline::text FROM public.clusters WHERE id = '00000000-0000-0000-0000-0000003136b0'),
  'Service',
  'service identity update persisted'
);
SELECT throws_ok(
  $$ SELECT public.update_cluster_identity('00000000-0000-0000-0000-0000003136ff', '{"tagline":"Missing"}'::jsonb) $$,
  'P0002',
  'Cluster identity update expected one row, updated 0',
  'service identity update has an exact one-row witness'
);
RESET ROLE;

SELECT policies_are(
  'public',
  'clusters',
  ARRAY[
    'Public read access for active clusters',
    'public_view_active_clusters',
    'wi3136_cluster_leaders_insert',
    'wi3136_cluster_leaders_update',
    'wi3136_cluster_creators_delete'
  ],
  'clusters has only public reads plus caller-bound insert/update/delete policies'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT finish();
ROLLBACK;

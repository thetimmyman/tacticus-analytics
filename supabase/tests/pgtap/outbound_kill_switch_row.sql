BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- The outbound stop is the feature_releases row 'upstream_outbound'. It is seeded open, and only
-- an app admin or the service role may write it: feature_releases_manage_admins alone would let any
-- guild leader halt provider traffic for every guild.

SELECT plan(21);

GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anon, authenticated, service_role;

-- Counts rows a statement changed under the caller's role, so row security is what is measured.
CREATE FUNCTION public.tp_rows_changed(p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tp_rows_changed(text) TO anon, authenticated, service_role;

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
   WHERE version = '20261019120000' AND name = 'provision_outbound_kill_switch'),
  1, 'the outbound stop migration is recorded in the ledger');

SELECT is(
  (SELECT release_stage FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  'public', 'a migrated database carries the outbound stop row, open');

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'feature_releases'
     AND permissive = 'RESTRICTIVE' AND policyname LIKE 'feature_releases_upstream_outbound_%'),
  3, 'insert, update and delete of the outbound stop row are guarded by restrictive policies');

ALTER TABLE auth.users DISABLE TRIGGER USER;
ALTER TABLE public.guild_config DISABLE TRIGGER USER;
ALTER TABLE public.player_mapping DISABLE TRIGGER USER;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leader@example.test'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operator@example.test');

INSERT INTO public.clusters (id, cluster_code, display_name, created_at, is_active)
VALUES ('40000000-0000-0000-0000-0000000000a0', 'TKSWA', 'Test Cluster', now(), true);

INSERT INTO public.guild_config (id, guild_code, guild_id, guild_tag, display_name, cluster_code, cluster_id, is_cluster, created_at, enabled)
VALUES (-400001, 'TKSW-G1', 'tksw-g1', 'TKSG1', 'Test Guild', 'TKSWA', '40000000-0000-0000-0000-0000000000a0', true, now(), true);

-- Both subjects pass the permissive leader policy; only the second is an app admin.
INSERT INTO public.player_mapping (id, user_id, player_id, display_name, guild_code, cluster_code, cluster_id, role, is_current, is_active, protected, is_app_admin, created_at, updated_at)
VALUES
  (-400001, '40000000-0000-0000-0000-000000000001', 'tksw-leader', 'Test Leader', 'TKSW-G1', 'TKSWA', '40000000-0000-0000-0000-0000000000a0', 'leader'::public.app_role, true, true, false, false, now(), now()),
  (-400002, '40000000-0000-0000-0000-000000000002', 'tksw-operator', 'Test Operator', 'TKSW-G1', 'TKSWA', '40000000-0000-0000-0000-0000000000a0', 'leader'::public.app_role, true, true, false, true, now(), now());

INSERT INTO public.feature_releases (feature_key, display_name, description, release_stage, sort_order)
VALUES ('tksw-other-feature', 'Other Feature', 'ordinary feature row', 'alpha', 4000);

-- A guild leader who is not an app admin.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET release_stage = 'coming_soon' WHERE feature_key = 'upstream_outbound' $$),
  0::bigint, 'a guild leader cannot halt outbound dispatch by updating the row');

SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET feature_key = 'tksw-renamed' WHERE feature_key = 'upstream_outbound' $$),
  0::bigint, 'a guild leader cannot rename the row away');

SELECT is(
  public.tp_rows_changed($$ DELETE FROM public.feature_releases WHERE feature_key = 'upstream_outbound' $$),
  0::bigint, 'a guild leader cannot delete the row');

SELECT throws_ok(
  $$ INSERT INTO public.feature_releases (feature_key, display_name, release_stage) VALUES ('upstream_outbound', 'x', 'coming_soon') $$,
  '42501', NULL,
  'a guild leader cannot write a row under the outbound stop key');

SELECT throws_ok(
  $$ UPDATE public.feature_releases SET feature_key = 'upstream_outbound' WHERE feature_key = 'tksw-other-feature' $$,
  '42501', NULL,
  'a guild leader cannot rename another feature onto the outbound stop key');

SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET release_stage = 'beta' WHERE feature_key = 'tksw-other-feature' $$),
  1::bigint, 'the guard is scoped to the one key: a leader still updates other features');

SELECT is(
  (public.admin_update_feature_stage('upstream_outbound', 'coming_soon') ->> 'success')::boolean,
  false, 'a guild leader cannot halt dispatch through the stage RPC either');
RESET ROLE;

SELECT is(
  (SELECT release_stage FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  'public', 'every leader attempt left the outbound stop open');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET release_stage = 'coming_soon' WHERE feature_key = 'upstream_outbound' $$),
  0::bigint, 'an anonymous caller cannot halt outbound dispatch');
RESET ROLE;

-- An app admin: the operator.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (public.admin_update_feature_stage('upstream_outbound', 'coming_soon') ->> 'success')::boolean,
  true, 'an app admin halts dispatch through the stage RPC');
RESET ROLE;

SELECT is(
  (SELECT release_stage FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  'coming_soon', 'the halt is recorded');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET release_stage = 'public' WHERE feature_key = 'upstream_outbound' $$),
  1::bigint, 'an app admin also reopens dispatch by a direct update');
RESET ROLE;

SELECT is(
  (SELECT release_stage FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  'public', 'the reopen is recorded');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET release_stage = 'coming_soon' WHERE feature_key = 'upstream_outbound' $$),
  1::bigint, 'the service role can halt dispatch');
SELECT is(
  public.tp_rows_changed($$ UPDATE public.feature_releases SET release_stage = 'public' WHERE feature_key = 'upstream_outbound' $$),
  1::bigint, 'the service role can reopen dispatch');
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  1, 'exactly one outbound stop row exists throughout');

-- A row planted before the migration is reset to open. The statement is the migration's seed, verbatim.
UPDATE public.feature_releases
   SET release_stage = 'coming_soon', icon = 'x', route = '/planted', value_proposition = 'planted'
 WHERE feature_key = 'upstream_outbound';
INSERT INTO public.feature_releases (
  feature_key,
  display_name,
  description,
  release_stage,
  sort_order,
  released_at
)
VALUES (
  'upstream_outbound',
  'Upstream provider traffic',
  'Operator stop. Any stage other than public halts outbound provider requests where the stop is enforced.',
  'public',
  9999,
  now()
)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  release_stage = EXCLUDED.release_stage,
  icon = NULL,
  route = NULL,
  value_proposition = NULL,
  sort_order = EXCLUDED.sort_order,
  released_at = EXCLUDED.released_at;
SELECT is(
  (SELECT release_stage FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  'public', 'the seed resets a row that was planted before the migration to open');
SELECT ok(
  (SELECT route IS NULL AND icon IS NULL AND value_proposition IS NULL
     FROM public.feature_releases WHERE feature_key = 'upstream_outbound'),
  'the reset also clears the planted route, icon and pitch so the row is not a product page');

ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
ALTER TABLE public.guild_config ENABLE TRIGGER USER;
ALTER TABLE auth.users ENABLE TRIGGER USER;

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT * FROM finish();
ROLLBACK;

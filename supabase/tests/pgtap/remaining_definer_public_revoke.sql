-- Direct SQL logins control their JWT GUCs. PUBLIC must not admit them to
-- definers, while the explicit API grants and existing trigger paths remain.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT plan(22);

CREATE TEMP TABLE remaining_definers(signature text, required boolean) ON COMMIT DROP;
INSERT INTO remaining_definers VALUES
  ('public._pm_caller_cluster_guild_codes()', true),
  ('public._pm_caller_guild_codes()', true),
  ('public._pm_caller_is_app_admin()', true),
  ('public.get_auth_role()', true),
  ('public.get_auth_uid()', true),
  ('public.get_user_accessible_guilds()', true),
  ('public.is_current_user_app_admin()', true),
  ('public.handle_boss_playbook_tactics_update()', true),
  ('public.set_playbook_cluster_code()', true),
  ('public.update_guild_theme_updated_by()', true),
  ('public.apply_pending_supporter_grants()', true),
  ('public.audit_login()', true),
  ('public.categorize_team_composition(text[])', true),
  ('public.check_guild_exists(text)', true),
  ('public.check_guild_registration_status(text)', true),
  ('public.generate_verification_code()', true),
  ('public.get_invite_code_info(text)', true),
  ('public.get_public_stats()', true),
  ('public.has_active_guilds(uuid)', true),
  ('public.validate_guild_in_cluster(character varying, character varying)', true),
  ('public.validate_guild_not_exists(character varying)', true);
CREATE TEMP VIEW present_remaining_definers AS
  SELECT signature, required, to_regprocedure(signature) AS fn
  FROM remaining_definers WHERE to_regprocedure(signature) IS NOT NULL;

SELECT is((SELECT count(*)::integer FROM present_remaining_definers WHERE required),
  21, 'all repository-defined signatures exist');
SELECT ok((SELECT bool_and(p.prosecdef) FROM present_remaining_definers f JOIN pg_proc p ON p.oid=f.fn),
  'the fix preserves SECURITY DEFINER behavior');
SELECT is((SELECT count(*)::integer FROM present_remaining_definers f JOIN pg_proc p ON p.oid=f.fn,
  LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE a.grantee=0 AND a.privilege_type='EXECUTE'), 0, 'PUBLIC executes none of the repository-defined targets');
SELECT ok((SELECT bool_and(has_function_privilege('anon', fn, 'EXECUTE')) FROM present_remaining_definers),
  'explicit anon API grants remain');
SELECT ok((SELECT bool_and(has_function_privilege('authenticated', fn, 'EXECUTE')) FROM present_remaining_definers),
  'authenticated RLS and RPC callers keep execution');
SELECT ok((SELECT bool_and(has_function_privilege('service_role', fn, 'EXECUTE')) FROM present_remaining_definers),
  'service callers keep execution');

CREATE ROLE remaining_definer_probe NOLOGIN;
GRANT USAGE ON SCHEMA public, extensions TO remaining_definer_probe;
SELECT is((SELECT count(*)::integer FROM present_remaining_definers
  WHERE has_function_privilege('remaining_definer_probe', fn, 'EXECUTE')), 0,
  'a new direct role receives no execution through PUBLIC');
SELECT is((SELECT count(*)::integer FROM present_remaining_definers
  WHERE has_function_privilege('analytics_ro', fn, 'EXECUTE')), 0,
  'read-only analytics receives no claim helper oracle');

INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-00000000d1a1');
INSERT INTO public.guild_config (guild_code, display_name, enabled) VALUES ('TAPD1', 'Synthetic guild', true);
INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, is_current, is_active)
SELECT greatest(coalesce((SELECT max(id) FROM public.player_mapping),0),
  coalesce(pg_sequence_last_value('public.player_mapping_id_seq'::regclass),0))+2000,
  'TAPD1PLAYER', 'Synthetic member', 'TAPD1', true, true;
INSERT INTO public.player_identity_attestations
  (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT id, player_id, '00000000-0000-4000-8000-00000000d1a1'::uuid, now(), 'operator_quarantine_restore'
FROM public.player_mapping WHERE player_id='TAPD1PLAYER';
UPDATE public.player_mapping pm SET user_id=a.subject_user_id, ownership_attestation_id=a.id
FROM public.player_identity_attestations a WHERE a.mapping_id=pm.id AND pm.player_id='TAPD1PLAYER';
INSERT INTO public.guild_sync_status (guild_code, status) VALUES ('TAPD1', 'pending');
-- A fresh replay has this materialized view WITH NO DATA.
REFRESH MATERIALIZED VIEW public.mv_public_stats;

SET LOCAL ROLE remaining_definer_probe;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d1a1","role":"authenticated"}', true);
SELECT throws_ok($$ SELECT public._pm_caller_guild_codes() $$, '42501', NULL,
  'JSON claims for a real synthetic member do not admit a direct role');
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d1a1', true);
SELECT throws_ok($$ SELECT public.get_auth_uid() $$, '42501', NULL,
  'flat subject claims do not admit a direct role');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d1a2', true);
SELECT throws_ok($$ SELECT public.get_user_accessible_guilds() $$, '42501', NULL,
  'an unknown forged subject is also rejected before the body');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d1a1","role":"authenticated"}', true);
SELECT is(public.get_auth_uid(), '00000000-0000-4000-8000-00000000d1a1'::uuid,
  'authenticated identity helper still resolves the subject');
SELECT is(public.get_auth_role(), 'authenticated', 'authenticated role helper still resolves the role');
SELECT is((SELECT array_agg(g) FROM public._pm_caller_guild_codes() g), ARRAY['TAPD1']::text[],
  'authenticated member still resolves the expected guild');
SELECT is(public._pm_caller_is_app_admin(), false, 'ordinary member remains a non-admin');
SELECT is((SELECT count(*)::integer FROM public.guild_sync_status WHERE guild_code='TAPD1'), 1,
  'authenticated SELECT still evaluates the helper-backed RLS policy');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(public.get_invite_code_info('ZZZZZZZZZZZZ')->>'valid', 'false',
  'logged-out invite lookup still returns its invalid-code contract');
SELECT is(jsonb_typeof(public.get_public_stats()), 'object', 'logged-out public statistics still execute');
SELECT is(public.check_guild_exists('TAPD1'), true, 'logged-out guild availability still executes');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT is(public.categorize_team_composition(ARRAY['synthetic-unknown-hero']), 'Other',
  'service ingestion keeps its nested categorization helper');
RESET ROLE;

-- Trigger execution on an existing attachment does not require direct
-- EXECUTE. Exercise the actual login audit body through a synthetic relation.
CREATE TEMP TABLE synthetic_login_event(user_id uuid);
GRANT INSERT ON synthetic_login_event TO supabase_auth_admin;
CREATE TRIGGER synthetic_login_audit AFTER INSERT ON synthetic_login_event
  FOR EACH ROW EXECUTE FUNCTION public.audit_login();
SET LOCAL ROLE supabase_auth_admin;
INSERT INTO synthetic_login_event VALUES ('00000000-0000-4000-8000-00000000d1a1');
RESET ROLE;
SELECT ok(NOT has_function_privilege('supabase_auth_admin', 'public.audit_login()', 'EXECUTE'),
  'auth service trigger caller has no direct EXECUTE from PUBLIC');
SELECT is((SELECT count(*)::integer FROM public.login_audit
  WHERE user_id='00000000-0000-4000-8000-00000000d1a1'), 1, 'login trigger still records its audit row');

SELECT * FROM finish();
ROLLBACK;

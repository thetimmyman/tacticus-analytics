-- Synthetic regression through the real helper, RLS, and nested RPC. Genuine
-- login/role escalation and exact rollback controls run in test:pgtap:controls.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT plan(24);

SELECT is((SELECT count(*)::integer FROM supabase_migrations.schema_migrations
  WHERE version='20261008001000' AND name='policy_rows_trusted_caller'), 1,
  'the caller boundary migration is recorded');
SELECT ok((SELECT p.prosecdef AND p.provolatile='s' AND l.lanname='plpgsql'
  AND p.proconfig=ARRAY['search_path=public, pg_temp']
  AND pg_get_userbyid(p.proowner)='postgres'
  FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid='public._pm_caller_policy_rows()'::regprocedure),
  'the non-inlined definer attributes remain intact');
SELECT ok((SELECT bool_and(has_function_privilege(r,'public._pm_caller_policy_rows()','EXECUTE'))
  FROM unnest(ARRAY['anon','authenticated','service_role','analytics_ro','command_center_rpc_owner']) r),
  'API, readonly and nested-owner callers retain EXECUTE for policy evaluation');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p,
  LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._pm_caller_policy_rows()'::regprocedure AND a.grantee=0),
  'the fix adds no PUBLIC grant');
SELECT ok(NOT has_any_column_privilege('analytics_ro','public.player_mapping','SELECT'),
  'readonly analytics still has no direct membership SELECT');

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000d211');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.guild_config(id,guild_code,display_name)
VALUES (990611,'BOUNDARY-A','Synthetic boundary guild');
ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
INSERT INTO public.player_mapping(id,player_id,display_name,user_id,guild_code,role,is_current,is_active)
VALUES (990611,'BOUNDARY-MEMBER','Synthetic member','00000000-0000-4000-8000-00000000d211',
  'BOUNDARY-A','leader',true,true);
ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
INSERT INTO public.guild_war_meta_teams(guild_code,name,side,heroes)
VALUES ('BOUNDARY-A','Synthetic team','offense','[{"unitId":"boundary-alpha","role":"core"}]');
GRANT USAGE ON SCHEMA extensions TO analytics_ro, command_center_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO analytics_ro, command_center_rpc_owner;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','',true);
SET LOCAL ROLE analytics_ro;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000d211","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'a forged JSON identity cannot reveal a real synthetic member');
SELECT set_config('request.jwt.claims','',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d211',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'flat subject and service role claims cannot confer authority');
SELECT set_config('request.jwt.claim.sub','bad-uuid',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'an untrusted caller is denied before subject parsing');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d212',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'unknown claimed subjects also return no rows');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'ordinary readonly calls still complete empty');
SELECT throws_ok('SELECT user_id FROM public.player_mapping','42501',NULL,
  'readonly direct membership SELECT preserves its permission error');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000d211","role":"authenticated"}',true);
SELECT is((SELECT array_agg(player_id) FROM public._pm_caller_policy_rows()),ARRAY['BOUNDARY-MEMBER']::text[],
  'authenticated JSON callers keep their own mapping');
SELECT set_config('request.jwt.claims','',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d211',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),1,
  'authenticated flat claims retain membership');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'authenticated callers with no subject remain empty');
SELECT set_config('request.jwt.claim.sub','bad-uuid',true);
SELECT throws_ok('SELECT * FROM public._pm_caller_policy_rows()','22P02',NULL,
  'trusted malformed subjects preserve the auth parser error');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000d211"}',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),1,
  'service callers still resolve the supplied subject');
SELECT set_config('request.jwt.claims','',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'service calls without a subject remain empty');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d211',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'an anon SQL role cannot elevate itself by naming a member');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'ordinary anonymous calls remain empty without raising');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d211',true);
SELECT is((SELECT count(*)::integer FROM public.guild_war_meta_teams WHERE guild_code='BOUNDARY-A'),1,
  'helper-backed RLS still admits the guild member');
SELECT is((SELECT count(*)::integer FROM public.get_war_room_team_readiness('BOUNDARY-A',9)),1,
  'a nested definer RPC retains the authenticated outer role');
SELECT is((SELECT count(*)::integer FROM public.get_war_room_team_readiness('BOUNDARY-OTHER',9)),0,
  'the nested RPC still hides another guild');
RESET ROLE;

CREATE FUNCTION public.synthetic_policy_caller_nested() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp
AS 'SELECT count(*) FROM public._pm_caller_policy_rows()';
ALTER FUNCTION public.synthetic_policy_caller_nested() OWNER TO command_center_rpc_owner;
GRANT EXECUTE ON FUNCTION public.synthetic_policy_caller_nested() TO authenticated;
SET LOCAL ROLE authenticated;
SELECT is(public.synthetic_policy_caller_nested(),1::bigint,
  'command-center owner nesting keeps the outer authenticated role');
RESET ROLE;
SET LOCAL ROLE command_center_rpc_owner;
SELECT is((SELECT count(*)::integer FROM public._pm_caller_policy_rows()),0,
  'the owner role alone is not an authenticated caller');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

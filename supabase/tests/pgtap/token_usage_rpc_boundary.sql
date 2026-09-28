BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(11);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
   WHERE version = '20260801130000' AND name = 'wi4450_token_usage_rpc_boundary'),
  1,
  'token-usage boundary migration is recorded exactly once'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc p
   WHERE p.oid IN (
     'public.get_token_usage_for_guild(text,text)'::regprocedure,
     'public.compute_player_tokens_available(text,text,text,timestamptz)'::regprocedure,
     'public.compute_player_token_burn(text,text,text,timestamptz)'::regprocedure,
     'public.calculate_player_tokens_by_user(text,text,text)'::regprocedure,
     'public.calculate_player_tokens(text,text,text)'::regprocedure,
     'public.get_token_allocation_settings(text)'::regprocedure,
     'public.get_token_usage_by_loop_and_set(text,text,text[])'::regprocedure,
     'public.get_flexible_token_coverage(text,text)'::regprocedure,
     'public.get_guild_token_status(text,text)'::regprocedure,
     'public.get_player_token_burn_history(text,text,text,integer)'::regprocedure,
     'public.get_player_token_summary(text,text)'::regprocedure,
     'public.get_token_burn_state(text,text,text,text)'::regprocedure,
     'public.migrate_boss_target_tokens_legacy_names(boolean)'::regprocedure,
     'public.record_token_burn_state(text,text,text,text,integer,integer,timestamptz)'::regprocedure,
     'public.update_bomb_used(text,text,text)'::regprocedure,
     'public.update_token_burn_state_for_guild(text,text)'::regprocedure
   )),
  16,
  'all 16 exact amended token regprocedures exist'
);

SELECT ok(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::text[]
   FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_token_usage_for_guild(text,text)'::regprocedure),
  'wrapper is SECURITY DEFINER with an empty search_path'
);

SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::text[]
   FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_token_usage_by_loop_and_set(text,text,text[])'::regprocedure),
  'loop-and-set remains invoker-owned with an empty search_path'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_token_usage_for_guild(text,text)', 'EXECUTE') = false
    AND has_function_privilege('authenticated', 'public.get_token_usage_for_guild(text,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.get_token_usage_for_guild(text,text)', 'EXECUTE'),
  'wrapper ACL is authenticated/service_role only'
);

SELECT ok(
  has_function_privilege('anon', 'public.compute_player_tokens_available(text,text,text,timestamptz)', 'EXECUTE') = false
    AND has_function_privilege('authenticated', 'public.compute_player_tokens_available(text,text,text,timestamptz)', 'EXECUTE') = false
    AND has_function_privilege('service_role', 'public.compute_player_tokens_available(text,text,text,timestamptz)', 'EXECUTE'),
  'availability helper ACL is service_role only'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_token_usage_by_loop_and_set(text,text,text[])', 'EXECUTE') = false
    AND has_function_privilege('authenticated', 'public.get_token_usage_by_loop_and_set(text,text,text[])', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.get_token_usage_by_loop_and_set(text,text,text[])', 'EXECUTE'),
  'loop-and-set ACL is authenticated/service_role only'
);

SELECT ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid) LIKE '%auth.uid()%'
   FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_token_usage_for_guild(text,text)'::regprocedure),
  'wrapper binds non-service callers to auth.uid()'
);

SELECT ok(
  has_function_privilege('anon', 'public.calculate_player_tokens(text,text,text)', 'EXECUTE') = false
    AND has_function_privilege('authenticated', 'public.calculate_player_tokens(text,text,text)', 'EXECUTE') = false
    AND has_function_privilege('service_role', 'public.calculate_player_tokens(text,text,text)', 'EXECUTE'),
  'legacy calculator ACL is service_role only'
);

-- EOT_GR_data is not a public API, so get_token_usage_by_loop has no anon EXECUTE.
SELECT ok(
  has_function_privilege('anon', 'public.get_token_usage_by_loop(text,text,text[])', 'EXECUTE') = false
    AND has_function_privilege('authenticated', 'public.get_token_usage_by_loop(text,text,text[])', 'EXECUTE'),
  'loop aggregate is authenticated-only; anon EXECUTE revoked'
);

SELECT ok(
  has_function_privilege('anon', 'public.postgrest_anon_probe()', 'EXECUTE'),
  'the data-free health probe is the anon-callable one'
);

SELECT * FROM finish();
ROLLBACK;

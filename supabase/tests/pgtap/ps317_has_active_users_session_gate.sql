-- has_active_users(text) bypasses player_mapping RLS, so the BODY must refuse sessionless callers
-- (a PUBLIC re-grant survives the ACL). 8 and 9 prove it still computes.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(10);

SELECT has_function(
  'public', 'has_active_users', ARRAY['text'],
  'has_active_users(text) still exists with its original signature'
);

SELECT ok(
  (SELECT p.prosecdef
     FROM pg_proc p
    WHERE p.oid = 'public.has_active_users(text)'::regprocedure),
  'it is still SECURITY DEFINER (the gate is the fix, not dropping definer)'
);

SELECT ok(
  has_function_privilege('anon', 'public.has_active_users(text)', 'EXECUTE') = false,
  'anon holds no EXECUTE on has_active_users(text)'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p, aclexplode(p.proacl) AS a
    WHERE p.oid = 'public.has_active_users(text)'::regprocedure
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC holds no EXECUTE either, so a new role cannot inherit the grant'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.has_active_users(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.has_active_users(text)', 'EXECUTE'),
  'authenticated and service_role retain EXECUTE (the fix is a gate, not a removal)'
);

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('PS317OCCUPIED', 'PS-317 occupied fixture'),
       ('PS317EMPTY', 'PS-317 empty fixture');

INSERT INTO public.player_mapping (player_id, display_name, guild_code, is_current)
VALUES ('ps317-current', 'PS-317 current member', 'PS317OCCUPIED', true),
       ('ps317-former', 'PS-317 former member', 'PS317EMPTY', false);

-- pgTAP needs USAGE+EXECUTE on `extensions` for authenticated; scoped and rolled back.
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated;

SET LOCAL ROLE authenticated;

-- Live auth.uid() reads request.jwt.claims, the throwaway shim reads request.jwt.claim.sub.

SELECT set_config('request.jwt.claims', NULL, true);
SELECT set_config('request.jwt.claim.sub', NULL, true);

SELECT throws_ok(
  $$ SELECT public.has_active_users('PS317OCCUPIED') $$,
  '42501',
  NULL,
  'a caller with no auth.uid() (logged out) raises 42501 regardless of the ACL'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT lives_ok(
  $$ SELECT public.has_active_users('PS317OCCUPIED') $$,
  'an authenticated caller with a session is allowed through the guard'
);

SELECT is(
  public.has_active_users('PS317OCCUPIED'),
  true,
  'a guild code with a current member still answers true (the gate did not blind the predicate)'
);

SELECT is(
  public.has_active_users('PS317EMPTY'),
  false,
  'a guild code whose only member is not current still answers false (is_current still filters)'
);

-- PL/pgSQL skips a NULL guard condition and authorises the call; assert NULL input.
SELECT set_config('request.jwt.claims', NULL, true);
SELECT set_config('request.jwt.claim.sub', NULL, true);
SELECT set_config('request.jwt.claim.role', NULL, true);

SELECT throws_ok(
  $$ SELECT public.has_active_users(NULL::text) $$,
  '42501',
  NULL,
  'a NULL guild code from a logged-out caller raises 42501 (the guard is not NULL-skippable)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

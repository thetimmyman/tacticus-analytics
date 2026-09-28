-- can_upload_guild_images(uuid) bypasses player_mapping RLS, so its body must be
-- self-only and anon must hold no EXECUTE.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(11);

SELECT has_function(
  'public', 'can_upload_guild_images', ARRAY['uuid'],
  'can_upload_guild_images(uuid) still exists with its original signature'
);

SELECT ok(
  (SELECT p.prosecdef
     FROM pg_proc p
    WHERE p.oid = 'public.can_upload_guild_images(uuid)'::regprocedure),
  'it is still SECURITY DEFINER (the gate is the fix, not dropping definer)'
);

-- Barrier 1: the ACL.
SELECT ok(
  has_function_privilege('anon', 'public.can_upload_guild_images(uuid)', 'EXECUTE') = false,
  'anon holds no EXECUTE on can_upload_guild_images(uuid)'
);

-- grantee = 0 is PUBLIC (has_function_privilege() cannot ask about it).
SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p, aclexplode(p.proacl) AS a
    WHERE p.oid = 'public.can_upload_guild_images(uuid)'::regprocedure
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC holds no EXECUTE either, so a new role cannot inherit the grant'
);

-- Not a lockout.
SELECT ok(
  has_function_privilege('authenticated', 'public.can_upload_guild_images(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.can_upload_guild_images(uuid)', 'EXECUTE'),
  'authenticated and service_role retain EXECUTE (the fix is a gate, not a removal)'
);

-- Barrier 2, as authenticated. Subject B has no mapping row, so a refusal is not
-- "no such user"; pgTAP EXECUTE is granted here and rolled back.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT public.can_upload_guild_images('22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501',
  NULL,
  'authenticated A asking about a DIFFERENT user B raises 42501'
);

SELECT lives_ok(
  $$ SELECT public.can_upload_guild_images('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'authenticated A asking about ITSELF is allowed through the guard'
);

-- Returns a boolean (false: no mapping row), not just "does not raise".
SELECT is(
  public.can_upload_guild_images('11111111-1111-4111-8111-111111111111'::uuid),
  false,
  'the self-query still evaluates the predicate and returns its boolean'
);

-- No session is refused by the body too, independent of the ACL.
SELECT set_config('request.jwt.claims', NULL, true);

SELECT throws_ok(
  $$ SELECT public.can_upload_guild_images('22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501',
  NULL,
  'authenticated with no auth.uid() (logged out) raises 42501 regardless of the ACL'
);

-- A `<>` guard would propagate NULL and skip the IF; both halves are probed.
SELECT throws_ok(
  $$ SELECT public.can_upload_guild_images(NULL::uuid) $$,
  '42501',
  NULL,
  'a NULL p_user_id from a logged-out caller raises 42501 (two NULLs must not compare equal)'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT public.can_upload_guild_images(NULL::uuid) $$,
  '42501',
  NULL,
  'a NULL p_user_id from a logged-IN caller raises 42501 (NULL does not skip the guard)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

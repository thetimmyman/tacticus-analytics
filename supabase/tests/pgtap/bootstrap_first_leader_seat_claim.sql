BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(9);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260819030000'
      AND name = 'bootstrap_first_leader_seat_claim'
  ),
  1,
  'first-leader seat bootstrap migration is recorded exactly once'
);

-- Default privileges hand new functions to anon/authenticated, so the REVOKE is load-bearing.
SELECT set_eq(
  $actual$
    SELECT COALESCE(grantee.rolname, 'PUBLIC')
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE function.oid
      = 'public.mint_bootstrap_seat_invite(uuid,text,text)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $actual$,
  $expected$ VALUES ('postgres'), ('service_role') $expected$,
  'only postgres and service_role may execute the bootstrap mint'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.mint_bootstrap_seat_invite(uuid,text,text)', 'EXECUTE'
  ),
  'anon cannot execute the bootstrap mint'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.mint_bootstrap_seat_invite(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute the bootstrap mint'
);

SELECT is(
  (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.mint_bootstrap_seat_invite(uuid,text,text)'::regprocedure
  ),
  true,
  'the bootstrap mint is SECURITY DEFINER'
);

SELECT is(
  (
    SELECT proconfig::text
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.mint_bootstrap_seat_invite(uuid,text,text)'::regprocedure
  ),
  '{search_path=public}',
  'the bootstrap mint pins search_path'
);

-- EXECUTE alone is not enough: a non-service_role request role is refused even with a grant.
SELECT throws_ok(
  $$ SELECT public.mint_bootstrap_seat_invite(
       '00000000-0000-0000-0000-000000000001'::uuid,
       'some-player',
       repeat('a', 64)
     ) $$,
  '42501',
  NULL,
  'a non-service_role caller is refused even with EXECUTE'
);

-- The claim wrapper is authenticated-only; service_role would bypass its auth.uid() binding.
SELECT set_eq(
  $actual$
    SELECT COALESCE(grantee.rolname, 'PUBLIC')
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE function.oid = 'public.claim_bootstrap_seat(text)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $actual$,
  $expected$ VALUES ('postgres'), ('authenticated') $expected$,
  'only postgres and authenticated may execute the bootstrap claim wrapper'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.claim_bootstrap_seat(text)', 'EXECUTE'
  ),
  'service_role cannot bypass the claim wrapper''s auth.uid() binding'
);

-- service_role argument validation is untested: it has no USAGE on `extensions`.

SELECT * FROM finish();
ROLLBACK;

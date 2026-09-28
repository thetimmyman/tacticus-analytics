BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(12);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260927200000'
      AND name = 'bootstrap_authority_canonical_guild_code'
  ),
  1,
  'canonical guild-code bootstrap migration is recorded exactly once'
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
      = 'public.record_guild_bootstrap_claim_authority(uuid,text,bigint,text)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $actual$,
  $expected$ VALUES ('postgres'), ('service_role') $expected$,
  'only postgres and service_role may execute the bootstrap authority recorder'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.record_guild_bootstrap_claim_authority(uuid,text,bigint,text)',
    'EXECUTE'
  ),
  'anon cannot execute the bootstrap authority recorder'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.record_guild_bootstrap_claim_authority(uuid,text,bigint,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute the bootstrap authority recorder'
);

-- EXECUTE alone is not enough: a non-service_role request role is refused even with a grant.
SELECT throws_ok(
  $$ SELECT public.record_guild_bootstrap_claim_authority(
       '00000000-0000-0000-0000-00000000b001'::uuid,
       'aaaa0001-0000-4000-8000-0000000000a1',
       1,
       'verified_registration'
     ) $$,
  '42501',
  NULL,
  'a non-service_role caller is refused even with EXECUTE'
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-00000000b001'),
  ('00000000-0000-0000-0000-00000000b002'),
  ('00000000-0000-0000-0000-00000000b003'),
  ('00000000-0000-0000-0000-00000000b004');

INSERT INTO public.guild_config (guild_code, display_name, enabled) VALUES
  ('aaaa0001-0000-4000-8000-0000000000a1', 'Bootstrap UUID Guild', true),
  ('TESTA', 'Bootstrap Tag Guild', true),
  ('DISABLEDG', 'Bootstrap Disabled Guild', false);

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$ SELECT public.record_guild_bootstrap_claim_authority(
       '00000000-0000-0000-0000-00000000b001'::uuid,
       'aaaa0001-0000-4000-8000-0000000000a1',
       1,
       'verified_registration'
     ) $$,
  'a lower-case UUID guild gets a bootstrap authority receipt'
);

SELECT lives_ok(
  $$ SELECT public.record_guild_bootstrap_claim_authority(
       '00000000-0000-0000-0000-00000000b002'::uuid,
       'testa',
       1,
       'verified_registration'
     ) $$,
  'a tag guild passed in lower case still resolves'
);

-- The onboarding route upper-cases the code it was given, so a UUID guild arrives upper-cased.
SELECT lives_ok(
  $$ SELECT public.record_guild_bootstrap_claim_authority(
       '00000000-0000-0000-0000-00000000b004'::uuid,
       'AAAA0001-0000-4000-8000-0000000000A1',
       1,
       'verified_registration'
     ) $$,
  'an upper-cased UUID guild code resolves to the stored lower-case guild'
);

SELECT throws_ok(
  $$ SELECT public.record_guild_bootstrap_claim_authority(
       '00000000-0000-0000-0000-00000000b003'::uuid,
       'DISABLEDG',
       1,
       'verified_registration'
     ) $$,
  '22023',
  'Registered guild does not exist or is disabled',
  'a disabled guild is refused'
);

RESET ROLE;

SELECT is(
  (
    SELECT guild_code
    FROM public.player_claim_audit
    WHERE user_id = '00000000-0000-0000-0000-00000000b001'
      AND source_path = 'onboarding/guild-registration/bootstrap-authority'
      AND outcome = 'success'
  ),
  'aaaa0001-0000-4000-8000-0000000000a1',
  'the receipt stores the canonical lower-case UUID code'
);

SELECT is(
  (
    SELECT guild_code
    FROM public.player_claim_audit
    WHERE user_id = '00000000-0000-0000-0000-00000000b002'
      AND source_path = 'onboarding/guild-registration/bootstrap-authority'
      AND outcome = 'success'
  ),
  'TESTA',
  'the receipt stores the canonical upper-case tag code'
);

SELECT is(
  (
    SELECT guild_code
    FROM public.player_claim_audit
    WHERE user_id = '00000000-0000-0000-0000-00000000b004'
      AND source_path = 'onboarding/guild-registration/bootstrap-authority'
      AND outcome = 'success'
  ),
  'aaaa0001-0000-4000-8000-0000000000a1',
  'an upper-cased UUID input still records the stored lower-case code'
);

SELECT * FROM finish();
ROLLBACK;

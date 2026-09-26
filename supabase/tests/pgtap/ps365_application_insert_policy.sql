-- The INSERT policy must bind applicant_user_id to the caller (the owner-read policy trusts it).
-- The table is live-only, so this tests a fixture carrying the migration's policy verbatim.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(18);

-- Lane control and ledger: a failed or no-op migration must fail loudly.
SELECT is(
  current_database()::text,
  'postgres'::text,
  'this suite runs against the general database'::text
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260919123000'
      AND name = 'ps365_application_insert_policy_caller_bound'
  ),
  'the PS-365 migration is recorded in the ledger'
);

SELECT * FROM skip(
  1,
  'public.universal_guild_applications is live-only -- no migration in this repository creates it (matching PS-381 and PS-399) -- so this replay lane cannot read the shipped policy directly off that table, and this suite''s author has no production database access to dump it. The mechanism is proven below against a same-shaped fixture whose CREATE POLICY text is transcribed byte-for-byte from the migration this suite ships beside.'
);

GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, service_role;

CREATE TABLE public.ps365_fixture_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_code text NOT NULL,
  applicant_user_id uuid,
  status text NOT NULL DEFAULT 'pending'
);
ALTER TABLE public.ps365_fixture_applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ps365_fixture_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ps365_fixture_applications TO authenticated;
GRANT ALL ON public.ps365_fixture_applications TO service_role;

SELECT ok(
  NOT has_table_privilege('anon', 'public.ps365_fixture_applications', 'INSERT'),
  'fixture: anon holds no INSERT grant, matching the live table PS-365 measured'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.ps365_fixture_applications', 'INSERT'),
  'fixture: authenticated holds INSERT, matching the live table'
);

CREATE POLICY "Anyone can submit applications" ON public.ps365_fixture_applications
  FOR INSERT
  WITH CHECK (true);

-- The shim's auth.uid() reads request.jwt.claim.sub, not request.jwt.claims.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT lives_ok(
  $$ INSERT INTO public.ps365_fixture_applications (guild_code, applicant_user_id)
     VALUES ('PS365', '22222222-2222-4222-8222-222222222222'::uuid) $$,
  'NEGATIVE CONTROL: under the pre-state WITH CHECK (true), an authenticated caller CAN insert naming a DIFFERENT applicant_user_id'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', NULL, true);

SELECT is(
  (SELECT count(*)::int FROM public.ps365_fixture_applications
    WHERE applicant_user_id = '22222222-2222-4222-8222-222222222222'::uuid),
  1::int,
  'NEGATIVE CONTROL: the forged row is really there -- this is the defect PS-365 reports, reproduced'::text
);

DELETE FROM public.ps365_fixture_applications;
DROP POLICY "Anyone can submit applications" ON public.ps365_fixture_applications;

-- Byte-identical to the migration's CREATE POLICY, so drift shows as a diff.
CREATE POLICY "Anyone can submit applications" ON public.ps365_fixture_applications
  FOR INSERT TO authenticated
  WITH CHECK (applicant_user_id = (SELECT auth.uid()));

SELECT ok(
  NOT has_table_privilege('anon', 'public.ps365_fixture_applications', 'INSERT'),
  'after the fix: anon still holds no INSERT grant -- the fix does not move a grant'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.ps365_fixture_applications', 'INSERT'),
  'after the fix: authenticated still holds INSERT -- this is a gate, not a lockout'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT lives_ok(
  $$ INSERT INTO public.ps365_fixture_applications (guild_code, applicant_user_id)
     VALUES ('PS365', '11111111-1111-4111-8111-111111111111'::uuid) $$,
  'authenticated: INSERT with applicant_user_id equal to the caller''s own auth.uid() succeeds'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', NULL, true);

SELECT is(
  (SELECT count(*)::int FROM public.ps365_fixture_applications
    WHERE applicant_user_id = '11111111-1111-4111-8111-111111111111'::uuid),
  1::int,
  'POSITIVE CONTROL: the own-uid row is really there'::text
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT throws_ok(
  $$ INSERT INTO public.ps365_fixture_applications (guild_code, applicant_user_id)
     VALUES ('PS365', '22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501',
  NULL,
  'authenticated: INSERT naming a DIFFERENT applicant_user_id now raises 42501'
);

-- NULL = auth.uid() fails WITH CHECK (unlike a PL/pgSQL IF, where NULL skips the guard).
SELECT throws_ok(
  $$ INSERT INTO public.ps365_fixture_applications (guild_code, applicant_user_id)
     VALUES ('PS365', NULL) $$,
  '42501',
  NULL,
  'authenticated: INSERT leaving applicant_user_id NULL now raises 42501'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', NULL, true);

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$ INSERT INTO public.ps365_fixture_applications (guild_code, applicant_user_id)
     VALUES ('PS365', '33333333-3333-4333-8333-333333333333'::uuid) $$,
  'service_role: INSERT naming any applicant_user_id still succeeds (RLS-bypassing server path is unaffected)'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.ps365_fixture_applications
    WHERE applicant_user_id = '33333333-3333-4333-8333-333333333333'::uuid),
  1::int,
  'POSITIVE CONTROL: the service_role-inserted row is really there'::text
);

SELECT ok(
  (SELECT p.with_check FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'ps365_fixture_applications'
      AND p.policyname = 'Anyone can submit applications') ~ 'auth\.uid\(\)',
  'the fixed policy''s WITH CHECK references auth.uid()'
);

SELECT ok(
  (SELECT p.with_check FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'ps365_fixture_applications'
      AND p.policyname = 'Anyone can submit applications') ~ 'applicant_user_id',
  'the fixed policy''s WITH CHECK references applicant_user_id'
);

SELECT isnt(
  trim((SELECT p.with_check FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'ps365_fixture_applications'
      AND p.policyname = 'Anyone can submit applications')),
  'true'::text,
  'the fixed policy''s WITH CHECK is no longer bare true'::text
);

SELECT * FROM finish();
ROLLBACK;

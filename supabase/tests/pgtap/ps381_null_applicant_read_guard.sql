-- A NULL applicant_user_id makes `applicant = auth.uid()` NULL and PL/pgSQL skips the deny branch.
-- Objects are live-only (PGTAP_LIVE_FUNCTIONS); verdicts cast json to text (json has no =).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(20);

SELECT is(
  current_database()::text,
  'postgres'::text,
  'this suite runs against the general database'::text
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260904220000'
      AND name = 'ps381_null_applicant_read_guard'
  ),
  'the PS-381 migration is recorded in the ledger'
);

SELECT ok(
  (NULL::uuid = '11111111-1111-4111-8111-111111111111'::uuid) IS NULL,
  'the shipped-broken `applicant_user_id = auth.uid()` is NULL, not false, for a NULL applicant'
);

SELECT ok(
  (NOT NULL::boolean AND NOT false) IS NULL,
  'NOT NULL AND NOT false is NULL -- PL/pgSQL does not enter the IF, so the deny branch and the app-admin fallback inside it are both skipped'
);

SELECT ok(
  (NOT NULL::boolean AND NOT true) IS FALSE,
  'for an OFFICER the same expression is a clean false, so the defect is invisible from the seat a reviewer checks first'
);

SELECT ok(
  (NOT (NULL::uuid IS NULL
        OR NULL::uuid IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid)) IS FALSE,
  'the ADOPTED form makes v_is_applicant a clean false for a NULL applicant, so the deny branch is entered'
);

SELECT ok(
  (NOT ('11111111-1111-4111-8111-111111111111'::uuid IS NULL
        OR '11111111-1111-4111-8111-111111111111'::uuid
             IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid)) IS TRUE,
  'the ADOPTED form still recognises the real applicant -- this is a gate, not a lockout'
);

-- The trap as an executable assertion, so "simplifying" the guard goes red.
SELECT ok(
  (NULL::uuid IS DISTINCT FROM NULL::uuid) IS FALSE,
  'IS DISTINCT FROM alone treats two NULLs as EQUAL -- do not drop the `applicant_user_id IS NULL` disjunct'
);

-- Presence of the adopted form (absence of the old one is not enough).
SELECT ok(
  (SELECT p.prosrc ~ 'applicant_user_id\s+IS\s+NULL'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_application_with_messages'),
  'get_application_with_messages carries the `applicant_user_id IS NULL` disjunct'
);

SELECT ok(
  (SELECT p.prosrc ~ 'applicant_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_application_with_messages'),
  'get_application_with_messages carries the NULL-safe comparison'
);

-- Comments are stripped because the fixed body quotes the broken expression.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
            ~ 'applicant_user_id\s*=\s*auth\.uid\(\)'),
  0::int,
  'no function in public compares applicant_user_id to auth.uid() with a bare = (the form whose NULL is laundered into a boolean variable)'
);

SELECT ok(
  (SELECT p.prosecdef AND p.proconfig IS NOT NULL
     FROM pg_proc p
    WHERE p.oid = 'public.get_application_with_messages(uuid)'::regprocedure),
  'the function still exists with its original signature, still SECURITY DEFINER, still search_path-pinned'
);

SELECT ok(
  (SELECT p.prosrc ~ 'is_app_admin' AND p.prosrc ~ 'officer' AND p.prosrc ~ 'application_messages'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_application_with_messages'),
  'the guild-officer branch, the app-admin fallback and the message aggregation are all still in the body'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_application_with_messages(uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_application_with_messages(uuid)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_application_with_messages(uuid)'::regprocedure, 'EXECUTE'),
  'PS-285 grants are untouched: anon and authenticated hold no EXECUTE, service_role still does'
);

-- As the definer's owner; triggers and FKs are bypassed for these rolled-back fixtures only.
SET LOCAL session_replication_role = replica;

INSERT INTO public.universal_guild_applications
  (id, guild_code, applicant_user_id, applicant_name, applicant_email,
   applicant_discord, internal_notes, status)
VALUES
  ('381a0000-0000-4000-8000-000000000381'::uuid, 'PS381', NULL,
   'PS381 Applicant', 'ps381-applicant@example.invalid',
   'ps381applicant', 'PS381 internal note', 'pending');

INSERT INTO public.application_messages
  (application_id, sender_user_id, sender_type, sender_name, message)
VALUES
  ('381a0000-0000-4000-8000-000000000381'::uuid, NULL, 'applicant',
   'PS381 Applicant', 'first message'),
  ('381a0000-0000-4000-8000-000000000381'::uuid, NULL, 'guild',
   'PS381 Officer', 'second message');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, user_id, role, is_current, is_app_admin)
VALUES
  ('ps381-officer', 'PS381 Officer', 'PS381',
   '22222222-2222-4222-8222-222222222222'::uuid, 'officer', true, false),
  ('ps381-admin', 'PS381 Admin', 'PS381OTHER',
   '33333333-3333-4333-8333-333333333333'::uuid, NULL, true, true);

-- Positive control first, so 18 and 19 do not pass against nothing.
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

SELECT is(
  json_array_length(
    public.get_application_with_messages('381a0000-0000-4000-8000-000000000381'::uuid)
      -> 'messages')::int,
  2::int,
  'POSITIVE CONTROL: a guild officer still reads the fixture application and both of its messages'::text
);

SELECT is(
  public.get_application_with_messages('381a0000-0000-4000-8000-000000000381'::uuid)
    -> 'application' ->> 'applicant_email',
  'ps381-applicant@example.invalid'::text,
  'POSITIVE CONTROL: the payload really does carry the applicant PII, so a NULL below is a denial and not an empty row'::text
);

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

SELECT isnt(
  public.get_application_with_messages('381a0000-0000-4000-8000-000000000381'::uuid)::text,
  NULL::text,
  'an app admin still reads the application -- the app-admin fallback the NULL used to skip past now actually runs'
);

SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

SELECT is(
  public.get_application_with_messages('381a0000-0000-4000-8000-000000000381'::uuid)::text,
  NULL::text,
  'a logged-in caller who is neither applicant, officer nor app admin gets NULL for a NULL-applicant row'::text
);

SELECT set_config('request.jwt.claim.sub', NULL, true);
SELECT set_config('request.jwt.claims', NULL, true);

SELECT is(
  public.get_application_with_messages('381a0000-0000-4000-8000-000000000381'::uuid)::text,
  NULL::text,
  'a caller with no session at all gets NULL -- two NULLs must not compare equal into an authorisation'::text
);

-- A fix making everyone the applicant would pass 18/19.
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

SELECT is(
  public.get_application_with_messages('381a0000-0000-4000-8000-000000000381'::uuid)
    ->> 'viewer_type',
  'guild'::text,
  'viewer_type for a non-applicant reader is still `guild` -- the CASE was not disturbed'::text
);

SET LOCAL session_replication_role = origin;

SELECT * FROM finish();
ROLLBACK;

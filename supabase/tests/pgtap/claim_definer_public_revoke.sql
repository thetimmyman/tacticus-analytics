-- SECURITY DEFINER functions that read the caller from request.jwt.claims must
-- not be executable through PUBLIC: any role that logs in directly can SET
-- those claims itself. grantee = 0 is PUBLIC in proacl. The two application
-- message functions are live-only, so every count is over the ones present.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(9);

CREATE TEMP TABLE tcd_revoked(signature text) ON COMMIT DROP;
INSERT INTO tcd_revoked(signature) VALUES
    ('public.update_player_boss_assignments_admin(text, text, text, text)'),
    ('public.update_player_boss_preferences_admin(text, jsonb)'),
    ('public.update_player_meta_teams_admin(text, text, text, text)'),
    ('public.update_player_notes_admin(text, text, text)'),
    ('public.send_application_message(uuid, text, text, text)'),
    ('public.mark_application_messages_read(uuid, text)');

CREATE TEMP VIEW tcd_present AS
  SELECT signature, to_regprocedure(signature) AS fn
    FROM tcd_revoked
   WHERE to_regprocedure(signature) IS NOT NULL;

SELECT is(
  (SELECT count(*)::integer FROM tcd_present WHERE signature LIKE 'public.update_player_%'),
  4,
  'the four player admin functions exist with the signatures the migration names'
);

SELECT is(
  (SELECT count(*)::integer FROM tcd_present t JOIN pg_proc p ON p.oid = t.fn WHERE p.prosecdef),
  (SELECT count(*)::integer FROM tcd_present),
  'every present function is still SECURITY DEFINER (the fix is a gate, not a downgrade)'
);

SELECT is(
  (SELECT count(*)::integer
     FROM tcd_present t, pg_proc p, aclexplode(p.proacl) AS a
    WHERE p.oid = t.fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  + (SELECT count(*)::integer FROM tcd_present t JOIN pg_proc p ON p.oid = t.fn WHERE p.proacl IS NULL),
  0,
  'PUBLIC holds EXECUTE on none of them (a NULL proacl would mean the PUBLIC default)'
);

SELECT is(
  (SELECT count(*)::integer FROM tcd_present WHERE has_function_privilege('anon', fn, 'EXECUTE')),
  0,
  'anon holds EXECUTE on none of them (each returns AUTH_REQUIRED or raises without a subject anyway)'
);

-- Not a lockout.
SELECT is(
  (SELECT count(*)::integer FROM tcd_present WHERE has_function_privilege('authenticated', fn, 'EXECUTE')),
  (SELECT count(*)::integer FROM tcd_present),
  'authenticated retains EXECUTE on all of them (the guild management modals call them)'
);

SELECT is(
  (SELECT count(*)::integer FROM tcd_present WHERE has_function_privilege('service_role', fn, 'EXECUTE')),
  (SELECT count(*)::integer FROM tcd_present),
  'service_role retains EXECUTE on all of them'
);

-- A role that is neither authenticated nor service_role, as a direct database
-- login would be, gets no EXECUTE from PUBLIC even with forged claims.
CREATE ROLE claim_definer_probe NOLOGIN;
GRANT USAGE ON SCHEMA public, extensions TO claim_definer_probe;

SELECT is(
  (SELECT count(*)::integer FROM tcd_present
    WHERE has_function_privilege('claim_definer_probe', fn, 'EXECUTE')),
  0,
  'a fresh role inherits EXECUTE on none of them'
);

SET LOCAL ROLE claim_definer_probe;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000c1a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.update_player_notes_admin('synthetic-player', 'forged', 'forged') $$,
  '42501', NULL,
  'a direct role with forged request.jwt.claims cannot call update_player_notes_admin'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000c1a1","role":"authenticated"}', true);
SELECT is(
  (SELECT public.update_player_notes_admin('synthetic-player', NULL, NULL)::jsonb ->> 'code'),
  'PROFILE_NOT_FOUND',
  'authenticated still reaches the function body, which applies its own officer check'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

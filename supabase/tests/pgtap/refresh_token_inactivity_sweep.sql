-- The sweep revokes exactly the unrevoked AND stale rows; each fixture row catches one missing clause.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(17);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260919210000'),
  1,
  '2. the refresh-token inactivity sweep migration is recorded as applied'
);

SELECT has_function(
  'public', 'revoke_stale_refresh_tokens', ARRAY['interval'],
  '3. public.revoke_stale_refresh_tokens(interval) exists'
);

SELECT is(
  (SELECT p.prosecdef
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.revoke_stale_refresh_tokens(interval)')),
  true,
  '4. the sweep is SECURITY DEFINER'
);

-- pg_cron and manual backlog runs issue the zero-argument call.
SELECT is(
  (SELECT (p.pronargdefaults = p.pronargs)
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.revoke_stale_refresh_tokens(interval)')),
  true,
  '5. revoke_stale_refresh_tokens() is callable with zero arguments'
);

-- aclexplode(NULL proacl) is empty, so 6 requires an explicit ACL before 7-8 mean anything.
SELECT ok(
  (SELECT p.proacl IS NOT NULL
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.revoke_stale_refresh_tokens(interval)')),
  '6. the sweep carries an explicit ACL, so 7-8 are not a vacuous pass against PUBLIC default privileges'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.revoke_stale_refresh_tokens(interval)', 'EXECUTE'),
  '7. anon holds no EXECUTE on the sweep'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.revoke_stale_refresh_tokens(interval)', 'EXECUTE'),
  '8. authenticated holds no EXECUTE on the sweep'
);

SELECT ok(
  has_function_privilege('postgres', 'public.revoke_stale_refresh_tokens(interval)', 'EXECUTE'),
  '9. postgres -- the pg_cron execution role and the operator''s own role -- holds EXECUTE'
);

DO $seed$
DECLARE
  v_user uuid := '39300000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_user, 'tp393@example.invalid', 'authenticated', 'authenticated');

  INSERT INTO auth.refresh_tokens
    (token, user_id, revoked, created_at, updated_at)
  VALUES
    ('tp393-fresh', v_user, false, now() - interval '1 day', now()),
    ('tp393-old-revoked', v_user, true,
       now() - interval '210 days', now() - interval '200 days'),
    ('tp393-old-unrevoked', v_user, false,
       now() - interval '210 days', now() - interval '200 days');
END;
$seed$;

SELECT is(
  (SELECT count(*)::integer FROM auth.refresh_tokens
    WHERE token IN ('tp393-fresh', 'tp393-old-revoked', 'tp393-old-unrevoked')
      AND revoked = false),
  2,
  '10. NEGATIVE CONTROL: with the age predicate dropped, revoked = false alone matches TWO rows (tp393-fresh and tp393-old-unrevoked) -- a predicate missing the age clause would revoke the fresh row too'
);

SELECT is(
  (SELECT count(*)::integer FROM auth.refresh_tokens
    WHERE token IN ('tp393-fresh', 'tp393-old-revoked', 'tp393-old-unrevoked')
      AND revoked = false
      AND updated_at < now() - interval '180 days'),
  1,
  '11. the real predicate (revoked = false AND updated_at < now() - 180 days) matches exactly ONE row in this fixture'
);

SELECT is(
  (SELECT public.revoke_stale_refresh_tokens()),
  1,
  '12. revoke_stale_refresh_tokens() returns 1 -- it agrees with assertion 11, the count the real predicate matches'
);

SELECT is(
  (SELECT revoked FROM auth.refresh_tokens WHERE token = 'tp393-old-unrevoked'),
  true,
  '13. the old, unrevoked row is now revoked -- this is the backlog row the ticket exists to close'
);

SELECT is(
  (SELECT revoked FROM auth.refresh_tokens WHERE token = 'tp393-fresh'),
  false,
  '14. the fresh row is untouched -- NOT what assertion 10''s age-blind count would have done'
);

SELECT is(
  (SELECT revoked FROM auth.refresh_tokens WHERE token = 'tp393-old-revoked'),
  true,
  '15. the already-revoked row is still revoked (unsurprising, but confirms the sweep does not un-revoke or otherwise touch it)'
);

SELECT is(
  (SELECT count(*)::integer FROM auth.refresh_tokens
    WHERE token IN ('tp393-fresh', 'tp393-old-revoked', 'tp393-old-unrevoked')
      AND revoked = false
      AND updated_at < now() - interval '180 days'),
  0,
  '16. after the sweep, the operator''s backlog-count query returns 0 for this fixture'
);

-- Dynamic SQL: a static cron.job reference fails to parse (42P01) without the cron schema.
DO $cron_probe$
DECLARE
  v_ok boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    v_ok := true;
  ELSE
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM cron.job
         WHERE jobname = 'refresh-token-inactivity-sweep'
           AND schedule = '17 3 * * *'
           AND active
           AND command LIKE '%revoke_stale_refresh_tokens%'
      )
    $sql$ INTO v_ok;
  END IF;

  CREATE TEMP TABLE tp393_cron_probe (ok boolean) ON COMMIT DROP;
  INSERT INTO tp393_cron_probe VALUES (v_ok);
END;
$cron_probe$;

SELECT ok(
  (SELECT ok FROM tp393_cron_probe),
  '17. the cron row exists with the expected schedule when pg_cron is installed (vacuously true on this lane, which has none)'
);

SELECT * FROM finish();
ROLLBACK;

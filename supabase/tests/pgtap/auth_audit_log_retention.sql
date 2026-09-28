-- Manual acceptance on General. Section C FAILS right after apply (negative control) and passes
-- once `SELECT public.cleanup_auth_audit_log();` has drained (repeat until 0, 0).

BEGIN;

SELECT plan(15);

SELECT has_function(
  'public', 'cleanup_auth_audit_log', ARRAY['integer'],
  'A1: public.cleanup_auth_audit_log(integer) exists on the General database'
);

SELECT is(
  (SELECT p.prosecdef
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.cleanup_auth_audit_log(integer)')),
  false,
  'A2: the prune function is SECURITY INVOKER, so it confers no capability of its own'
);

-- aclexplode(NULL proacl) returns no rows, so A3b requires an explicit ACL.
SELECT ok(
  NOT (
    has_function_privilege('anon', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.cleanup_auth_audit_log(integer)', 'EXECUTE')
  ),
  'A3: no client role (anon, authenticated, service_role) holds EXECUTE on the prune function'
);

SELECT ok(
  (SELECT p.proacl IS NOT NULL
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.cleanup_auth_audit_log(integer)')),
  'A3b: the prune function carries an explicit ACL, so A3 is not a vacuous pass against PUBLIC default privileges'
);

SELECT is(
  (SELECT has_table_privilege('service_role', 'auth.audit_log_entries', 'DELETE')),
  false,
  'A4: service_role still holds no DELETE on auth.audit_log_entries -- this migration granted it nothing'
);

SELECT is(
  (SELECT pg_get_userbyid(c.relowner)
     FROM pg_class c WHERE c.oid = 'auth.audit_log_entries'::regclass),
  'supabase_auth_admin',
  'A5: GoTrue still owns the table; its definition was not taken over'
);

SELECT is(
  (SELECT count(*)::int FROM pg_index i
    WHERE i.indrelid = 'auth.audit_log_entries'::regclass),
  2,
  'A6: the table still carries exactly its two GoTrue indexes -- no index was added for the prune'
);

-- B: the companion database is the one non-local database in cron.job, as in the migration.

SELECT is(
  (SELECT count(*)::int FROM cron.job j
    WHERE j.jobname = 'auth-audit-log-prune'
      AND j.schedule = '40 4 * * *'
      AND j.database = 'postgres'
      AND j.username = 'postgres'
      AND j.active
      AND j.command LIKE '%cleanup_auth_audit_log%'),
  1,
  'B1: the General prune job is scheduled at 04:40 as postgres and is active'
);

SELECT is(
  (SELECT count(*)::int FROM cron.job j
    WHERE j.jobname = 'eot-auth-audit-log-prune'
      AND j.schedule = '50 4 * * *'
      AND j.database = (SELECT DISTINCT database FROM cron.job WHERE database <> current_database())
      AND j.username = 'postgres'
      AND j.active
      AND j.command LIKE '%cleanup_auth_audit_log%'),
  1,
  'B2: the companion-database prune job is scheduled at 04:50 as postgres and is active'
);

SELECT is(
  (SELECT count(*)::int FROM cron.job j
    WHERE j.command LIKE '%cleanup_auth_audit_log%'),
  2,
  'B3: exactly two prune jobs exist -- a re-apply replaced rather than duplicated them'
);

SELECT isnt(
  (SELECT j.schedule FROM cron.job j WHERE j.jobname = 'auth-audit-log-prune'),
  (SELECT j.schedule FROM cron.job j WHERE j.jobname = 'eot-auth-audit-log-prune'),
  'B4: the two databases are staggered and never prune in the same minute'
);

SELECT is(
  (SELECT count(*)::int
     FROM auth.audit_log_entries a
    WHERE a.payload->>'actor_id' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id::text = a.payload->>'actor_id'
      )),
  0,
  'C1: no row is attributed to an account that no longer exists (baseline: 11,163)'
);

SELECT is(
  (SELECT count(*)::int
     FROM auth.audit_log_entries
    WHERE created_at < now() - interval '90 days'),
  0,
  'C2: no row is older than the 90-day window (baseline: 587,521)'
);

SELECT ok(
  (SELECT min(created_at) FROM auth.audit_log_entries)
    >= now() - interval '91 days',
  'C3: the oldest surviving row is inside the window plus one day of slack (baseline oldest: 2025-04-01)'
);

-- A bound, not an exact count: GoTrue keeps appending during the prune.
SELECT ok(
  (SELECT count(*) FROM auth.audit_log_entries) < 300000,
  'C4: the table is materially smaller than its 829,027-row baseline'
);

SELECT * FROM finish();

ROLLBACK;

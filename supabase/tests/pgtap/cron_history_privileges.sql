-- Exercise the history-table boundary, including when schema access exists.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SELECT plan(10);
SELECT to_regclass('cron.job_run_details') IS NULL AS no_cron_history \gset
\if :no_cron_history
SELECT is((SELECT count(*)::integer FROM supabase_migrations.schema_migrations
  WHERE version = '20261008180000'), 0,
  'absent pg_cron cannot be recorded as hardened');
SELECT * FROM skip(9, 'pg_cron is absent; the required real-extension control executes these privilege checks');
\else
SELECT is((SELECT count(*)::integer FROM supabase_migrations.schema_migrations
  WHERE version = '20261008180000' AND name = 'revoke_public_cron_history'), 1,
  'the cron history privilege migration is applied');
SELECT is_empty($$SELECT a.privilege_type FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE c.oid = 'cron.job_run_details'::regclass AND a.grantee = 0$$,
  'PUBLIC has no table privilege on history');
SELECT is_empty($$SELECT a.attname FROM pg_attribute a
  CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = 'cron.job_run_details'::regclass AND acl.grantee = 0$$,
  'PUBLIC has no column privilege on history');
SELECT ok(NOT has_table_privilege('rest_reader', 'cron.job_run_details',
  'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  'the readonly role has no effective history write privilege');
SELECT ok(has_table_privilege('analytics_ro', 'cron.job_run_details', 'SELECT'),
  'the named analytics reader keeps SELECT');
SELECT ok((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class
  WHERE oid = 'cron.job_run_details'::regclass), 'owner housekeeping retains its RLS bypass');
SELECT lives_ok('DELETE FROM cron.job_run_details WHERE false',
  'owner housekeeping can still delete history');

-- Isolate the table ACL from the separate schema ACL. These temporary
-- grants are rolled back, including when the role already has schema access.
GRANT USAGE ON SCHEMA cron, extensions TO rest_reader;
SET LOCAL ROLE rest_reader;
SELECT throws_ok('DELETE FROM cron.job_run_details WHERE false', '42501',
  'permission denied for table job_run_details', 'a reader cannot delete even with schema access');
SELECT throws_ok('SELECT runid FROM cron.job_run_details LIMIT 0', '42501',
  'permission denied for table job_run_details', 'a reader cannot read through PUBLIC');
RESET ROLE;
GRANT USAGE ON SCHEMA extensions TO analytics_ro;
SET LOCAL ROLE analytics_ro;
SELECT lives_ok('SELECT runid FROM cron.job_run_details LIMIT 0',
  'the explicit analytics read path still works');
RESET ROLE;
\endif
SELECT * FROM finish();
ROLLBACK;

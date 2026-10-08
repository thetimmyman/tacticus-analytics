-- The readonly Deployment's pre-request interface: reject write-mode
-- requests independently of routing, and preserve each existing reader role.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(9);
SELECT is((SELECT count(*)::integer FROM supabase_migrations.schema_migrations
  WHERE version = '20261008150000' AND name = 'readonly_request_transaction'), 1,
  'the readonly request migration is applied');
SELECT ok((SELECT NOT prosecdef AND provolatile = 'v'
  AND proconfig = ARRAY['search_path=pg_catalog'] FROM pg_proc
  WHERE oid = 'postgrest_readonly.pre_request()'::regprocedure),
  'the hook neither elevates the caller nor hides its transaction mode');
SELECT ok(NOT has_schema_privilege('anon', 'postgrest_readonly', 'CREATE'),
  'API callers cannot replace the request guard');
SELECT throws_ok('SELECT postgrest_readonly.pre_request()', '25006',
  'Read-only endpoint requires a read-only transaction',
  'a write transaction is rejected before its endpoint query');

SELECT set_config('request.jwt.claims', '{}', true);
GRANT USAGE ON SCHEMA extensions TO rest_reader;
SET LOCAL transaction_read_only = on;
SET LOCAL ROLE anon;
SELECT lives_ok('SELECT postgrest_readonly.pre_request()', 'anon retains read-only requests');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT lives_ok('SELECT postgrest_readonly.pre_request()', 'authenticated retains read-only requests');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok('SELECT postgrest_readonly.pre_request()', 'service_role retains read-only requests');
RESET ROLE;
SET LOCAL ROLE rest_reader;
SELECT lives_ok('SELECT postgrest_readonly.pre_request()', 'rest_reader retains read-only requests');
RESET ROLE;
SELECT throws_ok($$SELECT set_config('transaction_read_only', 'off', true)$$,
  '25001', NULL, 'a query cannot reset a checked read-only transaction to writable');
SELECT * FROM finish();
ROLLBACK;

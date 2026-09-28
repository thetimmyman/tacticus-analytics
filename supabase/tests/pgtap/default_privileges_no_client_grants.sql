-- A new table, sequence or function in public grants client roles nothing until a migration says so.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Skip only when the migration is absent; if its ledger row exists, fail.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260928210000'
) AS default_privs_not_applied \gset

\if :default_privs_not_applied
SELECT plan(13);
SELECT * FROM skip(
  13,
  'this database predates the default-privilege revoke; the replay lane applies the migration and executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(13);

-- Created as postgres, the role every migration runs as.
SET LOCAL ROLE postgres;
CREATE TABLE public.zz_default_privs_probe (id bigserial PRIMARY KEY, note text);
CREATE SEQUENCE public.zz_default_privs_probe_seq;
CREATE FUNCTION public.zz_default_privs_probe_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';
RESET ROLE;

-- analytics_ro exists only where it was provisioned; an absent role holds nothing.
CREATE FUNCTION pg_temp.table_privs(p_role text) RETURNS boolean LANGUAGE sql AS $$
  SELECT to_regrole(p_role) IS NOT NULL AND has_table_privilege(
    p_role, 'public.zz_default_privs_probe',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
$$;
CREATE FUNCTION pg_temp.sequence_privs(p_role text) RETURNS boolean LANGUAGE sql AS $$
  SELECT to_regrole(p_role) IS NOT NULL AND (
    has_sequence_privilege(p_role, 'public.zz_default_privs_probe_seq', 'USAGE, SELECT, UPDATE')
    OR has_sequence_privilege(p_role, 'public.zz_default_privs_probe_id_seq', 'USAGE, SELECT, UPDATE'))
$$;
CREATE FUNCTION pg_temp.function_privs(p_role text) RETURNS boolean LANGUAGE sql AS $$
  SELECT to_regrole(p_role) IS NOT NULL
    AND has_function_privilege(p_role, 'public.zz_default_privs_probe_fn()', 'EXECUTE')
$$;

SELECT ok(NOT pg_temp.table_privs('anon'), 'anon holds no privilege on a new public table');
SELECT ok(NOT pg_temp.table_privs('authenticated'), 'authenticated holds no privilege on a new public table');
SELECT ok(NOT pg_temp.table_privs('analytics_ro'), 'analytics_ro holds no privilege on a new public table');

SELECT ok(NOT pg_temp.sequence_privs('anon'), 'anon holds no privilege on a new public sequence');
SELECT ok(NOT pg_temp.sequence_privs('authenticated'), 'authenticated holds no privilege on a new public sequence');
SELECT ok(NOT pg_temp.sequence_privs('analytics_ro'), 'analytics_ro holds no privilege on a new public sequence');

SELECT ok(NOT pg_temp.function_privs('anon'), 'anon cannot execute a new public function (PUBLIC included)');
SELECT ok(NOT pg_temp.function_privs('authenticated'), 'authenticated cannot execute a new public function');
SELECT ok(NOT pg_temp.function_privs('analytics_ro'), 'analytics_ro cannot execute a new public function');

SELECT ok(
  has_table_privilege('service_role', 'public.zz_default_privs_probe', 'SELECT, INSERT, UPDATE, DELETE'),
  'service_role keeps its default table privileges'
);
SELECT ok(
  has_sequence_privilege('service_role', 'public.zz_default_privs_probe_seq', 'USAGE'),
  'service_role keeps its default sequence privileges'
);
SELECT ok(
  has_function_privilege('service_role', 'public.zz_default_privs_probe_fn()', 'EXECUTE'),
  'service_role keeps its default function EXECUTE'
);

SELECT is_empty(
  $$
  SELECT pg_get_userbyid(d.defaclrole), d.defaclnamespace::regnamespace::text, d.defaclobjtype, a.grantee
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE (n.nspname IN ('public', 'graphql_public') OR d.defaclnamespace = 0)
     AND (a.grantee = 0 OR a.grantee IN (
       SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'analytics_ro')))
  $$,
  'no default-privilege rule in an exposed schema grants PUBLIC or a client role anything'
);

SELECT * FROM finish();
ROLLBACK;
\endif

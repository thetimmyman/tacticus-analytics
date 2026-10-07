-- rest_reader: SELECT-only role for read-only tooling, used through a read-only
-- PostgREST with a short-lived JWT (role claim rest_reader). anon reads only the
-- public subset; authenticated and service_role hold writes, and service_role
-- also reads guild_config.client_secret and the encrypted API key columns.
-- target-db: general

-- Grants: the public columns service_role can SELECT, minus credential columns
-- (CREDENTIAL pattern; counts, flags and timestamps are never withheld). A
-- relation with a withheld column gets column-level SELECT, so name columns.
-- BYPASSRLS with no write privilege anywhere. A snapshot: later relations and
-- columns stay invisible until a migration grants them (fail closed).

-- Rollback: DROP FUNCTION public.rest_reader_whoami(); REVOKE ALL in schema
-- public FROM rest_reader; REVOKE rest_reader FROM authenticator; DROP OWNED BY
-- rest_reader; DROP ROLE rest_reader; delete the ledger row. Re-runnable.

BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

DO $ledger_guard$ BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261007210000'
      AND name IS DISTINCT FROM 'rest_reader_role'
  ) THEN
    RAISE EXCEPTION 'Migration version 20261007210000 belongs to another migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'service_role must exist: the reader mirrors its SELECT surface';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    RAISE EXCEPTION 'authenticator must exist: PostgREST switches into the reader from it';
  END IF;
END $ledger_guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $role$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rest_reader') THEN
    CREATE ROLE rest_reader NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $role$;
ALTER ROLE rest_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
ALTER ROLE rest_reader SET statement_timeout = '15s';
-- NOLOGIN: PostgREST switches into it from authenticator; there is no
-- password to hold or to leak.
GRANT rest_reader TO authenticator;

GRANT USAGE ON SCHEMA public TO rest_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rest_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM rest_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM rest_reader;

DO $grants$
DECLARE
  credential constant text :=
    '(secret|passw|encrypted|webhook_url|private_object_key|private_key|_token$|^token$|session_id$|api_key$|jwt|bearer|credential$|dsn$)';
  credential_exempt constant text := '(_at|_by|_hash)$';
  -- Counts, flags and timestamps cannot carry a credential.
  plain_types constant regtype[] := ARRAY['boolean', 'smallint', 'integer', 'bigint', 'numeric', 'real',
    'double precision', 'date', 'timestamp without time zone', 'timestamp with time zone']::regtype[];
  rel record;
  readable text[];
BEGIN
  FOR rel IN
    SELECT c.oid, c.relname,
           (SELECT count(*) FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS ncols
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY c.relname
  LOOP
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO readable
    FROM pg_attribute a
    WHERE a.attrelid = rel.oid AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege('service_role', rel.oid, a.attnum, 'SELECT')
      AND NOT (a.attname ~* credential AND a.attname !~* credential_exempt
               AND a.atttypid::regtype <> ALL (plain_types));
    CONTINUE WHEN readable IS NULL;
    IF cardinality(readable) = rel.ncols
       AND has_table_privilege('service_role', rel.oid, 'SELECT') THEN
      EXECUTE format('GRANT SELECT ON public.%I TO rest_reader', rel.relname);
    ELSE
      EXECUTE format('GRANT SELECT (%s) ON public.%I TO rest_reader',
                     (SELECT string_agg(quote_ident(col), ', ') FROM unnest(readable) AS col),
                     rel.relname);
    END IF;
  END LOOP;
END $grants$;

-- The identity probe. It must answer only for the reader: a token
-- PostgREST reads as anon (a JWT whose role claim it does not recognise) gets
-- a permission error instead of an anonymous-looking success.
CREATE OR REPLACE FUNCTION public.rest_reader_whoami()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT jsonb_build_object(
    'role', current_user::text,
    'db', current_database()::text,
    'in_recovery', pg_is_in_recovery(),
    'is_superuser', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
    'writable_exposed_relations', (
      SELECT count(*)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'graphql_public')
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
             OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE')))
  )
$fn$;
COMMENT ON FUNCTION public.rest_reader_whoami() IS
  'Identity probe for rest_reader. Executable by that role only.';

-- Default privileges hand new public functions to the service roles; take
-- EXECUTE back from everyone but the reader.
DO $whoami_acl$
DECLARE grantee text;
BEGIN
  REVOKE ALL ON FUNCTION public.rest_reader_whoami() FROM PUBLIC;
  FOR grantee IN
    SELECT DISTINCT r.rolname
    FROM pg_proc p, aclexplode(p.proacl) x
    JOIN pg_roles r ON r.oid = x.grantee
    WHERE p.oid = 'public.rest_reader_whoami()'::regprocedure
      AND x.grantee <> p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.rest_reader_whoami() FROM %I', grantee);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.rest_reader_whoami() TO rest_reader;
END $whoami_acl$;

-- The read-only PostgREST runs this pre-request hook as the request role
-- before every request, so the reader needs EXECUTE or every read fails. It is
-- SECURITY DEFINER, STABLE, and returns at once for any role but authenticated.
DO $pre_request$ BEGIN
  IF to_regprocedure('public.enforce_request_user_ban()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.enforce_request_user_ban() TO rest_reader;
  END IF;
END $pre_request$;

-- Verify before committing: no write privilege, no credential column, and the
-- probe closed to every other API role.
DO $verify$
DECLARE
  n bigint;
  leaked text;
BEGIN
  SELECT count(*) INTO n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public', 'graphql_public') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege('rest_reader', c.oid, 'INSERT')
         OR has_table_privilege('rest_reader', c.oid, 'UPDATE')
         OR has_table_privilege('rest_reader', c.oid, 'DELETE')
         OR has_table_privilege('rest_reader', c.oid, 'TRUNCATE'));
  IF n <> 0 THEN
    RAISE EXCEPTION 'rest_reader can write % exposed relations', n;
  END IF;

  SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO leaked
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE ns.nspname = 'public'
    AND a.attname ~* '(secret|passw|encrypted|webhook_url|private_object_key|private_key|_token$|^token$|session_id$|api_key$|jwt|bearer|credential$|dsn$)'
    AND a.attname !~* '(_at|_by|_hash)$'
    AND a.atttypid::regtype <> ALL (ARRAY['boolean', 'smallint', 'integer', 'bigint', 'numeric', 'real',
      'double precision', 'date', 'timestamp without time zone', 'timestamp with time zone']::regtype[])
    AND has_column_privilege('rest_reader', c.oid, a.attnum, 'SELECT');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'rest_reader can read credential columns: %', leaked;
  END IF;

  IF to_regclass('public.guild_config') IS NOT NULL
     AND has_column_privilege('rest_reader', 'public.guild_config'::regclass, 'client_secret', 'SELECT') THEN
    RAISE EXCEPTION 'rest_reader can read guild_config.client_secret';
  END IF;

  IF has_function_privilege('anon', 'public.rest_reader_whoami()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rest_reader_whoami()', 'EXECUTE') THEN
    RAISE EXCEPTION 'rest_reader_whoami() is executable by an API role other than the reader';
  END IF;

  IF to_regprocedure('public.enforce_request_user_ban()') IS NOT NULL
     AND NOT has_function_privilege('rest_reader', 'public.enforce_request_user_ban()', 'EXECUTE') THEN
    RAISE EXCEPTION 'rest_reader cannot run the PostgREST pre-request hook';
  END IF;
END $verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261007210000', 'rest_reader_role')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;

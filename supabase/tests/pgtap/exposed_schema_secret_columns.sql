BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(5);

-- Schemas PostgREST serves; must equal [api].schemas in supabase/config.toml (a unit test pins it).
-- A table there with RLS off is readable row-for-row by any client role holding SELECT, and new
-- tables inherit client SELECT through default privileges, so an ad-hoc copy is exposed at once.
CREATE TEMP VIEW exposed_rls_off_tables AS
SELECT n.nspname AS schema_name, c.relname AS relation_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'graphql_public')
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
  AND (has_table_privilege('anon', c.oid, 'SELECT')
    OR has_table_privilege('authenticated', c.oid, 'SELECT'));

-- Credential-shaped columns must never be client-readable, whatever RLS says about the rows.
CREATE TEMP VIEW exposed_secret_columns AS
SELECT n.nspname AS schema_name, c.relname AS relation_name, a.attname AS column_name, r.rolname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
WHERE n.nspname IN ('public', 'graphql_public')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attname ~* '(^|_)(client_secret|secret|secret_key|password|passwd|api_key|apikey|private_key|access_token|refresh_token|id_token|bearer_token|session_id|session_token|signing_key)$|_(encrypted|ciphertext)$'
  AND has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT')
  -- Allowlisted: the view projects a constant NULL under this name (asserted below).
  AND (n.nspname, c.relname, a.attname) <> ('public', 'player_with_cluster', 'tacticus_api_key_encrypted');

SELECT is_empty(
  'SELECT schema_name, relation_name FROM exposed_rls_off_tables',
  'every client-readable table in a PostgREST-exposed schema has RLS enabled'
);

SELECT is_empty(
  'SELECT schema_name, relation_name, column_name, rolname FROM exposed_secret_columns',
  'no credential-shaped column in a PostgREST-exposed schema is readable by anon or authenticated'
);

SELECT ok(
  to_regclass('public.player_with_cluster') IS NULL
    OR pg_get_viewdef('public.player_with_cluster'::regclass) ~ 'NULL::text AS tacticus_api_key_encrypted',
  'the allowlisted player_with_cluster column is still a constant NULL'
);

-- Canary: a table shaped like an ad-hoc credential backup must trip both checks.
CREATE TABLE public.zz_census_canary (owner_ref text, client_secret text);
GRANT SELECT ON public.zz_census_canary TO authenticated;

SELECT ok(
  EXISTS (SELECT 1 FROM exposed_rls_off_tables WHERE relation_name = 'zz_census_canary'),
  'canary: an RLS-off client-readable table is detected'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM exposed_secret_columns
    WHERE relation_name = 'zz_census_canary' AND column_name = 'client_secret' AND rolname = 'authenticated'
  ),
  'canary: a client-readable client_secret column is detected'
);

SELECT * FROM finish();
ROLLBACK;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(8);

-- Schemas PostgREST serves; must equal [api].schemas in supabase/config.toml (a unit test pins it).
-- A table there with RLS off is readable row-for-row by any client role holding SELECT on the table
-- or on any column, so any explicit client grant on such a table must come with RLS on.
CREATE TEMP VIEW exposed_rls_off_tables AS
SELECT n.nspname AS schema_name, c.relname AS relation_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'graphql_public')
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
  AND (has_table_privilege('anon', c.oid, 'SELECT')
    OR has_table_privilege('authenticated', c.oid, 'SELECT')
    OR has_any_column_privilege('anon', c.oid, 'SELECT')
    OR has_any_column_privilege('authenticated', c.oid, 'SELECT'));

-- Credential-shaped columns must never be client-readable, whatever RLS says about the rows.
CREATE TEMP VIEW exposed_secret_columns AS
SELECT n.nspname AS schema_name, c.relname AS relation_name, a.attname AS column_name, r.rolname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
WHERE n.nspname IN ('public', 'graphql_public')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attname ~* '(^|_)(client_secret|secret|secret_key|password|passwd|api_key|apikey|private_key|access_token|refresh_token|id_token|bearer_token|session_id|session_token|signing_key|webhook_url)$|_(encrypted|ciphertext)$'
  AND has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT')
  -- Excluded only while the view still projects a constant NULL under this name (both branches below).
  AND NOT ((n.nspname, c.relname, a.attname) = ('public', 'player_with_cluster', 'tacticus_api_key_encrypted')
    AND CASE WHEN c.relkind = 'v' THEN pg_get_viewdef(c.oid) ~ '\sNULL::text AS tacticus_api_key_encrypted,' ELSE false END);

SELECT is_empty(
  'SELECT schema_name, relation_name FROM exposed_rls_off_tables',
  'every client-readable table in a PostgREST-exposed schema has RLS enabled'
);

SELECT is_empty(
  'SELECT schema_name, relation_name, column_name, rolname FROM exposed_secret_columns',
  'no credential-shaped column in a PostgREST-exposed schema is readable by anon or authenticated'
);

-- Canary: a table shaped like an ad-hoc credential backup must trip both checks. SELECT is granted
-- explicitly because new public tables carry no client grants by default.
CREATE TABLE public.zz_census_canary (owner_ref text, client_secret text, discord_webhook_url text);
GRANT SELECT ON public.zz_census_canary TO authenticated;

-- has_table_privilege is false under a column-only grant, yet PostgREST serves those columns.
CREATE TABLE public.zz_census_canary_cols (owner_ref text, note text);
GRANT SELECT (note) ON public.zz_census_canary_cols TO authenticated;

SELECT ok(
  EXISTS (SELECT 1 FROM exposed_rls_off_tables WHERE relation_name = 'zz_census_canary'),
  'canary: an RLS-off client-readable table is detected'
);

SELECT ok(
  EXISTS (SELECT 1 FROM exposed_rls_off_tables WHERE relation_name = 'zz_census_canary_cols'),
  'canary: an RLS-off table readable through a column-only grant is detected'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM exposed_secret_columns
    WHERE relation_name = 'zz_census_canary' AND column_name = 'client_secret' AND rolname = 'authenticated'
  ),
  'canary: a client-readable client_secret column is detected'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM exposed_secret_columns
    WHERE relation_name = 'zz_census_canary' AND column_name = 'discord_webhook_url' AND rolname = 'authenticated'
  ),
  'canary: a client-readable webhook URL column is detected'
);

-- Both branches of the player_with_cluster exclusion, on a stand-in when the lane lacks the view.
DO $pwc$
BEGIN
  IF to_regclass('public.player_with_cluster') IS NULL THEN
    CREATE VIEW public.player_with_cluster AS SELECT NULL::text AS tacticus_api_key_encrypted, 1 AS pad;
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.player_with_cluster', 'tacticus_api_key_encrypted', 'SELECT') THEN
    GRANT SELECT ON public.player_with_cluster TO authenticated;
  END IF;
END
$pwc$;

SELECT ok(
  pg_get_viewdef('public.player_with_cluster'::regclass) ~ '\sNULL::text AS tacticus_api_key_encrypted,'
    AND NOT EXISTS (SELECT 1 FROM exposed_secret_columns WHERE relation_name = 'player_with_cluster'),
  'player_with_cluster.tacticus_api_key_encrypted is excluded while the view projects a constant NULL'
);

DO $pwc_leak$
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW public.player_with_cluster AS '
    || replace(pg_get_viewdef('public.player_with_cluster'::regclass),
               'NULL::text AS tacticus_api_key_encrypted,', '''leak''::text AS tacticus_api_key_encrypted,');
END
$pwc_leak$;

SELECT ok(
  EXISTS (
    SELECT 1 FROM exposed_secret_columns
    WHERE relation_name = 'player_with_cluster' AND column_name = 'tacticus_api_key_encrypted'
      AND rolname = 'authenticated'
  ),
  'player_with_cluster.tacticus_api_key_encrypted is reported once the view projects a real value'
);

SELECT * FROM finish();
ROLLBACK;

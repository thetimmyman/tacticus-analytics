-- Read-only census of the PostgREST-exposed schemas on a live database; zero rows is a pass.
-- Same predicates as supabase/tests/pgtap/exposed_schema_secret_columns.sql (a unit test pins them),
-- run live because tables created outside migrations never reach the replay lane.
SET default_transaction_read_only = on;
BEGIN READ ONLY;

SELECT 'rls_off_client_readable' AS finding, n.nspname AS schema_name, c.relname AS relation_name,
       NULL::name AS column_name, NULL::text AS rolname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'graphql_public')
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
  AND (has_table_privilege('anon', c.oid, 'SELECT')
    OR has_table_privilege('authenticated', c.oid, 'SELECT')
    OR has_any_column_privilege('anon', c.oid, 'SELECT')
    OR has_any_column_privilege('authenticated', c.oid, 'SELECT'))
UNION ALL
SELECT 'client_readable_secret_column', n.nspname, c.relname, a.attname, r.rolname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
WHERE n.nspname IN ('public', 'graphql_public')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attname ~* '(^|_)(client_secret|secret|secret_key|password|passwd|api_key|apikey|private_key|access_token|refresh_token|id_token|bearer_token|session_id|session_token|signing_key|webhook_url)$|_(encrypted|ciphertext)$'
  AND has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT')
  -- Excluded only while the live view still projects a constant NULL under this name.
  AND NOT ((n.nspname, c.relname, a.attname) = ('public', 'player_with_cluster', 'tacticus_api_key_encrypted')
    AND CASE WHEN c.relkind = 'v' THEN pg_get_viewdef(c.oid) ~ '\sNULL::text AS tacticus_api_key_encrypted,' ELSE false END)
ORDER BY 1, 2, 3, 4, 5;

COMMIT;

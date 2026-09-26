-- cluster_applications is live-only, so the migration is a no-op here; its guards are checked by
-- scripts/dev/check-ps399-idempotency-guards.sh.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Read-only scratch copy of the migration; never \i.
SELECT coalesce(
         (
           SELECT '/' || entry || '/mig/' || file_name
           FROM pg_catalog.pg_ls_dir('/') AS entry,
                LATERAL (
                  SELECT '20260908012000_ps399_drop_cluster_applications_plaintext_api_key_columns.sql'
                ) AS f(file_name)
           WHERE entry LIKE 'pgtap-%'
             AND (
                   pg_catalog.pg_stat_file('/' || entry || '/mig/' || file_name, true)
                 ).size IS NOT NULL
           LIMIT 1
         ),
         '/dev/null'
       ) AS ps399_migration \gset

SELECT plan(10);

SELECT isnt(
  :'ps399_migration'::text,
  '/dev/null'::text,
  'the PS-399 migration file was found in the throwaway container'
);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260908012000'
      AND name = 'ps399_drop_cluster_applications_plaintext_api_key_columns'),
  1,
  'the PS-399 migration is recorded exactly once in the ledger by the harness (applied as a no-op here: cluster_applications does not exist in this repository)'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name ~ '_api_key$'
      AND c.column_name !~ '_encrypted$'
  ),
  0,
  'no public BASE TABLE has a bare plaintext *_api_key column'
);


SELECT * FROM skip(
  7,
  'cannot check the migration''s idempotency guards or exercise its drop from inside this suite: reading the file needs pg_read_file, which the PS-371 pgTAP shim refuses by name (DANGEROUS_FUNCS), and re-applying it against a suite-built fixture needs \i, which the same shim refuses by name for this file; both are verified out of band -- the guards statically, on every PR, by scripts/dev/check-ps399-idempotency-guards.sh (test:pgtap:controls control 5), the drop live per the migration header'
);

SELECT * FROM finish();

ROLLBACK;

BEGIN;
SET search_path TO extensions, public, pg_catalog;
SELECT plan(9);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260919180000'
      AND name = 'ps392_storage_prefixes_grants'
  ),
  'the storage prefixes grants migration applies against the replayed Storage prefixes pre-state'
);

SELECT ok(to_regclass('storage.prefixes') IS NOT NULL, 'storage.prefixes exists');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'storage.prefixes'::regclass
      AND conname = 'prefixes_bucketid_fkey'
      AND confrelid = 'storage.buckets'::regclass
  ),
  'prefixes.bucket_id references storage.buckets'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'storage.prefixes'::regclass
      AND attname = 'level'
      AND attgenerated = 's'
  ),
  'prefix level is a stored generated column'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_collation c ON c.oid = a.attcollation
    WHERE a.attrelid = 'storage.prefixes'::regclass
      AND a.attname = 'name'
      AND c.collname = 'C'
  ),
  'prefix name uses C collation'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.prefixes'::regclass),
  'prefixes has its Storage RLS setting enabled'
);

SELECT ok(
  NOT has_table_privilege('anon', 'storage.prefixes', 'SELECT'),
  'anon SELECT is revoked'
);

SELECT ok(
  has_table_privilege('authenticated', 'storage.prefixes', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'storage.prefixes', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'storage.prefixes', 'DELETE'),
  'authenticated retains SELECT only among the migration''s targeted privileges'
);

SELECT ok(
  has_table_privilege('service_role', 'storage.prefixes', 'SELECT'),
  'service_role SELECT remains available'
);

SELECT * FROM finish();
ROLLBACK;

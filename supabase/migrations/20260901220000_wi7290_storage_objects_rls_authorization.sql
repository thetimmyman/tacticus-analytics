-- Enable RLS on storage.objects and revoke client writes: no user-token write path exists.
-- target-db: general
-- Public buckets stay readable; service_role keeps full access.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'WI-7290 General migration requires database postgres, got %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Reviewed policies precede the census drop (keep-list) and ENABLE (no policy gap).

DROP POLICY IF EXISTS storage_objects_public_bucket_read ON storage.objects;
CREATE POLICY storage_objects_public_bucket_read ON storage.objects
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM storage.buckets AS b
      WHERE b.id = objects.bucket_id
        AND b.public
    )
  );
COMMENT ON POLICY storage_objects_public_bucket_read ON storage.objects IS
  'WI-7290: any role that can query the table may read objects in buckets marked public — keeps the public asset buckets readable once RLS is enabled.';

DROP POLICY IF EXISTS storage_objects_service_writes ON storage.objects;
CREATE POLICY storage_objects_service_writes ON storage.objects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
COMMENT ON POLICY storage_objects_service_writes ON storage.objects IS
  'WI-7290: the service tier is the only storage write corridor this application has (census in the migration header).';

-- The public-read subquery runs as the caller, so it needs SELECT on storage.buckets.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;

-- No authenticated write corridor exists: client tiers lose INSERT/UPDATE/DELETE.
REVOKE INSERT, UPDATE, DELETE ON storage.objects FROM PUBLIC, anon, authenticated;

-- Drop write-capable policies outside the keep-list, with a NOTICE per drop as audit trail.
DO $census$
DECLARE
  keep_list constant text[] := ARRAY[
    -- WI-7290 (this migration)
    'storage_objects_service_writes'
  ];
  pol record;
  dropped integer := 0;
BEGIN
  FOR pol IN
    SELECT p.polname,
           CASE p.polcmd
             WHEN 'a' THEN 'INSERT'
             WHEN 'w' THEN 'UPDATE'
             WHEN 'd' THEN 'DELETE'
             WHEN '*' THEN 'ALL'
           END AS cmd
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = 'storage.objects'::regclass
      AND p.polcmd IN ('a', 'w', 'd', '*')
      AND NOT (p.polname = ANY (keep_list))
    ORDER BY p.polname
  LOOP
    RAISE NOTICE 'WI-7290: dropping unreviewed write policy % (FOR %) on storage.objects',
      pol.polname, pol.cmd;
    EXECUTE format('DROP POLICY %I ON storage.objects', pol.polname);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'WI-7290: dropped % unreviewed write polic%', dropped,
    CASE WHEN dropped = 1 THEN 'y' ELSE 'ies' END;
END;
$census$;

-- ENABLE, not FORCE: the owner/maintenance path stays unbound.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Abort unless the over-grant is gone and the service path is intact.
DO $verify$
DECLARE
  rls_on boolean;
  rls_forced boolean;
  stray_writes text;
  missing text;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO rls_on, rls_forced
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = 'storage.objects'::regclass;

  IF rls_on IS DISTINCT FROM true OR rls_forced IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WI-7290 post-condition failed: storage.objects relrowsecurity=% relforcerowsecurity=% (want true/false)',
      rls_on, rls_forced;
  END IF;

  SELECT string_agg(p.polname, ', ')
    INTO stray_writes
    FROM pg_catalog.pg_policy AS p
   WHERE p.polrelid = 'storage.objects'::regclass
     AND p.polcmd IN ('a', 'w', 'd', '*')
     AND p.polname <> 'storage_objects_service_writes';
  IF stray_writes IS NOT NULL THEN
    RAISE EXCEPTION
      'WI-7290 post-condition failed: unreviewed write policies survive on storage.objects: %',
      stray_writes;
  END IF;

  SELECT string_agg(need.polname, ', ')
    INTO missing
    FROM unnest(ARRAY[
      'storage_objects_service_writes',
      'storage_objects_public_bucket_read'
    ]) AS need(polname)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_policy AS p
      WHERE p.polrelid = 'storage.objects'::regclass
        AND p.polname = need.polname
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'WI-7290 post-condition failed: expected policies missing on storage.objects: %',
      missing;
  END IF;

  -- Direction 1: the over-grant is gone.
  IF has_table_privilege('authenticated', 'storage.objects', 'INSERT')
     OR has_table_privilege('authenticated', 'storage.objects', 'UPDATE')
     OR has_table_privilege('authenticated', 'storage.objects', 'DELETE')
     OR has_table_privilege('anon', 'storage.objects', 'INSERT')
     OR has_table_privilege('anon', 'storage.objects', 'UPDATE')
     OR has_table_privilege('anon', 'storage.objects', 'DELETE') THEN
    RAISE EXCEPTION
      'WI-7290 post-condition failed: authenticated or anon still holds a write privilege on storage.objects';
  END IF;

  -- Direction 2: the service corridor stays grant-backed (RLS gates rows,
  -- the grant gates the verb).
  IF NOT (
       has_table_privilege('service_role', 'storage.objects', 'SELECT')
   AND has_table_privilege('service_role', 'storage.objects', 'INSERT')
   AND has_table_privilege('service_role', 'storage.objects', 'UPDATE')
   AND has_table_privilege('service_role', 'storage.objects', 'DELETE')
   AND has_table_privilege('service_role', 'storage.buckets', 'SELECT')
  ) THEN
    RAISE EXCEPTION
      'WI-7290 post-condition failed: the service tier lost part of its storage grant surface';
  END IF;

  RAISE NOTICE 'WI-7290: storage.objects RLS enabled, write surface reduced to the service tier';
END;
$verify$;

COMMIT;

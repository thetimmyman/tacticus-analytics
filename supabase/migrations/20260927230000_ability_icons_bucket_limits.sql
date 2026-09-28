-- Cap the public ability-icons bucket at 5 MiB of image/png: it only holds
-- small PNG icons, and a public bucket with no limits accepts any type or size.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ability-icons bucket limits (general) requires postgres, got %', current_database();
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Serialise the preflight with concurrent uploads (which hold ROW EXCLUSIVE on
-- storage.objects) until the cap commits, so nothing slips past the census.
DO $preflight$
DECLARE
  v_violations bigint;
BEGIN
  LOCK TABLE storage.objects IN SHARE MODE;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ability-icons') THEN
    RAISE EXCEPTION 'storage.buckets has no ability-icons bucket; nothing to cap';
  END IF;

  -- CASE is ordered, unlike OR across sibling predicates: a non-numeric size is
  -- reported as a violation instead of aborting the bigint cast.
  SELECT count(*)
    INTO v_violations
    FROM storage.objects
   WHERE bucket_id = 'ability-icons'
     AND (
       metadata->>'mimetype' IS DISTINCT FROM 'image/png'
       OR CASE
            WHEN metadata->>'size' IS NULL THEN TRUE
            WHEN metadata->>'size' !~ '^[0-9]+$' THEN TRUE
            ELSE (metadata->>'size')::bigint > 5242880
          END
     );

  IF v_violations > 0 THEN
    RAISE EXCEPTION
      'ability-icons holds % object(s) that are not an image/png of at most 5242880 bytes; refusing to cap the bucket',
      v_violations;
  END IF;
END
$preflight$;

UPDATE storage.buckets
   SET file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/png']::text[]
 WHERE id = 'ability-icons';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM storage.buckets
     WHERE id = 'ability-icons'
       AND file_size_limit = 5242880
       AND allowed_mime_types = ARRAY['image/png']::text[]
  ) THEN
    RAISE EXCEPTION 'ability-icons bucket limits did not apply as written';
  END IF;
END
$verify$;

COMMIT;

-- Revoke anon SELECT and authenticated INSERT/DELETE on storage.prefixes, matching
-- storage.objects. Grants only.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'PS-392 requires database postgres, got %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Fail if the table is gone or the grants changed since measured.
DO $pre$
BEGIN
  IF to_regclass('storage.prefixes') IS NULL THEN
    RAISE EXCEPTION
      'PS-392: storage.prefixes is absent; this migration would silently no-op';
  END IF;

  IF NOT (
       has_table_privilege('anon', 'storage.prefixes', 'SELECT')
    OR has_table_privilege('authenticated', 'storage.prefixes', 'INSERT')
    OR has_table_privilege('authenticated', 'storage.prefixes', 'DELETE')
  ) THEN
    RAISE EXCEPTION
      'PS-392: anon/authenticated already hold none of the targeted privileges on storage.prefixes; nothing to revoke, and a no-op receipt is worse than no receipt';
  END IF;
END;
$pre$;

REVOKE INSERT, DELETE ON storage.prefixes FROM authenticated;
REVOKE SELECT ON storage.prefixes FROM anon;

COMMENT ON TABLE storage.prefixes IS
  'PS-392 (2026-09-19): anon holds no privilege; authenticated holds SELECT '
  'only (INSERT/DELETE revoked). This mirrors WI-7290''s reviewed choice on '
  'the sibling storage.objects over-grant -- authenticated SELECT stays '
  '(same rationale: WI-7290 kept it on storage.objects and no read path '
  'here needs prefixes narrower), anon SELECT does not (unlike '
  'storage.objects, no public-bucket read policy or application read path '
  'needs prefixes readable by a logged-out key). Grants only -- RLS on '
  'storage.prefixes is untouched, out of scope for this fix. Rollback: '
  'GRANT INSERT, DELETE ON storage.prefixes TO authenticated; GRANT SELECT '
  'ON storage.prefixes TO anon;';

-- Both directions: the revoked privileges are gone and authenticated SELECT stays.
DO $verify$
BEGIN
  IF has_table_privilege('anon', 'storage.prefixes', 'SELECT') THEN
    RAISE EXCEPTION 'PS-392: anon still holds SELECT on storage.prefixes';
  END IF;

  IF has_table_privilege('authenticated', 'storage.prefixes', 'INSERT') THEN
    RAISE EXCEPTION 'PS-392: authenticated still holds INSERT on storage.prefixes';
  END IF;

  IF has_table_privilege('authenticated', 'storage.prefixes', 'DELETE') THEN
    RAISE EXCEPTION 'PS-392: authenticated still holds DELETE on storage.prefixes';
  END IF;

  IF NOT has_table_privilege('authenticated', 'storage.prefixes', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-392: authenticated LOST SELECT on storage.prefixes; this migration is scoped to INSERT/DELETE plus the anon SELECT revoke only';
  END IF;

  IF NOT has_table_privilege('service_role', 'storage.prefixes', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-392: service_role LOST SELECT on storage.prefixes; this migration never touches service_role grants';
  END IF;
END;
$verify$;

COMMIT;

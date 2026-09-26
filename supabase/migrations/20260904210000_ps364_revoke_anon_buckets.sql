-- Revoke anon SELECT on public.buckets, which lists every storage bucket.
-- authenticated keeps SELECT: revoking it was not approved, so that gap is known.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'PS-364 requires database postgres, got %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('public.buckets') IS NULL THEN
    RAISE EXCEPTION
      'PS-364: public.buckets is absent; this migration would silently no-op';
  END IF;
  IF NOT has_table_privilege('anon', 'public.buckets', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-364: anon already lacks SELECT on public.buckets; nothing to revoke, and a no-op receipt is worse than no receipt';
  END IF;
END;
$pre$;

REVOKE SELECT ON public.buckets FROM anon;

COMMENT ON VIEW public.buckets IS
  'PS-364 (2026-09-06): anon holds no SELECT. This view over storage.buckets '
  'exposes the whole bucket inventory (id, name, owner, public, file_size_limit, '
  'allowed_mime_types) and was readable with the published anon key -- measured '
  'from the internet at 200/11 rows, with a same-run positive control returning '
  '200 [] on audit_logs to prove the key was live. Zero readers in the '
  'application, the catalogue or cron; the one storage caller (gdpr-manager '
  'createSecureDownload) uses the Storage API under service_role. authenticated '
  'still holds SELECT and closing that is NOT covered here -- the logged-out '
  'class is the whole scope. Rollback: GRANT SELECT ON public.buckets TO anon.';

-- Both directions: anon lost SELECT, and no other role lost anything.
DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.buckets', 'SELECT') THEN
    RAISE EXCEPTION 'PS-364: anon still holds SELECT on public.buckets';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.buckets', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-364: authenticated LOST SELECT on public.buckets; this migration is scoped to anon only';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.buckets', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-364: service_role LOST SELECT on public.buckets; this migration is scoped to anon only';
  END IF;

  IF NOT has_table_privilege('analytics_ro', 'public.buckets', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-364: analytics_ro LOST SELECT on public.buckets; this migration is scoped to anon only';
  END IF;
END;
$verify$;

COMMIT;

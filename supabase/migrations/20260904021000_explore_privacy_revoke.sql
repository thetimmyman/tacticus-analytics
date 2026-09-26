-- Explore privacy part B: revoke client base-table SELECT; apply after the app reads the view.
-- target-db: general
-- The owner-run view needs no PUBLIC policy; keeping one reopens the leak on a stray re-grant.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- Refuse to run before part A: revoking without the view takes /explore down.
DO $precondition$
BEGIN
  IF to_regclass('public.public_guild_snapshots') IS NULL THEN
    RAISE EXCEPTION
      'PS-20 part B: base table public.public_guild_snapshots does not exist; refusing to run';
  END IF;

  IF to_regclass('public.public_guild_snapshots_explore') IS NULL THEN
    RAISE EXCEPTION
      'PS-20 part B: view public.public_guild_snapshots_explore does not exist -- apply 20260904020000_explore_privacy_view.sql first and roll the app image before running this';
  END IF;

  IF NOT has_table_privilege('anon', 'public.public_guild_snapshots_explore', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 part B: anon cannot SELECT public.public_guild_snapshots_explore; refusing to revoke its only remaining read';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'public_guild_snapshots'
       AND policyname = 'ps20_service_role_read'
  ) THEN
    RAISE EXCEPTION
      'PS-20 part B: policy ps20_service_role_read is missing; dropping the PUBLIC policy now would leave service_role depending on BYPASSRLS';
  END IF;
END;
$precondition$;

REVOKE SELECT ON public.public_guild_snapshots FROM anon;
REVOKE SELECT ON public.public_guild_snapshots FROM authenticated;

DROP POLICY IF EXISTS "Public read access" ON public.public_guild_snapshots;

-- Raises before part B; asserts the base table exists so it cannot pass vacuously.

DO $verifyb$
DECLARE
  v_rel oid;
  v_public_policies integer;
BEGIN
  v_rel := to_regclass('public.public_guild_snapshots');
  IF v_rel IS NULL THEN
    RAISE EXCEPTION
      'PS-20 verify B: base table public.public_guild_snapshots does not exist; this verification would otherwise pass vacuously';
  END IF;

  IF to_regclass('public.public_guild_snapshots_explore') IS NULL THEN
    RAISE EXCEPTION
      'PS-20 verify B: view public.public_guild_snapshots_explore is missing';
  END IF;

  IF has_table_privilege('anon', v_rel, 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 verify B: anon still holds SELECT on public.public_guild_snapshots';
  END IF;

  IF has_table_privilege('authenticated', v_rel, 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 verify B: authenticated still holds SELECT on public.public_guild_snapshots';
  END IF;

  IF NOT has_table_privilege('anon', 'public.public_guild_snapshots_explore', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 verify B: anon cannot SELECT the replacement view public.public_guild_snapshots_explore';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.public_guild_snapshots_explore', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 verify B: authenticated cannot SELECT the replacement view public.public_guild_snapshots_explore';
  END IF;

  SELECT count(*) INTO v_public_policies
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'public_guild_snapshots'
     AND ('public' = ANY (roles) OR policyname = 'Public read access');

  IF v_public_policies > 0 THEN
    RAISE EXCEPTION
      'PS-20 verify B: a PUBLIC-scoped read policy remains on public.public_guild_snapshots (% found)',
      v_public_policies;
  END IF;

  RAISE NOTICE 'PS-20 verify B: OK -- base table closed to anon/authenticated, redacting view in place';
END;
$verifyb$;

COMMIT;

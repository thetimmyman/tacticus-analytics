-- Revoke client INSERT/UPDATE/DELETE on public_guild_snapshots: inert only while no
-- write policy exists. The owner-run refresh does not need them.
-- target-db: general

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

DO $precondition$
BEGIN
  IF to_regclass('public.public_guild_snapshots') IS NULL THEN
    RAISE EXCEPTION
      'PS-125: table public.public_guild_snapshots does not exist; refusing to run';
  END IF;

  IF to_regprocedure('public.refresh_public_guild_snapshots()') IS NULL THEN
    RAISE EXCEPTION
      'PS-125: public.refresh_public_guild_snapshots() is absent; the maintained-by-the-refresh-function premise of this change no longer holds';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.public_guild_snapshots', 'INSERT') THEN
    RAISE EXCEPTION
      'PS-125: service_role cannot INSERT public.public_guild_snapshots; revoking the end-user grants now would leave the table with no writer at all';
  END IF;
END;
$precondition$;

REVOKE INSERT, UPDATE, DELETE ON public.public_guild_snapshots FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.public_guild_snapshots FROM anon;

-- Raises on an unmigrated database; asserts the table exists so it cannot pass vacuously.

DO $verify$
DECLARE
  v_rel oid;
  v_remaining text[];
BEGIN
  v_rel := to_regclass('public.public_guild_snapshots');
  IF v_rel IS NULL THEN
    RAISE EXCEPTION
      'PS-125 verify: table public.public_guild_snapshots does not exist; this verification would otherwise pass vacuously';
  END IF;

  SELECT coalesce(array_agg(p ORDER BY p), ARRAY[]::text[])
    INTO v_remaining
    FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
   WHERE has_table_privilege('authenticated', v_rel, p);

  IF array_length(v_remaining, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-125 verify: authenticated still holds % write privilege(s) on public.public_guild_snapshots: %',
      array_length(v_remaining, 1),
      array_to_string(v_remaining, ', ');
  END IF;

  SELECT coalesce(array_agg(p ORDER BY p), ARRAY[]::text[])
    INTO v_remaining
    FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
   WHERE has_table_privilege('anon', v_rel, p);

  IF array_length(v_remaining, 1) > 0 THEN
    RAISE EXCEPTION
      'PS-125 verify: anon still holds % write privilege(s) on public.public_guild_snapshots: %',
      array_length(v_remaining, 1),
      array_to_string(v_remaining, ', ');
  END IF;

  -- The other half of the claim: the writer that must survive.
  IF NOT (
    has_table_privilege('service_role', v_rel, 'INSERT')
    AND has_table_privilege('service_role', v_rel, 'UPDATE')
    AND has_table_privilege('service_role', v_rel, 'DELETE')
  ) THEN
    RAISE EXCEPTION
      'PS-125 verify: service_role lost a write privilege on public.public_guild_snapshots';
  END IF;

  RAISE NOTICE 'PS-125 verify: OK -- authenticated and anon hold no INSERT/UPDATE/DELETE on public.public_guild_snapshots; service_role retains all three';
END;
$verify$;

COMMIT;

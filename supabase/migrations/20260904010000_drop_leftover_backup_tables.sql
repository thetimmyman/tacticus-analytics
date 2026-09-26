-- Drop two unread backup tables (one client-readable, one holding old encrypted keys).
-- No CASCADE: an unexpected dependant must fail the drop.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-19 leftover-backup drop targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Pre-drop presence, so verify cannot pass on a database that never had the tables.
CREATE TEMP TABLE ps19_pre_presence ON COMMIT DROP AS
SELECT
  to_regclass('public.wi6560_prime_notes_backup') IS NOT NULL
    AS prime_notes_present,
  to_regclass('monitoring.ops_backup_player_api_key_20260831') IS NOT NULL
    AS api_key_backup_present;

-- REVOKE on a missing table errors, so each is guarded to stay idempotent.
DO $revoke_prime_notes$
BEGIN
  IF to_regclass('public.wi6560_prime_notes_backup') IS NOT NULL THEN
    REVOKE ALL ON public.wi6560_prime_notes_backup
      FROM PUBLIC, anon, authenticated, analytics_ro, service_role;
  END IF;
END;
$revoke_prime_notes$;

DO $revoke_api_key_backup$
BEGIN
  IF to_regclass('monitoring.ops_backup_player_api_key_20260831') IS NOT NULL THEN
    REVOKE ALL ON monitoring.ops_backup_player_api_key_20260831
      FROM PUBLIC, anon, authenticated, analytics_ro, service_role;
  END IF;
END;
$revoke_api_key_backup$;

DROP TABLE IF EXISTS public.wi6560_prime_notes_backup;
DROP TABLE IF EXISTS monitoring.ops_backup_player_api_key_20260831;

-- Self-contained and read-only: run alone before the apply, it must RAISE.
DO $verify$
DECLARE
  prime_now boolean := to_regclass('public.wi6560_prime_notes_backup') IS NOT NULL;
  api_key_now boolean := to_regclass('monitoring.ops_backup_player_api_key_20260831') IS NOT NULL;
  prime_pre boolean;
  api_key_pre boolean;
  already_recorded boolean := false;
BEGIN
  IF prime_now OR api_key_now THEN
    RAISE EXCEPTION
      'PS-19 verify: still present: %',
      concat_ws(', ',
        CASE WHEN prime_now THEN 'public.wi6560_prime_notes_backup' END,
        CASE WHEN api_key_now
             THEN 'monitoring.ops_backup_player_api_key_20260831' END);
  END IF;

  -- Dynamic SQL: a static reference to a temp table that does not exist fails
  -- to PARSE, which would break the standalone probe run.
  IF to_regclass('pg_temp.ps19_pre_presence') IS NOT NULL THEN
    EXECUTE 'SELECT prime_notes_present, api_key_backup_present'
         || '  FROM pg_temp.ps19_pre_presence'
      INTO prime_pre, api_key_pre;
  ELSE
    prime_pre := prime_now;
    api_key_pre := api_key_now;
  END IF;

  IF NOT (prime_pre OR api_key_pre) THEN
    IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations'
           || ' WHERE version = ''20260904010000'')'
        INTO already_recorded;
    END IF;

    IF NOT already_recorded THEN
      RAISE EXCEPTION
        'PS-19 verify: neither table was present when this migration started and version 20260904010000 is not in the ledger; refusing a vacuous pass on a database that never had them';
    END IF;

    RAISE NOTICE
      'PS-19 verify: both tables already absent and 20260904010000 is already in the ledger; re-apply is a no-op';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

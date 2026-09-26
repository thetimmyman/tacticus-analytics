-- Per-guild markers so quiet realtime ticks refresh the roster at most hourly and
-- retry Herald after a raid write. NULL means never.
-- target-db: general
-- A column REVOKE cannot narrow authenticated's table-level UPDATE, so a trigger
-- refuses client writes that could suppress reconciliation.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'sync quiet-tick markers (general) require database postgres, got %', current_database();
  END IF;
END;
$guard$;

ALTER TABLE public.guild_config
  ADD COLUMN IF NOT EXISTS last_roster_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_raid_write_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_guild_config_sync_markers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.last_roster_refresh_at IS DISTINCT FROM OLD.last_roster_refresh_at
    OR NEW.last_raid_write_at IS DISTINCT FROM OLD.last_raid_write_at
  THEN
    RAISE EXCEPTION 'guild_config sync markers may only be written by server authority'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_guild_config_sync_markers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_guild_config_sync_markers ON public.guild_config;
CREATE TRIGGER guard_guild_config_sync_markers
  BEFORE UPDATE OF last_roster_refresh_at, last_raid_write_at
  ON public.guild_config
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_guild_config_sync_markers();

COMMENT ON COLUMN public.guild_config.last_roster_refresh_at IS
  'Last LOKI roster/authority refresh attempt by the sync worker; quiet realtime ticks re-run it at most hourly (PR #320).';
COMMENT ON COLUMN public.guild_config.last_raid_write_at IS
  'Last time the sync worker landed new raid rows; quiet ticks retry Herald within 30 minutes of it (PR #320).';

DO $verify$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guild_config'
       AND column_name IN ('last_roster_refresh_at', 'last_raid_write_at')
       AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'
  ) <> 2 THEN
    RAISE EXCEPTION 'sync quiet-tick markers: columns missing or mistyped';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.guild_config'::regclass
       AND tgname = 'guard_guild_config_sync_markers'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'sync quiet-tick markers: guard trigger missing';
  END IF;
END;
$verify$;

COMMIT;

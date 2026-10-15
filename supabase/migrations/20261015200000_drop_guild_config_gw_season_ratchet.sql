-- target-db: general
-- Drop guild_config.last_successful_gw_season. Only the retired automated
-- ranking fetch wrote it and nothing reads it. GR_Ranking and GW_Ranking stay:
-- they are entered by hand.
-- Rollback: ADD COLUMN last_successful_gw_season integer. The value was a
-- per-guild probe hint, so nothing needs restoring.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc LIKE '%last_successful_gw_season%'
  ) THEN
    RAISE EXCEPTION 'A public function still references guild_config.last_successful_gw_season';
  END IF;
END
$guard$;

-- No CASCADE: a dependent view must fail the drop rather than vanish with it.
ALTER TABLE public.guild_config DROP COLUMN IF EXISTS last_successful_gw_season;

COMMIT;

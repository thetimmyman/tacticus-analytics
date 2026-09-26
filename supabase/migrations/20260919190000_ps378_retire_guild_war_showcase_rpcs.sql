-- Drop the three get_guild_war_showcase_* definers: anon-executable, unread, and
-- gated on war_visibility = 'public', which was never open.
-- target-db: general
-- Live-only, so no rollback body exists in the repo; capture pg_get_functiondef first if needed.

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
SET LOCAL statement_timeout = '30s';

-- Records which starting state this is; never raises.
DO $pre$
DECLARE
  v_summary_present boolean := to_regprocedure('public.get_guild_war_showcase_summary(text)') IS NOT NULL;
  v_matches_present boolean := to_regprocedure('public.get_guild_war_showcase_matches(text, integer)') IS NOT NULL;
  v_lineups_present boolean := to_regprocedure('public.get_guild_war_showcase_lineups(text, integer)') IS NOT NULL;
BEGIN
  RAISE NOTICE
    'PS-378 precondition: get_guild_war_showcase_summary present=%, get_guild_war_showcase_matches present=%, get_guild_war_showcase_lineups present=% (either state is expected -- see PRECONDITION note in this file''s header)',
    v_summary_present, v_matches_present, v_lineups_present;
END;
$pre$;

DROP FUNCTION IF EXISTS public.get_guild_war_showcase_summary(p_guild_code text);
DROP FUNCTION IF EXISTS public.get_guild_war_showcase_matches(p_guild_code text, p_limit integer);
DROP FUNCTION IF EXISTS public.get_guild_war_showcase_lineups(p_guild_code text, p_limit integer);

DO $verify$
BEGIN
  IF to_regprocedure('public.get_guild_war_showcase_summary(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PS-378: get_guild_war_showcase_summary(text) still present in pg_proc';
  END IF;

  IF to_regprocedure('public.get_guild_war_showcase_matches(text, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'PS-378: get_guild_war_showcase_matches(text, integer) still present in pg_proc';
  END IF;

  IF to_regprocedure('public.get_guild_war_showcase_lineups(text, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'PS-378: get_guild_war_showcase_lineups(text, integer) still present in pg_proc';
  END IF;

  -- Positive control: to_regprocedure can and does find a live function when
  -- one exists, so the three NULLs above are a real absence, not a lookup
  -- that always returns NULL.
  IF to_regprocedure('public.get_public_stats()') IS NULL THEN
    RAISE EXCEPTION
      'PS-378: positive control failed -- public.get_public_stats() is unexpectedly absent, so the three absence checks above are not trustworthy on this database';
  END IF;
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

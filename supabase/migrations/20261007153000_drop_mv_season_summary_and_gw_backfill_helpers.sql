-- target-db: general
-- Drop public.mv_season_summary and the dead guild-war backfill chain.
--
-- mv_season_summary: no function, view, policy or app code reads it. The only
-- refresher, purge_old_seasons(), was retired by 20260925050000.
--
-- gw_backfill_guild_war_battles_batch(integer) and the two helpers it alone
-- calls, gw_tmp_lineup_id(jsonb) and gw_tmp_build_unit_snapshots(jsonb): a
-- one-shot backfill that no migration here creates, flagged "DO NOT RUN" by
-- 20260831030000 (its guard assumes battles.id = attempts.id, which no longer
-- holds). No caller exists in app, modules, edge functions, scripts, cron,
-- other functions or views; pg_stat_statements shows no calls.
--
-- Rollback: re-create the matview and the three functions from the definitions
-- captured before apply, then
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261007153000';
-- The matview comes back populated by a plain REFRESH (about 1.6k rows).

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- Refuse if anything other than the dropped objects still names them. A plain
-- DROP also fails on a dependent view or index, but not on a function body.
DO $precondition$
DECLARE
  v_readers text[];
BEGIN
  SELECT coalesce(array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text), ARRAY[]::text[])
    INTO v_readers
    FROM pg_proc p
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p.proname NOT IN ('gw_tmp_lineup_id', 'gw_tmp_build_unit_snapshots',
                           'gw_backfill_guild_war_battles_batch')
     AND p.prokind IN ('f', 'p')
     AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('sql', 'plpgsql'))
     AND (p.prosrc ILIKE '%mv\_season\_summary%'
          OR p.prosrc ILIKE '%gw\_tmp\_lineup\_id%'
          OR p.prosrc ILIKE '%gw\_tmp\_build\_unit\_snapshots%'
          OR p.prosrc ILIKE '%gw\_backfill\_guild\_war\_battles\_batch%');
  IF array_length(v_readers, 1) > 0 THEN
    RAISE EXCEPTION 'drop mv_season_summary / gw backfill chain: still named by %',
      array_to_string(v_readers, ', ');
  END IF;
END;
$precondition$;

DROP MATERIALIZED VIEW IF EXISTS public.mv_season_summary;
DROP FUNCTION IF EXISTS public.gw_backfill_guild_war_battles_batch(integer);
DROP FUNCTION IF EXISTS public.gw_tmp_lineup_id(jsonb);
DROP FUNCTION IF EXISTS public.gw_tmp_build_unit_snapshots(jsonb);

-- Closing assertion, inside the transaction so a shortfall aborts the apply.
-- Matches by name, so a surviving overload also fails it.
DO $verify$
DECLARE
  v_left text[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[])
    INTO v_left
    FROM (
      SELECT p.oid::regprocedure::text AS x
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('gw_tmp_lineup_id', 'gw_tmp_build_unit_snapshots',
                           'gw_backfill_guild_war_battles_batch')
      UNION ALL
      SELECT c.oid::regclass::text
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname = 'mv_season_summary'
    ) s;
  IF array_length(v_left, 1) > 0 THEN
    RAISE EXCEPTION 'drop mv_season_summary / gw backfill chain verify: still present: %',
      array_to_string(v_left, ', ');
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261007153000', 'drop_mv_season_summary_and_gw_backfill_helpers')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

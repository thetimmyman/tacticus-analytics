-- Kept apart from ps291_guild_total_carriers.sql, whose gate migration the throwaway lane cannot apply.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260904200000'
    AND name = 'ps308_drop_global_leaderboard_view'
) AS ps308_not_applied \gset

\if :ps308_not_applied
SELECT plan(5);
SELECT * FROM skip(
  5,
  'this database predates PS-308; apply 20260904200000 and this suite executes fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(5);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260904200000'
      AND name = 'ps308_drop_global_leaderboard_view'),
  1,
  '1. the PS-308 migration is recorded exactly once in the ledger'
);

SELECT ok(
  to_regclass('public.global_leaderboard') IS NULL,
  '2. public.global_leaderboard is gone'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'global_leaderboard'),
  0,
  '3. no relation named global_leaderboard survives in ANY schema; it was dropped, not moved'
);

-- Positive control: the surviving RPC shares only the name with the dropped view.
SELECT isnt(
  to_regprocedure('public.get_public_global_leaderboard(integer)')::text,
  NULL,
  '4. public.get_public_global_leaderboard(integer) survives; it was never a reader of the view'
);

SELECT ok(
  (SELECT prosrc FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)'))
    NOT ILIKE '%global_leaderboard%',
  '5. the surviving RPC body does not reference the dropped view (name-share only), so the drop cannot have broken it'
);

SELECT * FROM finish();
ROLLBACK;
\endif

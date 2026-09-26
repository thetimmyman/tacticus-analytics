-- get_guild_member_luck_summary(integer) stays dropped: it served peerless aggregates.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Skip only when the migration is absent; if its ledger row exists, fail.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260901233000'
    AND name = 'drop_stale_member_luck_summary_general'
) AS luck_drop_not_applied \gset

\if :luck_drop_not_applied
SELECT plan(3);
SELECT * FROM skip(
  3,
  'this database predates the stale luck-summary drop; the replay lane applies the migration and executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(3);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260901233000'
      AND name = 'drop_stale_member_luck_summary_general'
  ),
  1,
  'the stale luck-summary drop migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'get_guild_member_luck_summary'
  ),
  0,
  'no overload of get_guild_member_luck_summary exists in public'
);

SELECT ok(
  to_regprocedure('public.get_guild_member_luck_summary(integer)') IS NULL,
  'the probed (integer) signature resolves to nothing'
);

SELECT * FROM finish();
ROLLBACK;
\endif

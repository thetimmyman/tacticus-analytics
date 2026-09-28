-- The showcase functions are live-only, so 5-7 skip unless PGTAP_LIVE_FUNCTIONS loads them first.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(7);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260919190000'
      AND name = 'ps378_retire_guild_war_showcase_rpcs'),
  1,
  '1. the retire_guild_war_showcase_rpcs migration is recorded exactly once in the ledger'
);

SELECT isnt(
  to_regprocedure('public.get_public_stats()')::text,
  NULL,
  '2. positive control: to_regprocedure finds public.get_public_stats(), a real, still-live function -- proves the lookup mechanism is not blind'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = function.pronamespace
    WHERE ns.nspname = 'public'
      AND function.proname = 'get_public_stats_cached'
      AND pg_catalog.pg_get_functiondef(function.oid) ILIKE '%get_public_stats%'
  ),
  '3. positive control: the body-substring search finds a known match (get_public_stats_cached calls get_public_stats)'
);

-- MATERIALIZED keeps pg_get_functiondef() after the prokind filter; it raises on aggregates.
SELECT is(
  (
    WITH candidates AS MATERIALIZED (
      SELECT function.oid
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS ns ON ns.oid = function.pronamespace
      WHERE ns.nspname = 'public'
        AND function.prokind = 'f'
        AND function.proname NOT IN (
          'get_guild_war_showcase_summary',
          'get_guild_war_showcase_matches',
          'get_guild_war_showcase_lineups'
        )
    )
    SELECT count(*)::integer
    FROM candidates
    WHERE pg_catalog.pg_get_functiondef(oid) ILIKE '%get_guild_war_showcase_summary%'
       OR pg_catalog.pg_get_functiondef(oid) ILIKE '%get_guild_war_showcase_matches%'
       OR pg_catalog.pg_get_functiondef(oid) ILIKE '%get_guild_war_showcase_lineups%'
  ),
  0,
  '4. class guard: no surviving public function body references any of the three retired RPC names'
);

-- Gate on "was a dump loaded", not "is one present now", which would skip the run proving the drop.
\if :{?pgtap_live_functions}
\else
\set pgtap_live_functions 0
\endif

\if :pgtap_live_functions
SELECT is(
  to_regprocedure('public.get_guild_war_showcase_summary(text)')::text,
  NULL,
  '5. get_guild_war_showcase_summary(text) is gone'
);
SELECT is(
  to_regprocedure('public.get_guild_war_showcase_matches(text, integer)')::text,
  NULL,
  '6. get_guild_war_showcase_matches(text, integer) is gone'
);
SELECT is(
  to_regprocedure('public.get_guild_war_showcase_lineups(text, integer)')::text,
  NULL,
  '7. get_guild_war_showcase_lineups(text, integer) is gone'
);
\else
SELECT * FROM skip(
  3,
  'no live-functions dump was loaded, and no migration in this repository defines the three retired functions (live-only, see this suite''s header); point PGTAP_LIVE_FUNCTIONS at a dump of the live bodies to execute assertions 5-7 for real'
);
\endif

SELECT * FROM finish();
ROLLBACK;

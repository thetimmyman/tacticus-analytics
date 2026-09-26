-- Acceptance suite, not run by CI: "Season" orders numerically in seven functions.
-- The census scans pg_proc only (mv_season_summary is dropped separately).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260904130000'
    AND name = 'ps258_numeric_season_ordering'
) AS ps258_not_applied \gset

\if :ps258_not_applied
SELECT plan(9);
SELECT * FROM skip(
  9,
  'this database predates PS-258; the reconciler applies the migration and executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(9);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260904130000'
      AND name = 'ps258_numeric_season_ordering'
  ),
  1,
  'the PS-258 migration is recorded exactly once'
);

-- Each ORDER BY "Season" needs a numeric cast on that token; a whole-body check is
-- fooled by unrelated casts. get_distinct_seasons_for_guild (::int) is the control.
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.pronamespace = 'public'::regnamespace
      AND pg_catalog.pg_get_functiondef(fn.oid) ~ '"?Season"?[a-zA-Z0-9_."]*\s+(DESC|ASC)'
      AND pg_catalog.pg_get_functiondef(fn.oid) !~ '"?Season"?[a-zA-Z0-9_."]*\)?::(numeric|int|integer|bigint)\s+(DESC|ASC)'
  ),
  0,
  'no function orders "Season" without a numeric-family cast on that ordering token'
);

SELECT ok(
  (
    SELECT count(*) FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'get_distinct_seasons_for_guild'
      AND pg_catalog.pg_get_functiondef(oid) ~ 's::int DESC'
  ) = 1,
  'positive control: get_distinct_seasons_for_guild still casts s::int in its ORDER BY (regex sanity check)'
);

-- Only these two lack other ::numeric casts pre-fix, so matching them is non-vacuous.
SELECT ok(
  (SELECT pg_catalog.pg_get_functiondef(oid) FROM pg_catalog.pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = 'get_distinct_seasons') ~ '::numeric',
  'get_distinct_seasons casts ::numeric in its ORDER BY'
);

SELECT ok(
  (SELECT pg_catalog.pg_get_functiondef(oid) FROM pg_catalog.pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = 'get_seasons_for_guild') ~ '::numeric',
  'get_seasons_for_guild casts ::numeric in its ORDER BY'
);

SELECT ok(
  (SELECT pg_catalog.pg_get_functiondef(oid) FROM pg_catalog.pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = 'backfill_boss_mapping_unit_ids') ~ '::numeric',
  'backfill_boss_mapping_unit_ids casts ::numeric in its ORDER BY tie-break'
);

SELECT is(
  (SELECT season FROM get_distinct_seasons() LIMIT 1)::numeric,
  (SELECT max(("Season")::numeric) FROM "EOT_GR_data"),
  'get_distinct_seasons() returns the live numeric-max Season first'
);

-- A pattern match would be vacuous here: once a lower season appears no higher one may follow.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM (
      SELECT
        (season)::numeric AS s,
        lag((season)::numeric) OVER (ORDER BY rn) AS prev_s
      FROM (
        SELECT season, row_number() OVER () AS rn
        FROM get_guild_boss_averages_batch(
          (SELECT "Guild" FROM "EOT_GR_data" GROUP BY "Guild" ORDER BY count(*) DESC LIMIT 1),
          ARRAY(SELECT DISTINCT "Season" FROM "EOT_GR_data")
        )
      ) rows_in_emission_order
    ) with_lag
    WHERE prev_s IS NOT NULL AND s > prev_s
  ),
  'get_guild_boss_averages_batch never emits a later row with a numerically higher Season than an earlier row'
);

-- A whole-body census would have wrongly reported this fix as already present.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM (
      SELECT
        (season)::numeric AS s,
        lag((season)::numeric) OVER (ORDER BY rn) AS prev_s
      FROM (
        SELECT season, row_number() OVER () AS rn
        FROM get_guild_trends_batch(
          (SELECT "Guild" FROM "EOT_GR_data" GROUP BY "Guild" ORDER BY count(*) DESC LIMIT 1),
          ARRAY(SELECT DISTINCT "Season" FROM "EOT_GR_data")
        )
      ) rows_in_emission_order
    ) with_lag
    WHERE prev_s IS NOT NULL AND s > prev_s
  ),
  'get_guild_trends_batch never emits a later row with a numerically higher Season than an earlier row'
);

SELECT * FROM finish();
ROLLBACK;
\endif

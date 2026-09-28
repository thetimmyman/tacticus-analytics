BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- claim_season_summary: one statement decides and claims, so two overlapping
-- detect-season-end runs cannot both pass a separate check-then-insert.

SELECT plan(6);

SELECT has_function('public', 'claim_season_summary',
  ARRAY['character varying', 'character varying', 'interval'],
  'claim_season_summary exists with the (cluster_code, season, stale_after) signature');

SELECT is(
  public.claim_season_summary('TestClstA', '990001'),
  true,
  'a fresh (cluster, season) pair claims successfully');

-- A LANGUAGE sql scalar function returns NULL, not false, when its query
-- returns zero rows: the ON CONFLICT DO UPDATE...WHERE didn't match, so
-- nothing was RETURNING'd. The caller in index.ts treats both the same way
-- (`data === true`), but this suite pins the actual value.
SELECT is(
  public.claim_season_summary('TestClstA', '990001'),
  NULL,
  'a second claim attempt on the same still-fresh unsent pair fails -- this is the double-post race');

UPDATE public.season_summary_tracking
   SET sent_at = now()
 WHERE cluster_code = 'TestClstA' AND season = '990001';

SELECT is(
  public.claim_season_summary('TestClstA', '990001'),
  NULL,
  'a genuinely completed (sent_at set) pair can never be reclaimed');

INSERT INTO public.season_summary_tracking (cluster_code, season, sent_at, created_at)
VALUES ('TestClstB', '990002', NULL, now() - interval '1 hour');

SELECT is(
  public.claim_season_summary('TestClstB', '990002', interval '10 minutes'),
  true,
  'an unsent claim older than p_stale_after is reclaimable -- recovery from a crashed run');

SELECT is(
  (SELECT sent_at FROM public.season_summary_tracking
    WHERE cluster_code = 'TestClstB' AND season = '990002'),
  NULL,
  'reclaiming resets sent_at to NULL rather than marking it sent');

SELECT finish();

ROLLBACK;

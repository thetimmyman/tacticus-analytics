BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- Season 104's real lineup ships in seed data: position 1 = Riptide, 2 = Screamer Killer.

SELECT plan(4);

SELECT has_function('public', 'resolve_season_boss_name',
  ARRAY['integer', 'integer', 'integer', 'text'],
  'resolve_season_boss_name exists with the centralized-helper signature');

SELECT is(
  public.resolve_season_boss_name(104, 1, 0, 'Boss 1'),
  'Riptide',
  'helper resolves season 104 position 1 to the real seeded name (Riptide)');
SELECT is(
  public.resolve_season_boss_name(104, 2, 0, 'Boss 2'),
  'Screamer Killer',
  'helper resolves season 104 position 2 to the real seeded name (Screamer Killer)');
SELECT is(
  public.resolve_season_boss_name(99999, 1, 0, 'Boss 1'),
  'Boss 1',
  'helper falls back to the raw/placeholder name when no lineup row exists');

SELECT finish();

ROLLBACK;

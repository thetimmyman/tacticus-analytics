BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(5);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260730170000'
  ),
  'the live season-lineup refresh migration is recorded'
);

SELECT is(
  (SELECT count(*) FROM public.season_boss_lineup WHERE season = 107),
  8::bigint,
  'season 107 exposes all five Legendary and three Mythic boss positions'
);

SELECT is(
  (
    SELECT array_agg(boss_type ORDER BY boss_position)
    FROM public.season_boss_lineup
    WHERE season = 107
  ),
  ARRAY[
    'ScreamerKiller', 'Riptide', 'Ghazghkull', 'AvatarOfKhaine',
    'BelisariusRW', 'SilentKing', 'Lion', 'Mortarion'
  ]::text[],
  'season 107 position 8 resolves the new M3 Mortarion slot'
);

SELECT is(
  (
    SELECT array_agg(boss_type ORDER BY boss_position)
    FROM public.season_boss_lineup
    WHERE season = 108
  ),
  ARRAY[
    'HiveTyrantKronos', 'ScreamerKiller', 'TervigonLeviathan', 'RogalDorn',
    'Riptide', 'ScreamerKiller', 'RogalDorn', 'Riptide'
  ]::text[],
  'season 108 DB lineup matches the committed Loki overlay'
);

SELECT is(
  (
    SELECT array_agg(boss_type ORDER BY boss_position)
    FROM public.season_boss_lineup
    WHERE season = 109
  ),
  ARRAY[
    'AvatarOfKhaine', 'BelisariusRW', 'RogalDorn', 'Ghazghkull',
    'Mortarion', 'Magnus', 'SilentKing', 'Lion'
  ]::text[],
  'season 109 DB lineup matches the committed Loki overlay'
);

SELECT finish();
ROLLBACK;

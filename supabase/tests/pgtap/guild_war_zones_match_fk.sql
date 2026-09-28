BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(12);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'guild_war_zones_match_fk'
      AND constraint_row.contype = 'f'
      AND constraint_row.conrelid = 'public.guild_war_zones'::regclass
      AND constraint_row.confrelid = 'public.guild_war_matches'::regclass
  ),
  1::integer,
  'the guild_war_zones_match_fk foreign key exists on the expected tables'
);

SELECT is(
  (
    SELECT constraint_row.convalidated
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'guild_war_zones_match_fk'
      AND constraint_row.conrelid = 'public.guild_war_zones'::regclass
  ),
  true::boolean,
  'the guild_war_zones_match_fk constraint is validated'
);

SELECT is(
  (
    SELECT constraint_row.confdeltype::text
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'guild_war_zones_match_fk'
      AND constraint_row.conrelid = 'public.guild_war_zones'::regclass
  ),
  'c'::text,
  'the guild_war_zones_match_fk constraint cascades match deletion'
);

SELECT is(
  (
    SELECT constraint_row.confupdtype::text
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'guild_war_zones_match_fk'
      AND constraint_row.conrelid = 'public.guild_war_zones'::regclass
  ),
  'c'::text,
  'the guild_war_zones_match_fk constraint cascades guild-code renames'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.guild_war_zones AS zone
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.guild_war_matches AS match
      WHERE match.war_id = zone.war_id
        AND match.guild_code = zone.guild_code
    )
  ),
  0::integer,
  'the migration left no zone without its matching match'
);

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('TP416-FK-GUILD', 'Test FK fixture')
ON CONFLICT (guild_code) DO NOTHING;

SELECT lives_ok(
  $$
    INSERT INTO public.guild_war_matches (
      war_id, guild_code, opponent_guild_name, war_status
    )
    VALUES (
      'tp416-fk-war', 'TP416-FK-GUILD', 'Test Opponent', 'active'
    )
  $$,
  'a match can be inserted for the fixture guild'
);

SELECT lives_ok(
  $$
    INSERT INTO public.guild_war_zones (
      war_id, guild_code, zone_number, zone_type, zone_status
    )
    VALUES (
      'tp416-fk-war', 'TP416-FK-GUILD', 1, 'test', 'available'
    )
  $$,
  'a zone can be inserted when its same-key match exists'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_zones (
      war_id, guild_code, zone_number, zone_type, zone_status
    )
    VALUES (
      'tp416-fk-no-match', 'TP416-FK-GUILD', 2, 'test', 'available'
    )
  $$,
  '23503',
  NULL,
  'a zone without its same-key match is rejected by the FK'
);

SELECT lives_ok(
  $$
    UPDATE public.guild_config
    SET guild_code = 'TP416-FK-RENAMED'
    WHERE guild_code = 'TP416-FK-GUILD'
  $$,
  'renaming the guild code succeeds with zones attached'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.guild_war_zones
    WHERE war_id = 'tp416-fk-war'
      AND guild_code = 'TP416-FK-RENAMED'
  ),
  1::integer,
  'the rename carried the zone to the new guild code'
);

SELECT lives_ok(
  $$
    DELETE FROM public.guild_war_matches
    WHERE war_id = 'tp416-fk-war'
      AND guild_code = 'TP416-FK-RENAMED'
  $$,
  'deleting the matching match succeeds'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.guild_war_zones
    WHERE war_id = 'tp416-fk-war'
      AND guild_code = 'TP416-FK-RENAMED'
  ),
  0::integer,
  'deleting the match cascades its zone'
);

SELECT * FROM finish();
ROLLBACK;

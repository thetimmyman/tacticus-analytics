BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(3);

-- A member holds a bomb when their latest Bomb entry is >= 18h old or absent. Max 1/member.

INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES (926600, 'TW2660A', 'Test Bombs Guild', now(), true);

-- Signup triggers are disabled; their side effects are irrelevant here.
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fresh-bomber@example.test'),
  ('00000000-0000-0000-0000-000000266002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'old-bomber@example.test'),
  ('00000000-0000-0000-0000-000000266003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'never-bombed@example.test'),
  ('00000000-0000-0000-0000-000000266004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ex-member@example.test');

INSERT INTO public.player_mapping (
  id, user_id, player_id, display_name, guild_code, role, is_current,
  created_at, updated_at
)
VALUES
  (926600, '00000000-0000-0000-0000-000000266001', 'tw2660-fresh-bomber', 'Fresh Bomber', 'TW2660A', 'member'::public.app_role, true, now(), now()),
  (926601, '00000000-0000-0000-0000-000000266002', 'tw2660-old-bomber',   'Old Bomber',   'TW2660A', 'member'::public.app_role, true, now(), now()),
  (926602, '00000000-0000-0000-0000-000000266003', 'tw2660-never-bombed', 'Never Bombed', 'TW2660A', 'member'::public.app_role, true, now(), now()),
  (926603, '00000000-0000-0000-0000-000000266004', 'tw2660-ex-member',    'Ex Member',    'TW2660A', 'member'::public.app_role, false, now(), now());

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "startedOn", "completedOn", "encounterId",
  "rarity", "userId", "encounterIndex", "encounterType"
)
VALUES
  ('TW2660A', '104', 'Fresh Bomber', 'Ghazghkull', 'Bomb', 15000, 0, 6, 1, now() - interval '2 hours', now() - interval '2 hours', 0, 'Mythic', 'tw2660-fresh-bomber', 0, 'Boss'),
  ('TW2660A', '103', 'Old Bomber', 'Szarekh', 'Bomb', 15000, 7, 6, 2, now() - interval '20 hours', now() - interval '20 hours', 0, 'Mythic', 'tw2660-old-bomber', 0, 'Boss'),
  ('TW2660A', '104', 'Never Bombed', 'Ghazghkull', 'Battle', 500000, 0, 6, 1, now() - interval '1 hour', now() - interval '1 hour', 0, 'Mythic', 'tw2660-never-bombed', 0, 'Boss');

SET LOCAL ROLE service_role;

SELECT results_eq(
  $q$ SELECT bombs_available, roster_size
      FROM public.get_guild_bombs_available('TW2660A') $q$,
  $v$ VALUES (2, 3) $v$,
  'TW2660A: 2 of 3 current members hold a bomb (cooldown + never-bombed semantics)'
);

UPDATE public."EOT_GR_data"
SET "startedOn" = now() - interval '64801 seconds',
    "completedOn" = now() - interval '64801 seconds'
WHERE "userId" = 'tw2660-fresh-bomber' AND "damageType" = 'Bomb';

SELECT results_eq(
  $q$ SELECT bombs_available FROM public.get_guild_bombs_available('TW2660A') $q$,
  $v$ VALUES (3) $v$,
  'TW2660A: a bomb older than 64800s no longer counts as spent'
);

SELECT results_eq(
  $q$ SELECT bombs_available, roster_size
      FROM public.get_guild_bombs_available('TW2660-NOPE') $q$,
  $v$ VALUES (0, 0) $v$,
  'unknown guild: zero bombs, zero roster, no error'
);

SELECT * FROM finish();

ROLLBACK;

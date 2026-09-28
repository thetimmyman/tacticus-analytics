BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(14);

SELECT has_trigger('public', 'player_mapping', 'trg_player_mapping_heal_battle_names_ins',
  'insert heal trigger exists');
SELECT has_trigger('public', 'player_mapping', 'trg_player_mapping_heal_battle_names_upd',
  'update heal trigger exists');

INSERT INTO public.guild_config (guild_code, display_name, onboarding_completed)
VALUES ('HEALGLDA', '[TG] Test Guild A', true),
       ('HEALGLDB', '[TG] Test Guild B', true);

INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "encounterId", "userId", "displayName")
VALUES
  (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 1, 'heal-player-a', 'Player#AAAAAA'),
  (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '109', 1, 'heal-player-a', 'Player#AAAAAA'),
  (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDB', '110', 2, 'heal-player-a', 'Player#AAAAAA'),
  (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 3, 'heal-player-e', 'Player#EEEEEE'),
  (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 4, 'heal-player-p', 'Player#0B0B0B');

INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, created_at, updated_at)
VALUES (928001, 'heal-player-a', 'TestPlayerA', 'HEALGLDA', NULL,
  'member'::public.app_role, true, true, now(), now());

SELECT is(
  (SELECT count(*)::int FROM public."EOT_GR_data"
    WHERE "userId" = 'heal-player-a' AND "Guild" = 'HEALGLDA' AND "displayName" = 'TestPlayerA'),
  2, 'a new mapping name renames the member''s alias rows in every season');

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data"
    WHERE "userId" = 'heal-player-a' AND "Guild" = 'HEALGLDB'),
  'TestPlayerA', 'alias rows from a former guild are renamed too');

UPDATE public.player_mapping SET display_name = 'TestPlayerA2' WHERE id = 928001;
SELECT is(
  (SELECT count(*)::int FROM public."EOT_GR_data"
    WHERE "userId" = 'heal-player-a' AND "displayName" = 'TestPlayerA2'),
  0, 'a rename does not rewrite rows that already carry a real name');

-- An erased member's mapping carries a tombstone, which never fires the heal.
INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, created_at, updated_at)
VALUES (928002, 'heal-player-e', '[DELETED_USER_TEST]', 'HEALGLDA', NULL,
  'member'::public.app_role, false, false, now(), now());

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'heal-player-e'),
  'Player#EEEEEE', 'an erased member''s alias rows are never renamed');

-- A member with a pending deletion request keeps the alias.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-00000092800a', 'heal-pending@example.test');
INSERT INTO public.gdpr_deletion_requests (user_id, request_type, status, scheduled_for)
VALUES ('00000000-0000-4000-8000-00000092800a', 'complete', 'scheduled', now() + INTERVAL '30 days');
INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, created_at, updated_at)
VALUES (928004, 'heal-player-p', 'Player#0B0B0B', 'HEALGLDA', NULL,
  'member'::public.app_role, true, true, now(), now());
INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
) VALUES (
  '00000000-0000-4000-8000-00000092800b', 928004, 'heal-player-p',
  '00000000-0000-4000-8000-00000092800a', clock_timestamp(), clock_timestamp(),
  'operator_quarantine_restore', 'HEALGLDA'
);
UPDATE public.player_mapping
SET user_id = '00000000-0000-4000-8000-00000092800a',
    ownership_attestation_id = '00000000-0000-4000-8000-00000092800b'
WHERE id = 928004;
UPDATE public.player_mapping SET display_name = 'TestPlayerP' WHERE id = 928004;

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'heal-player-p'),
  'Player#0B0B0B', 'a member with a pending deletion request keeps the alias');

-- An alias or tombstone name never fires the heal.
INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "encounterId", "userId", "displayName")
VALUES (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 5, 'heal-player-z', 'Player#ABCDEF');
INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, created_at, updated_at)
VALUES (928005, 'heal-player-z', 'Player#ABCDEF', 'HEALGLDA', NULL,
  'member'::public.app_role, true, true, now(), now());
UPDATE public.player_mapping SET display_name = 'TestPlayerZ' WHERE id = 928005;

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'heal-player-z'),
  'TestPlayerZ', 'an alias mapping later given a real name heals on update');

-- A create-config placeholder is not a name: it neither heals nor overwrites alias rows.
INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "encounterId", "userId", "displayName")
VALUES (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 6, 'heal-player-q', 'Player#C0FFEE');
INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, auto_generated, created_at, updated_at)
VALUES (928006, 'heal-player-q', 'Player-1a2b3c4d', 'HEALGLDA', NULL,
  'member'::public.app_role, true, true, true, now(), now());
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'heal-player-q'),
  'Player#C0FFEE', 'a placeholder mapping name never replaces an alias');

-- A battle inserted under an alias after the name is known takes the mapped name.
INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "encounterId", "userId", "displayName")
VALUES (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 7, 'heal-player-a', 'Player#AAAAAA');
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'heal-player-a' AND "encounterId" = 7),
  'TestPlayerA2', 'an alias battle inserted after the mapping takes the mapped name');

-- Case and whitespace variants of the player id are healed.
INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "encounterId", "userId", "displayName")
VALUES (nextval('public."EOT_GR_data_id_seq"'), 'HEALGLDA', '110', 8, 'HEAL-PLAYER-C', 'Player#CCCCCC');
INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, created_at, updated_at)
VALUES (928007, 'heal-player-c', 'TestPlayerC', 'HEALGLDA', NULL,
  'member'::public.app_role, true, true, now(), now());
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'HEAL-PLAYER-C'),
  'TestPlayerC', 'a battle row whose id differs only by case is healed');

-- Only the defined alias shape is treated as an alias.
SELECT ok(NOT public.is_placeholder_player_name('Player#Alice'),
  'a real name that starts with Player# is not an alias');
SELECT ok(public.is_placeholder_player_name('Player#1A2B3C')
          AND public.is_placeholder_player_name('Player-1a2b3c4d')
          AND public.is_placeholder_player_name('[DELETED_USER_X]'),
  'aliases, placeholders and tombstones are classified as non-names');

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_routine_grants
    WHERE routine_name = 'heal_player_hash_battle_names'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')),
  0, 'client roles cannot execute the heal function');

SELECT * FROM finish();
ROLLBACK;

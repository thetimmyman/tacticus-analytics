-- Re-sync or re-insert never restores an erased name in EOT_GR_data."displayName";
-- the INSERT guard tombstones pre-erasure battles only.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(30);

SELECT has_table('public', 'battle_row_erasures', 'the battle_row_erasures ledger exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.battle_row_erasures'::regclass),
  'the ledger has RLS enabled'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
     WHERE has_table_privilege(r.role, 'public.battle_row_erasures',
                               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  ),
  'no API role can read or write the ledger (only the erasure function does)'
);

SELECT has_function(
  'public', 'eot_gr_data_preserve_erasure_tombstone', ARRAY[]::text[],
  'eot_gr_data_preserve_erasure_tombstone() exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public."EOT_GR_data"'::regclass
       AND t.tgname = 'trg_eot_gr_data_preserve_erasure_tombstone'
       AND NOT t.tgisinternal AND t.tgenabled = 'O'
       -- TRIGGER_TYPE_ROW (1) | TRIGGER_TYPE_BEFORE (2) | TRIGGER_TYPE_UPDATE (16)
       AND t.tgtype = (1 | 2 | 16)
       AND pg_get_triggerdef(t.oid) ~ 'WHEN \(.*starts_with\(old."displayName"'
  ),
  'update guard: enabled BEFORE UPDATE FOR EACH ROW with its WHEN filter'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public."EOT_GR_data"'::regclass
       AND t.tgname = 'trg_eot_gr_data_retombstone_erased_insert'
       AND NOT t.tgisinternal AND t.tgenabled = 'O'
       -- TRIGGER_TYPE_ROW (1) | TRIGGER_TYPE_BEFORE (2) | TRIGGER_TYPE_INSERT (4)
       AND t.tgtype = (1 | 2 | 4)
       AND pg_get_triggerdef(t.oid) ~ 'WHEN \(.*"userId" IS NOT NULL'
  ),
  'insert guard: enabled BEFORE INSERT FOR EACH ROW with its WHEN filter'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.eot_gr_data_retombstone_erased_insert()'::regprocedure
       AND p.prosecdef
       AND pg_get_userbyid(p.proowner) = 'postgres'
       AND p.proconfig @> ARRAY['search_path=pg_catalog']
  ),
  'insert guard function: postgres-owned SECURITY DEFINER with a pinned search_path'
);

SELECT ok(
  (SELECT prosrc ~ 'pg_advisory_xact_lock_shared\(\s*hashtextextended\(''battle_row_erasures:'''
     FROM pg_proc WHERE oid = 'public.eot_gr_data_retombstone_erased_insert()'::regprocedure),
  'insert guard takes the per-player erasure lock SHARED before reading the ledger'
);
SELECT ok(
  (SELECT prosrc ~ 'pg_advisory_xact_lock\(hashtextextended\(''battle_row_erasures:'''
     FROM pg_proc WHERE oid = 'public.anonymize_subject_battle_rows(uuid)'::regprocedure),
  'the erasure takes the same per-player lock EXCLUSIVE before writing the ledger'
);

-- NULL proacl is the default (PUBLIC EXECUTE); otherwise owner only.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid IN ('public.eot_gr_data_preserve_erasure_tombstone()'::regprocedure,
                     'public.eot_gr_data_retombstone_erased_insert()'::regprocedure)
       AND (p.proacl IS NULL
            OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee <> p.proowner))
  ),
  'no role but the owner holds EXECUTE on either trigger function'
);

-- Erasure at epoch-ms 1788998400000, season 90.
INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "userId", "encounterId", "startedOn", "completedOn",
  "damageDealt", "damageType", "displayName", tier, rarity
) VALUES
  ('pgtap-tomb-guild', '90', 'pgtap-erased-player', 1,
   '2026-09-01T10:00:00Z', '2026-09-01T10:05:00Z', 1000, 'Battle',
   '[DELETED_USER_1788998400000]', 1, 'Legendary'),
  ('pgtap-tomb-guild', '90', 'pgtap-live-player', 1,
   '2026-09-01T11:00:00Z', '2026-09-01T11:05:00Z', 2000, 'Battle',
   'OldLiveName', 1, 'Legendary'),
  ('pgtap-tomb-guild', '90', 'pgtap-null-player', 1,
   '2026-09-01T12:00:00Z', '2026-09-01T12:05:00Z', 3000, 'Battle',
   NULL, 1, 'Legendary');

-- The insert guard is disabled, or it would rewrite the row before the conflict
-- and the update guard would never run.
ALTER TABLE public."EOT_GR_data" DISABLE TRIGGER trg_eot_gr_data_retombstone_erased_insert;

INSERT INTO public."EOT_GR_data" AS g (
  "Guild", "Season", "userId", "encounterId", "startedOn", "completedOn",
  "damageDealt", "damageType", "displayName", tier, rarity
) VALUES
  ('pgtap-tomb-guild', '90', 'pgtap-erased-player', 1,
   '2026-09-01T10:00:00Z', '2026-09-01T10:05:00Z', 1000, 'Battle',
   'RealUpstreamName', 3, 'Mythic'),
  ('pgtap-tomb-guild', '90', 'pgtap-live-player', 1,
   '2026-09-01T11:00:00Z', '2026-09-01T11:05:00Z', 2000, 'Battle',
   'NewLiveName', 3, 'Mythic')
ON CONFLICT ON CONSTRAINT unique_battle_record_complete DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  tier = EXCLUDED.tier,
  rarity = EXCLUDED.rarity;

ALTER TABLE public."EOT_GR_data" ENABLE TRIGGER trg_eot_gr_data_retombstone_erased_insert;

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  '[DELETED_USER_1788998400000]',
  'upsert re-sync keeps the tombstone instead of the upstream real name'
);
SELECT is(
  (SELECT tier::integer FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  3,
  'upsert re-sync still updates other columns (tier) on the tombstoned row'
);
SELECT is(
  (SELECT rarity FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  'Mythic',
  'upsert re-sync still updates other columns (rarity) on the tombstoned row'
);
SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  1,
  'the re-sync hit the conflict arm (no duplicate row was inserted)'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-live-player'),
  'NewLiveName',
  'negative control: a non-tombstoned row still takes the upstream name'
);

UPDATE public."EOT_GR_data" SET "displayName" = NULL WHERE "userId" = 'pgtap-erased-player';
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  '[DELETED_USER_1788998400000]',
  'an UPDATE to NULL cannot clear the tombstone'
);

UPDATE public."EOT_GR_data" SET "displayName" = '[DELETED_USER_RealName]' WHERE "userId" = 'pgtap-erased-player';
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  '[DELETED_USER_1788998400000]',
  'a malformed prefix-only value does not replace the tombstone'
);

UPDATE public."EOT_GR_data" SET "displayName" = '[DELETED_USER_0a1b2c3d]' WHERE "userId" = 'pgtap-erased-player';
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  '[DELETED_USER_1788998400000]',
  'a hex mapping tombstone does not overwrite an epoch tombstone'
);

UPDATE public."EOT_GR_data" SET "displayName" = '[DELETED_USER_1789000000000]' WHERE "userId" = 'pgtap-erased-player';
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-erased-player'),
  '[DELETED_USER_1789000000000]',
  'a re-erasure (newer epoch tombstone) still applies'
);

UPDATE public."EOT_GR_data" SET "displayName" = '[DELETED_USER_1789100000000]' WHERE "userId" = 'pgtap-live-player';
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-live-player'),
  '[DELETED_USER_1789100000000]',
  'erasure of a live row still writes the tombstone'
);

UPDATE public."EOT_GR_data" SET "displayName" = 'NowNamed' WHERE "userId" = 'pgtap-null-player';
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "userId" = 'pgtap-null-player'),
  'NowNamed',
  'negative control: a NULL displayName is not treated as a tombstone'
);

-- The ledger player had no battle rows at erasure; the ledger is its only record.
INSERT INTO public.battle_row_erasures (player_key, erased_at, erased_season, tombstone)
VALUES ('pgtap-ledger-player', '2026-09-10T00:00:00Z', 90, '[DELETED_USER_1788998400000]');

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "userId", "encounterId", "startedOn", "completedOn",
  "damageDealt", "damageType", "displayName"
) VALUES
  -- A: erasure season, completed before erasure (backfill / drifted key)
  ('pgtap-tomb-guild', '90', 'pgtap-ledger-player', 1,
   '2026-09-05T10:00:00Z', '2026-09-05T10:05:00Z', 101, 'Battle', 'RealName'),
  -- B: earlier season, completedOn synthesised from now() by a sync transform
  ('pgtap-tomb-guild', '89', 'pgtap-ledger-player', 1,
   now(), now(), 102, 'Battle', 'RealName'),
  -- C: erasure season, no completedOn
  ('pgtap-tomb-guild', '90', 'pgtap-ledger-player', 2,
   '2026-09-06T10:00:00Z', NULL, 103, 'Battle', 'RealName'),
  -- D: id spelled with different case and padding
  ('pgtap-tomb-guild', '88', '  PGTAP-Ledger-Player ', 1,
   '2026-08-01T10:00:00Z', '2026-08-01T10:05:00Z', 104, 'Battle', 'RealName'),
  -- E: erasure season, completed AFTER the erasure (new play)
  ('pgtap-tomb-guild', '90', 'pgtap-ledger-player', 3,
   '2026-09-20T10:00:00Z', '2026-09-20T10:05:00Z', 105, 'Battle', 'RealName'),
  -- F: later season (new play)
  ('pgtap-tomb-guild', '91', 'pgtap-ledger-player', 1,
   '2026-10-01T10:00:00Z', '2026-10-01T10:05:00Z', 106, 'Battle', 'RealName'),
  -- G: later season, no completedOn (new play)
  ('pgtap-tomb-guild', '91', 'pgtap-ledger-player', 2,
   '2026-10-02T10:00:00Z', NULL, 107, 'Battle', 'RealName'),
  -- H: a player with no erasure record
  ('pgtap-tomb-guild', '89', 'pgtap-other-player', 1,
   '2026-08-01T10:00:00Z', '2026-08-01T10:05:00Z', 108, 'Battle', 'OtherName');

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 101 AND "Guild" = 'pgtap-tomb-guild'),
  '[DELETED_USER_1788998400000]',
  'insert guard: a battle completed before the erasure is tombstoned (subject had no rows when erased)'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 102 AND "Guild" = 'pgtap-tomb-guild'),
  '[DELETED_USER_1788998400000]',
  'insert guard: an earlier-season battle is tombstoned even with a synthetic now() completedOn'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 103 AND "Guild" = 'pgtap-tomb-guild'),
  '[DELETED_USER_1788998400000]',
  'insert guard: an erasure-season battle with no completedOn is tombstoned'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 104 AND "Guild" = 'pgtap-tomb-guild'),
  '[DELETED_USER_1788998400000]',
  'insert guard: the player id is matched case- and whitespace-insensitively'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 105 AND "Guild" = 'pgtap-tomb-guild'),
  'RealName',
  'insert guard: a battle completed after the erasure keeps the upstream name'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 106 AND "Guild" = 'pgtap-tomb-guild'),
  'RealName',
  'insert guard: a later-season battle keeps the upstream name'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 107 AND "Guild" = 'pgtap-tomb-guild'),
  'RealName',
  'insert guard: a later-season battle with no completedOn keeps the upstream name'
);
SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 108 AND "Guild" = 'pgtap-tomb-guild'),
  'OtherName',
  'insert guard: a player with no erasure record is untouched'
);

-- Insert guard on the conflict path alone: with the update guard disabled,
-- only the insert guard's rewrite of EXCLUDED can place the tombstone.
ALTER TABLE public."EOT_GR_data" DISABLE TRIGGER trg_eot_gr_data_retombstone_erased_insert;
INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "userId", "encounterId", "startedOn", "completedOn",
  "damageDealt", "damageType", "displayName"
) VALUES
  ('pgtap-tomb-guild', '90', 'pgtap-ledger-player', 9,
   '2026-09-07T10:00:00Z', '2026-09-07T10:05:00Z', 109, 'Battle', 'RealName');
ALTER TABLE public."EOT_GR_data" ENABLE TRIGGER trg_eot_gr_data_retombstone_erased_insert;
ALTER TABLE public."EOT_GR_data" DISABLE TRIGGER trg_eot_gr_data_preserve_erasure_tombstone;

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "userId", "encounterId", "startedOn", "completedOn",
  "damageDealt", "damageType", "displayName"
) VALUES
  ('pgtap-tomb-guild', '90', 'pgtap-ledger-player', 9,
   '2026-09-07T10:00:00Z', '2026-09-07T10:05:00Z', 109, 'Battle', 'RealName')
ON CONFLICT ON CONSTRAINT unique_battle_record_complete DO UPDATE SET
  "displayName" = EXCLUDED."displayName";

ALTER TABLE public."EOT_GR_data" ENABLE TRIGGER trg_eot_gr_data_preserve_erasure_tombstone;

SELECT is(
  (SELECT "displayName" FROM public."EOT_GR_data" WHERE "damageDealt" = 109 AND "Guild" = 'pgtap-tomb-guild'),
  '[DELETED_USER_1788998400000]',
  'conflict path: the insert guard rewrites EXCLUDED, re-tombstoning a real-named pre-erasure row on re-sync'
);

SELECT * FROM finish();
ROLLBACK;

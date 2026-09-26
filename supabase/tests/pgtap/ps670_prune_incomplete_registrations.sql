BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(24);

-- Deletes only abandoned stubs, never departed members, survives a concurrent re-activation and
-- does not trust auto_generated (processPlayerSync never sets it). Each clause is asserted alone.

-- Stand-in for the live-only permits table (the helper fails closed without it).
CREATE TABLE IF NOT EXISTS public.guild_membership_move_permits (player_id text);

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('G670', 'PS670 fixture guild');

SELECT has_function(
  'public', 'prune_incomplete_player_registrations', ARRAY['integer'],
  'prune_incomplete_player_registrations(integer) exists with the signature pg_cron calls'
);

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.prune_incomplete_player_registrations(integer)'::regprocedure),
  'SECURITY INVOKER'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.prune_incomplete_player_registrations(integer)'::regprocedure
       AND a.grantee = 0
  ),
  'EXECUTE is not granted to PUBLIC'
);

SELECT throws_ok(
  'SELECT public.prune_incomplete_player_registrations(0)',
  '22023',
  NULL,
  'p_max_rows below 1 is rejected rather than silently treated as unbounded'
);

-- Every row is past the 7-day grace window with is_current = false.

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-departed', 'Departed Sergeant', 'G670', true, false, false,
   now() - interval '90 days', now() - interval '30 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-departed-raider', 'Departed Raider', 'G670', true, false, false,
   now() - interval '90 days', now() - interval '30 days');

INSERT INTO public."EOT_GR_data"
  ("Guild", "Season", "userId", "displayName", "encounterId", "encounterIndex",
   "damageType", "damageDealt", "timestamp")
VALUES
  ('G670', '670', 'ps670-departed-raider', 'Departed Raider', 1, 0, 'Battle', 1,
   now() - interval '40 days');

-- 3. Abandoned stub: the only row the function may delete.
INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-stub', 'Player#AB12CD', 'G670', false, false, true,
   now() - interval '90 days', now() - interval '90 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-stub-fresh', 'Player#EF34GH', 'G670', false, false, true,
   now() - interval '2 days', now() - interval '2 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   protected, created_at, updated_at)
VALUES
  ('ps670-stub-protected', 'Player#IJ56KL', 'G670', false, false, true,
   true, now() - interval '90 days', now() - interval '90 days');

-- 6. Discord claims cannot be seeded: the provenance trigger forbids them on non-current rows.
INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   tacticus_share_url, created_at, updated_at)
VALUES
  ('ps670-stub-claimed', 'Player#MN78OP', 'G670', false, false, true,
   'https://example.invalid/share/ps670', now() - interval '90 days', now() - interval '90 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-erased', '[DELETED_USER_1700000000000]', 'G670', false, false, true,
   now() - interval '90 days', now() - interval '90 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-named', 'Brother Corvus', 'G670', false, false, true,
   now() - interval '90 days', now() - interval '90 days');

-- 9. Guards against `NULL NOT LIKE ...` filtering the NULL branch back out.
ALTER TABLE public.player_mapping ALTER COLUMN display_name DROP NOT NULL;

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-null-name', NULL, 'G670', false, false, true,
   now() - interval '90 days', now() - interval '90 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-departed-noauto', 'ps670-departed-noauto', 'G670', false, false, false,
   now() - interval '90 days', now() - interval '30 days');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-roster-noauto', 'ps670-roster-noauto', 'G670', false, false, true,
   now() - interval '90 days', now() - interval '90 days');

INSERT INTO public.player_roster (player_mapping_id, rank_name)
SELECT id, 'Stone' FROM public.player_mapping WHERE player_id = 'ps670-roster-noauto';

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   created_at, updated_at)
VALUES
  ('ps670-token-evidence', 'Player#CD34EF', 'G670', false, false, true,
   now() - interval '90 days', now() - interval '90 days');

INSERT INTO public.token_burn_state (guild_code, season, player_id)
VALUES ('G670', '670', 'ps670-token-evidence');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, auto_generated, is_current, is_active,
   last_sync_at, created_at, updated_at)
VALUES
  ('ps670-synced', 'Player#EF56AB', 'G670', false, false, true,
   now() - interval '40 days', now() - interval '90 days', now() - interval '40 days');

-- Negative control: the naive predicate matches every row but the young one.
SELECT is(
  (SELECT count(*)::integer FROM public.player_mapping
    WHERE guild_code = 'G670'
      AND is_current = false
      AND created_at < now() - interval '7 days'),
  12,
  'the OLD sweep predicate matches 12 of the 13 fixture rows -- the fixture is not empty'
);

SELECT lives_ok(
  'SELECT public.prune_incomplete_player_registrations(500)',
  'the prune runs to completion'
);


SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'ps670-departed'),
  'Departed Sergeant',
  'a departed member SURVIVES the sweep with display_name intact'
);

SELECT is(
  (SELECT guild_code FROM public.player_mapping WHERE player_id = 'ps670-departed'),
  'G670',
  'the departed member keeps guild_code, so history stays attributable'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-departed-raider'),
  'a departed member with raid history survives (roster + raid-history clauses)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-stub-protected'),
  'a protected row is never swept'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-stub-claimed'),
  'a row with a linked share URL is never swept'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-erased'),
  'an erasure tombstone is never swept'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-named'),
  'a stub carrying a real display_name is never swept'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-stub-fresh'),
  'an abandoned stub inside the 7-day grace window is not swept yet'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-departed-noauto'),
  'a departed member never stamped auto_generated survives (is_active = false departure fingerprint)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-roster-noauto'),
  'a mapping with player_roster rows is never swept, even with auto_generated = false'
);

SELECT is(
  (SELECT count(*)::integer FROM public.player_roster r
     JOIN public.player_mapping m ON m.id = r.player_mapping_id
    WHERE m.player_id = 'ps670-roster-noauto'),
  1,
  'its player_roster rows were not cascaded away'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-token-evidence'),
  'a mapping with token-sync evidence (token_burn_state) is never swept'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-synced'),
  'a mapping with on-row sync data (last_sync_at) is never swept'
);

-- The race cannot run in one session; assert FOR UPDATE SKIP LOCKED plus re-checked quals.
SELECT ok(
  (SELECT prosrc LIKE '%FOR UPDATE OF candidate SKIP LOCKED%'
     FROM pg_proc WHERE oid = 'public.prune_incomplete_player_registrations(integer)'::regprocedure),
  'candidates are locked FOR UPDATE SKIP LOCKED'
);

SELECT ok(
  (SELECT prosrc ~ 'victim\.id = ANY\(v_locked\)\s+AND public\.player_mapping_is_abandoned_registration_stub\(victim'
     FROM pg_proc WHERE oid = 'public.prune_incomplete_player_registrations(integer)'::regprocedure),
  'the DELETE re-evaluates eligibility on the locked row, not just its id'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.player_mapping_is_abandoned_registration_stub(public.player_mapping,timestamp with time zone)'::regprocedure
       AND a.grantee = 0
  ),
  'the eligibility helper is not executable by PUBLIC'
);

-- An empty function body would pass the above.

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-stub'),
  'a genuinely abandoned registration stub IS deleted'
);

-- A bare NOT LIKE fails this one.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.player_mapping WHERE player_id = 'ps670-null-name'),
  'an abandoned stub with a NULL display_name IS deleted -- the tombstone clause is NULL-safe'
);

SELECT finish();
ROLLBACK;

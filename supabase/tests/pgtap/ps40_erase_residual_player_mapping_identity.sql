-- Erasure tombstones residual player_mapping identity but keeps the pseudonymous player_id.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- With the ledger row present, a missing erasure must fail rather than skip.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260904160000'
    AND name = 'ps40_erase_residual_player_mapping_identity'
) AS ps40_not_applied \gset

\if :ps40_not_applied
SELECT plan(65);
SELECT * FROM skip(
  65,
  'this database predates PS-40; the replay lane applies the migration and executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(65);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260904160000'
      AND name = 'ps40_erase_residual_player_mapping_identity'
  ),
  1,
  'the PS-40 migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  1,
  'the erasure function retains exactly one signature'
);

SELECT is(
  (
    SELECT pg_catalog.pg_get_userbyid(function.proowner)
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  'postgres',
  'the erasure function is still owned by postgres'
);

SELECT is(
  (
    SELECT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  true,
  'the erasure function is still SECURITY DEFINER'
);

SELECT is(
  (
    SELECT function.proconfig
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  ARRAY['search_path=public'],
  'the erasure function still pins search_path=public'
);

-- Re-granting client roles on replace would be a privilege regression; the ACL stays as found.
SELECT is(
  (
    SELECT coalesce(
      array_agg(entry.grantee::regrole::text || '/' || entry.privilege_type
                ORDER BY entry.grantee::regrole::text),
      ARRAY[]::text[]
    )
    FROM pg_catalog.pg_proc AS function,
         aclexplode(function.proacl) AS entry
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  ARRAY['postgres/EXECUTE'],
  'the erasure function grants EXECUTE to postgres and nobody else'
);

SELECT ok(
  (
    SELECT pg_catalog.pg_get_functiondef(function.oid) LIKE '%[DELETED_USER_%'
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  'the erasure body writes the one shared [DELETED_USER_ tombstone prefix'
);

SELECT ok(
  (
    SELECT pg_catalog.pg_get_functiondef(function.oid) LIKE '%substr(md5(mapping.id::text), 1, 8)%'
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  'the tombstone suffix is derived from the immutable mapping id, not the clock'
);

-- Behaviour alone does not show which guard shape produced the result.
SELECT ok(
  (
    SELECT pg_catalog.pg_get_functiondef(function.oid) ~
           'mapping\.user_id IS NULL\s+AND mapping\.ownership_attestation_id IS NULL\s+AND EXISTS'
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  'the erasure carries prepare_player_account_deletion''s third predicate, guard included'
);

-- Ids never come from the sequence: it can lag max(id), and when ahead a concurrent insert takes it.
CREATE TEMP TABLE ps40_fixture_ids ON COMMIT DROP AS
SELECT GREATEST(
         coalesce((SELECT max(id) FROM public.guild_config), 0),
         coalesce(pg_sequence_last_value('public.guild_config_id_seq'::regclass), 0)
       ) + 1000 AS guild_id,
       GREATEST(
         coalesce((SELECT max(id) FROM public.player_mapping), 0),
         coalesce(pg_sequence_last_value('public.player_mapping_id_seq'::regclass), 0)
       ) + 1000 AS mapping_base,
       GREATEST(
         coalesce((SELECT max(id) FROM public.player_roster), 0),
         coalesce(pg_sequence_last_value('public.player_roster_id_seq'::regclass), 0)
       ) + 1000 AS roster_id;

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000fa40');

INSERT INTO public.guild_config (id, guild_code, display_name)
SELECT guild_id, 'PS40TAP', 'PS-40 pgTAP guild' FROM ps40_fixture_ids;

INSERT INTO public.player_mapping (
  id,
  player_id, display_name, guild_code, is_current, is_active,
  username, avatar_url, avatar_unit_id, tacticus_share_url, patreon_user_id,
  player_notes, officer_notes, original_display_name,
  tacticus_api_key_encrypted, api_key_added_at, api_key_last_verified,
  api_key_is_valid, consecutive_api_key_failures, last_api_key_failure_at,
  theme_preference, timezone, boss_preferences,
  notify_boss_kills, notify_prime_kills, notify_when_capped, has_duplicate_name
) VALUES (
  (SELECT mapping_base + 1 FROM ps40_fixture_ids),
  'PS40TAPPLAYER', 'Subject Real Name', 'PS40TAP', true, true,
  'subject_username', 'https://cdn.invalid/avatar.png', 'unit_subject',
  'https://tacticus.invalid/share/subject', 'patreon-subject-1',
  'player note authored by the subject', 'officer note naming the subject',
  'Subject Former Name',
  'ENCRYPTED_API_KEY_BLOB', now(), now(),
  false, 3, now(),
  'dark', 'America/Chicago', '{"boss":"szarekh"}'::jsonb,
  true, true, true, true
);

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-00000000fa40'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'PS40TAPPLAYER';

UPDATE public.player_mapping AS mapping
   SET user_id = '00000000-0000-0000-0000-00000000fa40',
       ownership_attestation_id = attestation.id
  FROM public.player_identity_attestations AS attestation
 WHERE attestation.mapping_id = mapping.id
   AND mapping.player_id = 'PS40TAPPLAYER';

-- B and C are reachable only by the third predicate.
INSERT INTO public.player_mapping (
  id,
  player_id, display_name, guild_code, is_current, is_active,
  username, tacticus_api_key_encrypted, api_key_is_valid,
  consecutive_api_key_failures, officer_notes
) VALUES (
  (SELECT mapping_base + 2 FROM ps40_fixture_ids),
  'PS40TAPNULLED', 'Already Nulled Subject', 'PS40TAP', true, true,
  'nulled_username', 'ENCRYPTED_API_KEY_BLOB_B', false, 2,
  'officer note on the already-nulled row'
);

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-00000000fa40'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'PS40TAPNULLED';

INSERT INTO public.player_mapping (
  id,
  player_id, display_name, guild_code, is_current, is_active,
  username, tacticus_api_key_encrypted, api_key_is_valid,
  consecutive_api_key_failures, original_display_name
) VALUES (
  (SELECT mapping_base + 3 FROM ps40_fixture_ids),
  'PS40TAPHIST', 'Historical Subject Name', 'PS40TAP', false, false,
  'hist_username', 'ENCRYPTED_API_KEY_BLOB_C', false, 1,
  'Historical Former Name'
);

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-00000000fa40'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'PS40TAPHIST';

-- player_roster cascades on delete, so a surviving roster row proves tombstoning.
INSERT INTO public.player_roster (id, player_mapping_id, rank_name)
SELECT ids.roster_id, mapping.id, 'PS-40 pgtap rank'
FROM public.player_mapping AS mapping, ps40_fixture_ids AS ids
WHERE mapping.player_id = 'PS40TAPHIST';

-- D: over-match control; an unguarded EXISTS would tombstone this re-claimed player.
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000fa41');

INSERT INTO public.player_mapping (
  id,
  player_id, display_name, guild_code, is_current, is_active,
  username, tacticus_api_key_encrypted, api_key_is_valid,
  consecutive_api_key_failures
) VALUES (
  (SELECT mapping_base + 4 FROM ps40_fixture_ids),
  'PS40TAPRECLAIM', 'Reclaimed Live Player', 'PS40TAP', true, true,
  'other_username', 'OTHER_USER_KEY_BLOB', true, 0
);

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-00000000fa41'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'PS40TAPRECLAIM';

UPDATE public.player_mapping AS mapping
   SET user_id = '00000000-0000-0000-0000-00000000fa41',
       ownership_attestation_id = attestation.id
  FROM public.player_identity_attestations AS attestation
 WHERE attestation.mapping_id = mapping.id
   AND attestation.subject_user_id = '00000000-0000-0000-0000-00000000fa41'
   AND mapping.player_id = 'PS40TAPRECLAIM';

-- Added after binding so it is not the attestation the provenance trigger checked.
INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-00000000fa40'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'PS40TAPRECLAIM';

SELECT is(
  public.revoke_all_player_identity_for_subject(
    '00000000-0000-0000-0000-00000000fa40', 'account_delete',
    '00000000-0000-0000-0000-00000000fa40', 'ps40_pgtap'
  ),
  4,
  'erasing the subject revokes all four attestations that name it (A, B, C and the stale one on the re-claimed mapping)'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.player_mapping
    WHERE player_id = 'PS40TAPPLAYER'
  ),
  1,
  'account_delete tombstones the mapping in place rather than deleting it'
);

SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  (SELECT '[DELETED_USER_' || substr(md5(id::text), 1, 8) || ']'
     FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  'display_name becomes the deterministic per-mapping tombstone'
);

SELECT ok(
  (SELECT display_name LIKE '[DELETED\_USER\_%'
     FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  'the tombstone carries the same prefix the TypeScript erasure writes'
);

SELECT is(
  (SELECT original_display_name FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'original_display_name is erased'
);
SELECT is(
  (SELECT username FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'username is erased'
);
SELECT is(
  (SELECT avatar_url FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'avatar_url is erased'
);
SELECT is(
  (SELECT avatar_unit_id FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::character varying, 'avatar_unit_id is erased'
);
SELECT is(
  (SELECT tacticus_share_url FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'tacticus_share_url is erased'
);
SELECT is(
  (SELECT patreon_user_id FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'patreon_user_id is erased'
);
SELECT is(
  (SELECT player_notes FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'player_notes is erased'
);
SELECT is(
  (SELECT officer_notes FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'officer_notes is erased'
);
SELECT is(
  (SELECT tacticus_api_key_encrypted FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'the encrypted Tacticus API key is erased'
);
SELECT is(
  (SELECT api_key_added_at FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::timestamptz, 'api_key_added_at is erased'
);
SELECT is(
  (SELECT api_key_last_verified FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::timestamptz, 'api_key_last_verified is erased'
);
SELECT is(
  (SELECT api_key_is_valid FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  true, 'api_key_is_valid returns to its no-key default'
);
SELECT is(
  (SELECT consecutive_api_key_failures FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  0, 'consecutive_api_key_failures returns to its no-key default'
);
SELECT is(
  (SELECT last_api_key_failure_at FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::timestamptz, 'last_api_key_failure_at is erased'
);
SELECT is(
  (SELECT theme_preference FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::character varying, 'theme_preference is erased'
);
SELECT is(
  (SELECT timezone FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  'UTC', 'timezone returns to its default rather than keeping a location proxy'
);
SELECT is(
  (SELECT boss_preferences FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  '{}'::jsonb, 'boss_preferences is erased'
);
SELECT is(
  (SELECT notify_boss_kills FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  false, 'notify_boss_kills returns to its default'
);
SELECT is(
  (SELECT notify_prime_kills FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  false, 'notify_prime_kills returns to its default'
);
SELECT is(
  (SELECT notify_when_capped FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  false, 'notify_when_capped returns to its default'
);
SELECT is(
  (SELECT has_duplicate_name FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  false, 'has_duplicate_name is cleared, since the tombstone is unique per mapping'
);

SELECT is(
  (SELECT user_id FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::uuid, 'user_id is still cleared'
);
SELECT is(
  (SELECT ownership_attestation_id FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::uuid, 'ownership_attestation_id is still cleared'
);
SELECT is(
  (SELECT discord_user_id FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::character varying, 'discord_user_id is still cleared'
);
SELECT is(
  (SELECT discord_username FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  NULL::text, 'discord_username is still cleared'
);
SELECT is(
  (SELECT is_app_admin FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  false, 'is_app_admin is still cleared'
);

SELECT is(
  (SELECT player_id FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  'PS40TAPPLAYER',
  'player_id survives account_delete; PS-288 keys battle-row anonymisation on it'
);

CREATE TEMP TABLE ps40_tombstone_before ON COMMIT DROP AS
SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER';

SELECT is(
  public.revoke_all_player_identity_for_subject(
    '00000000-0000-0000-0000-00000000fa40', 'account_delete',
    '00000000-0000-0000-0000-00000000fa40', 'ps40_pgtap_retry'
  ),
  0,
  'a retried erasure finds no live attestation left to revoke'
);

SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPPLAYER'),
  (SELECT display_name FROM ps40_tombstone_before),
  'the tombstone is idempotent: a retried erasure recomputes the identical value'
);

SELECT is(
  (SELECT count(*)::integer FROM public.player_mapping WHERE player_id = 'PS40TAPNULLED'),
  1, 'the already-nulled mapping is tombstoned in place, not deleted'
);
SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPNULLED'),
  (SELECT '[DELETED_USER_' || substr(md5(id::text), 1, 8) || ']'
     FROM public.player_mapping WHERE player_id = 'PS40TAPNULLED'),
  'the already-nulled mapping gets its tombstone even though user_id was already NULL'
);
SELECT is(
  (SELECT username FROM public.player_mapping WHERE player_id = 'PS40TAPNULLED'),
  NULL::text, 'the already-nulled mapping loses its username'
);
SELECT is(
  (SELECT tacticus_api_key_encrypted FROM public.player_mapping WHERE player_id = 'PS40TAPNULLED'),
  NULL::text, 'the already-nulled mapping loses its encrypted API key'
);
SELECT is(
  (SELECT officer_notes FROM public.player_mapping WHERE player_id = 'PS40TAPNULLED'),
  NULL::text, 'the already-nulled mapping loses its officer notes'
);

SELECT is(
  (SELECT count(*)::integer FROM public.player_mapping WHERE player_id = 'PS40TAPHIST'),
  1, 'the historical mapping is tombstoned in place, not deleted'
);
SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPHIST'),
  (SELECT '[DELETED_USER_' || substr(md5(id::text), 1, 8) || ']'
     FROM public.player_mapping WHERE player_id = 'PS40TAPHIST'),
  'the historical mapping is tombstoned too'
);
SELECT is(
  (SELECT tacticus_api_key_encrypted FROM public.player_mapping WHERE player_id = 'PS40TAPHIST'),
  NULL::text, 'the historical mapping loses its encrypted API key'
);
SELECT is(
  (SELECT original_display_name FROM public.player_mapping WHERE player_id = 'PS40TAPHIST'),
  NULL::text, 'the historical mapping loses its previous in-game name'
);
SELECT is(
  (SELECT is_current FROM public.player_mapping WHERE player_id = 'PS40TAPHIST'),
  false, 'the erasure does not resurrect a historical mapping'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.player_roster AS roster
    JOIN public.player_mapping AS mapping ON mapping.id = roster.player_mapping_id
    WHERE mapping.player_id = 'PS40TAPHIST'
  ),
  1,
  'the roster row on the historical mapping survives; a delete would have cascaded it away'
);

SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPRECLAIM'),
  'Reclaimed Live Player',
  'a mapping re-claimed by another user keeps its display name'
);
SELECT is(
  (SELECT tacticus_api_key_encrypted FROM public.player_mapping WHERE player_id = 'PS40TAPRECLAIM'),
  'OTHER_USER_KEY_BLOB',
  'a mapping re-claimed by another user keeps its encrypted API key'
);
SELECT is(
  (SELECT username FROM public.player_mapping WHERE player_id = 'PS40TAPRECLAIM'),
  'other_username',
  'a mapping re-claimed by another user keeps its username'
);
SELECT is(
  (SELECT user_id FROM public.player_mapping WHERE player_id = 'PS40TAPRECLAIM'),
  '00000000-0000-0000-0000-00000000fa41'::uuid,
  'a mapping re-claimed by another user keeps that user''s authority'
);

-- The set, so a wrongly tombstoned fourth row fails even if per-row checks pass.
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.player_mapping
    WHERE guild_code = 'PS40TAP'
      AND display_name LIKE '[DELETED\_USER\_%'
  ),
  3,
  'exactly three of the four fixture mappings are tombstoned'
);

-- The backfill set can be empty, so each check proves non-empty scope and a visible violation.

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.player_mapping AS mapping
    WHERE EXISTS (
      SELECT 1
      FROM public.player_identity_attestations AS attestation
      WHERE attestation.subject_user_id = '00000000-0000-0000-0000-00000000fa40'
        AND (
             mapping.user_id = attestation.subject_user_id
          OR mapping.ownership_attestation_id = attestation.id
          OR (
               mapping.user_id IS NULL
               AND mapping.ownership_attestation_id IS NULL
               AND attestation.mapping_id = mapping.id
             )
        )
    )
  ),
  3,
  'the backfill scope is non-empty: three mappings of the revoked fixture subject are in it'
);

SELECT is(
  (
  SELECT count(*)::integer
  FROM public.player_mapping AS mapping
  WHERE EXISTS (
    SELECT 1
    FROM public.player_identity_attestation_revocations AS revocation
    JOIN public.player_identity_attestations AS attestation
      ON attestation.id = revocation.attestation_id
    WHERE revocation.reason IN ('account_delete', 'gdpr_erasure')
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestations AS live
        WHERE live.subject_user_id = attestation.subject_user_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.player_identity_attestation_revocations AS live_revocation
            WHERE live_revocation.attestation_id = live.id
          )
      )
      AND (
           mapping.user_id = attestation.subject_user_id
        OR mapping.ownership_attestation_id = attestation.id
        OR (
             mapping.user_id IS NULL
             AND mapping.ownership_attestation_id IS NULL
             AND attestation.mapping_id = mapping.id
           )
      )
  )
  AND (
       mapping.display_name NOT LIKE '[DELETED\_USER\_%'
    OR mapping.username IS NOT NULL
    OR mapping.original_display_name IS NOT NULL
    OR mapping.tacticus_api_key_encrypted IS NOT NULL
    OR mapping.officer_notes IS NOT NULL
    OR mapping.player_notes IS NOT NULL
    OR mapping.avatar_url IS NOT NULL
  )),
  0,
  'no fully-revoked subject keeps a residual after the erasure and backfill'
);

-- The state the old two-predicate body left behind.
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000fa42');

INSERT INTO public.player_mapping (
  id,
  player_id, display_name, guild_code, is_current, is_active,
  username, tacticus_api_key_encrypted, api_key_is_valid, officer_notes
) VALUES (
  (SELECT mapping_base + 5 FROM ps40_fixture_ids),
  'PS40TAPRESIDUAL', 'Erased Subject Real Name', 'PS40TAP', true, true,
  'erased_username', 'ENCRYPTED_API_KEY_BLOB_BF', false,
  'officer note about the erased subject'
);

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-00000000fa42'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'PS40TAPRESIDUAL';

SELECT public.append_player_identity_revocation(
  (SELECT attestation.id FROM public.player_identity_attestations AS attestation
   JOIN public.player_mapping AS mapping ON mapping.id = attestation.mapping_id
   WHERE mapping.player_id = 'PS40TAPRESIDUAL'),
  'account_delete', NULL, 'ps40_pgtap_backfill_seed'
);

-- Positive control: without it a later 0 only proves the query is broken.
SELECT is(
  (
  SELECT count(*)::integer
  FROM public.player_mapping AS mapping
  WHERE EXISTS (
    SELECT 1
    FROM public.player_identity_attestation_revocations AS revocation
    JOIN public.player_identity_attestations AS attestation
      ON attestation.id = revocation.attestation_id
    WHERE revocation.reason IN ('account_delete', 'gdpr_erasure')
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestations AS live
        WHERE live.subject_user_id = attestation.subject_user_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.player_identity_attestation_revocations AS live_revocation
            WHERE live_revocation.attestation_id = live.id
          )
      )
      AND (
           mapping.user_id = attestation.subject_user_id
        OR mapping.ownership_attestation_id = attestation.id
        OR (
             mapping.user_id IS NULL
             AND mapping.ownership_attestation_id IS NULL
             AND attestation.mapping_id = mapping.id
           )
      )
  )
  AND (
       mapping.display_name NOT LIKE '[DELETED\_USER\_%'
    OR mapping.username IS NOT NULL
    OR mapping.original_display_name IS NOT NULL
    OR mapping.tacticus_api_key_encrypted IS NOT NULL
    OR mapping.officer_notes IS NOT NULL
    OR mapping.player_notes IS NOT NULL
    OR mapping.avatar_url IS NOT NULL
  )),
  1,
  'the invariant query detects a seeded pre-fix residual; it is not vacuous'
);

WITH revoked_subjects AS (
  SELECT DISTINCT attestation.subject_user_id
  FROM public.player_identity_attestation_revocations AS revocation
  JOIN public.player_identity_attestations AS attestation
    ON attestation.id = revocation.attestation_id
  WHERE revocation.reason IN ('account_delete', 'gdpr_erasure')
    AND NOT EXISTS (
      SELECT 1
      FROM public.player_identity_attestations AS live
      WHERE live.subject_user_id = attestation.subject_user_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.player_identity_attestation_revocations AS live_revocation
          WHERE live_revocation.attestation_id = live.id
        )
    )
), targets AS (
  SELECT DISTINCT mapping.id
  FROM public.player_mapping AS mapping
  JOIN revoked_subjects AS subject ON (
       mapping.user_id = subject.subject_user_id
    OR mapping.ownership_attestation_id IN (
         SELECT attestation.id FROM public.player_identity_attestations AS attestation
         WHERE attestation.subject_user_id = subject.subject_user_id)
    OR (
         mapping.user_id IS NULL
         AND mapping.ownership_attestation_id IS NULL
         AND EXISTS (
           SELECT 1 FROM public.player_identity_attestations AS attestation
           WHERE attestation.mapping_id = mapping.id
             AND attestation.subject_user_id = subject.subject_user_id)
       )
  )
)
UPDATE public.player_mapping AS mapping
SET user_id = NULL, ownership_attestation_id = NULL, discord_user_id = NULL,
    discord_username = NULL, is_app_admin = false,
    display_name = '[DELETED_USER_' || substr(md5(mapping.id::text), 1, 8) || ']',
    original_display_name = NULL, username = NULL, avatar_url = NULL,
    avatar_unit_id = NULL, tacticus_share_url = NULL, patreon_user_id = NULL,
    player_notes = NULL, officer_notes = NULL,
    tacticus_api_key_encrypted = NULL, api_key_added_at = NULL,
    api_key_last_verified = NULL, api_key_is_valid = true,
    consecutive_api_key_failures = 0, last_api_key_failure_at = NULL,
    theme_preference = NULL, timezone = 'UTC', boss_preferences = '{}'::jsonb,
    notify_boss_kills = false, notify_prime_kills = false,
    notify_when_capped = false, preferences_updated_at = clock_timestamp(),
    has_duplicate_name = false, updated_at = clock_timestamp()
FROM targets
WHERE mapping.id = targets.id
  AND (
       mapping.display_name NOT LIKE '[DELETED\_USER\_%'
    OR mapping.username IS NOT NULL
    OR mapping.original_display_name IS NOT NULL
    OR mapping.tacticus_api_key_encrypted IS NOT NULL
    OR mapping.officer_notes IS NOT NULL
    OR mapping.player_notes IS NOT NULL
    OR mapping.avatar_url IS NOT NULL
    OR mapping.user_id IS NOT NULL
    OR mapping.ownership_attestation_id IS NOT NULL
  );

SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPRESIDUAL'),
  (SELECT '[DELETED_USER_' || substr(md5(id::text), 1, 8) || ']'
     FROM public.player_mapping WHERE player_id = 'PS40TAPRESIDUAL'),
  'the backfill tombstones a subject erased before the apply'
);
SELECT is(
  (SELECT tacticus_api_key_encrypted FROM public.player_mapping WHERE player_id = 'PS40TAPRESIDUAL'),
  NULL::text,
  'the backfill erases that subject''s encrypted API key'
);
SELECT is(
  (
  SELECT count(*)::integer
  FROM public.player_mapping AS mapping
  WHERE EXISTS (
    SELECT 1
    FROM public.player_identity_attestation_revocations AS revocation
    JOIN public.player_identity_attestations AS attestation
      ON attestation.id = revocation.attestation_id
    WHERE revocation.reason IN ('account_delete', 'gdpr_erasure')
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestations AS live
        WHERE live.subject_user_id = attestation.subject_user_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.player_identity_attestation_revocations AS live_revocation
            WHERE live_revocation.attestation_id = live.id
          )
      )
      AND (
           mapping.user_id = attestation.subject_user_id
        OR mapping.ownership_attestation_id = attestation.id
        OR (
             mapping.user_id IS NULL
             AND mapping.ownership_attestation_id IS NULL
             AND attestation.mapping_id = mapping.id
           )
      )
  )
  AND (
       mapping.display_name NOT LIKE '[DELETED\_USER\_%'
    OR mapping.username IS NOT NULL
    OR mapping.original_display_name IS NOT NULL
    OR mapping.tacticus_api_key_encrypted IS NOT NULL
    OR mapping.officer_notes IS NOT NULL
    OR mapping.player_notes IS NOT NULL
    OR mapping.avatar_url IS NOT NULL
  )),
  0,
  'after the backfill the invariant returns to zero'
);

SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS40TAPRECLAIM'),
  'Reclaimed Live Player',
  'the backfill leaves a re-claimed live player''s mapping alone'
);

SELECT * FROM finish();
ROLLBACK;

\endif

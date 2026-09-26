-- prepare_player_account_deletion selects P1 OR P3; revoke_all_player_identity_for_subject erases
-- P1 OR P2 OR P3. P3's NULL guard spares re-claimed mappings (row D). prepare is live-only.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(15);

-- Compare prosrc: P3's guard is a shape, not an outcome.
CREATE TEMP TABLE ps328_bodies ON COMMIT DROP AS
SELECT function.proname AS fname,
       regexp_replace(
         regexp_replace(pg_catalog.pg_get_functiondef(function.oid),
                        '--[^' || chr(10) || ']*', ' ', 'g'),
         '\s+', ' ', 'g'
       ) AS normalised
FROM pg_catalog.pg_proc AS function
WHERE function.pronamespace = 'public'::regnamespace
  AND function.proname IN ('revoke_all_player_identity_for_subject',
                           'prepare_player_account_deletion');

CREATE TEMP TABLE ps328_fragments ON COMMIT DROP AS
SELECT body.fname,
       substring(body.normalised from
         'mapping\.user_id = p_user_id') AS p1,
       substring(body.normalised from
         'mapping\.ownership_attestation_id IN \( SELECT attestation\.id '
         || 'FROM public\.player_identity_attestations AS attestation '
         || 'WHERE attestation\.subject_user_id = p_user_id \)') AS p2,
       substring(body.normalised from
         'mapping\.user_id IS NULL AND mapping\.ownership_attestation_id IS NULL '
         || 'AND EXISTS \( SELECT 1 FROM public\.player_identity_attestations '
         || 'AS attestation WHERE attestation\.mapping_id = mapping\.id '
         || 'AND attestation\.subject_user_id = p_user_id \)') AS p3
FROM ps328_bodies AS body;

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'revoke_all_player_identity_for_subject'
  ),
  1,
  'the erasure retains exactly one signature'
);

SELECT isnt(
  (SELECT p1 FROM ps328_fragments
    WHERE fname = 'revoke_all_player_identity_for_subject'),
  NULL,
  'the erasure carries P1 (the mapping is bound to the subject)'
);

SELECT isnt(
  (SELECT p2 FROM ps328_fragments
    WHERE fname = 'revoke_all_player_identity_for_subject'),
  NULL,
  'the erasure carries P2 (the mapping''s ownership attestation names the subject)'
);

SELECT isnt(
  (SELECT p3 FROM ps328_fragments
    WHERE fname = 'revoke_all_player_identity_for_subject'),
  NULL,
  'the erasure carries P3 with its user_id/ownership_attestation_id guard'
);

-- Ids sit above both max(id) and the sequence, which can lag max(id).
CREATE TEMP TABLE ps328_ids ON COMMIT DROP AS
SELECT GREATEST(
         coalesce((SELECT max(id) FROM public.guild_config), 0),
         coalesce(pg_sequence_last_value('public.guild_config_id_seq'::regclass), 0)
       ) + 1000 AS guild_id,
       GREATEST(
         coalesce((SELECT max(id) FROM public.player_mapping), 0),
         coalesce(pg_sequence_last_value('public.player_mapping_id_seq'::regclass), 0)
       ) + 1000 AS mapping_base;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000328'),   -- subject 1, erased via prepare
  ('00000000-0000-0000-0000-000000000329'),   -- subject 2, erased directly
  ('00000000-0000-0000-0000-00000000032a'),   -- the re-claimer of D1
  ('00000000-0000-0000-0000-00000000032b');   -- the re-claimer of D2

INSERT INTO public.guild_config (id, guild_code, display_name)
SELECT guild_id, 'PS328TAP', 'PS-328 pgTAP guild' FROM ps328_ids;

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, is_current, is_active,
  username, tacticus_api_key_encrypted, api_key_is_valid,
  consecutive_api_key_failures
)
SELECT ids.mapping_base + spec.slot,
       spec.player_id, spec.display_name, 'PS328TAP',
       spec.is_current, spec.is_current,
       spec.username, spec.api_key, false, 1
FROM ps328_ids AS ids,
     (VALUES
        (1, 'PS328S1A', 'S1 Bound Subject',      'ps328_s1a', 'KEY_S1A', true),
        (2, 'PS328S1B', 'S1 Nulled Subject',     'ps328_s1b', 'KEY_S1B', true),
        (3, 'PS328S1C', 'S1 Historical Subject', 'ps328_s1c', 'KEY_S1C', false),
        (4, 'PS328S1D', 'S1 Reclaimed Live',     'ps328_s1d', 'KEY_S1D', true),
        (5, 'PS328S2A', 'S2 Bound Subject',      'ps328_s2a', 'KEY_S2A', true),
        (6, 'PS328S2B', 'S2 Nulled Subject',     'ps328_s2b', 'KEY_S2B', true),
        (7, 'PS328S2C', 'S2 Historical Subject', 'ps328_s2c', 'KEY_S2C', false),
        (8, 'PS328S2D', 'S2 Reclaimed Live',     'ps328_s2d', 'KEY_S2D', true)
     ) AS spec(slot, player_id, display_name, username, api_key, is_current);

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       CASE WHEN mapping.player_id LIKE 'PS328S1%'
            THEN '00000000-0000-0000-0000-000000000328'::uuid
            ELSE '00000000-0000-0000-0000-000000000329'::uuid END,
       now(), 'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.guild_code = 'PS328TAP';

UPDATE public.player_mapping AS mapping
   SET user_id = attestation.subject_user_id,
       ownership_attestation_id = attestation.id
  FROM public.player_identity_attestations AS attestation
 WHERE attestation.mapping_id = mapping.id
   AND mapping.player_id IN ('PS328S1A', 'PS328S2A');

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT mapping.id, mapping.player_id,
       CASE WHEN mapping.player_id = 'PS328S1D'
            THEN '00000000-0000-0000-0000-00000000032a'::uuid
            ELSE '00000000-0000-0000-0000-00000000032b'::uuid END,
       now(), 'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id IN ('PS328S1D', 'PS328S2D');

UPDATE public.player_mapping AS mapping
   SET user_id = attestation.subject_user_id,
       ownership_attestation_id = attestation.id
  FROM public.player_identity_attestations AS attestation
 WHERE attestation.mapping_id = mapping.id
   AND attestation.subject_user_id IN (
         '00000000-0000-0000-0000-00000000032a',
         '00000000-0000-0000-0000-00000000032b')
   AND mapping.player_id IN ('PS328S1D', 'PS328S2D');


SELECT is(
  public.revoke_all_player_identity_for_subject(
    '00000000-0000-0000-0000-000000000329', 'account_delete',
    '00000000-0000-0000-0000-000000000329', 'ps328_pgtap'
  ),
  4,
  'the erasure revokes all four attestations naming subject 2 (A, B, C and the stale one on D)'
);

SELECT set_eq(
  $q$
    SELECT right(mapping.player_id, 1)
    FROM public.player_mapping AS mapping
    WHERE mapping.player_id LIKE 'PS328S2%'
      AND mapping.display_name LIKE '[DELETED_USER_%'
  $q$,
  ARRAY['A', 'B', 'C'],
  'the erasure tombstones exactly the P1 and P3 mappings of subject 2, and not the re-claimed row'
);

SELECT is(
  (SELECT display_name FROM public.player_mapping WHERE player_id = 'PS328S2D'),
  'S2 Reclaimed Live',
  'the re-claimed mapping keeps the live player''s display name through the erasure'
);

SELECT is(
  (SELECT tacticus_api_key_encrypted FROM public.player_mapping
    WHERE player_id = 'PS328S2D'),
  'KEY_S2D',
  'the re-claimed mapping keeps the live player''s encrypted API key through the erasure'
);

-- Needs the live-only prepare function, else a named skip.
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_proc AS function
  WHERE function.pronamespace = 'public'::regnamespace
    AND function.proname = 'prepare_player_account_deletion'
) AS ps328_prepare_absent \gset

\if :ps328_prepare_absent
SELECT * FROM skip(
  7,
  'public.prepare_player_account_deletion is not defined by any migration in this repository (live-only function); point this suite at a live-shape database to execute the parity half'
);
\else

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'prepare_player_account_deletion'
  ),
  1,
  'prepare_player_account_deletion retains exactly one signature'
);

SELECT is(
  (SELECT p1 FROM ps328_fragments WHERE fname = 'prepare_player_account_deletion'),
  (SELECT p1 FROM ps328_fragments WHERE fname = 'revoke_all_player_identity_for_subject'),
  'P1 is identical in prepare''s target selection and in the erasure'
);

SELECT is(
  (SELECT p2 FROM ps328_fragments WHERE fname = 'prepare_player_account_deletion'),
  (SELECT p2 FROM ps328_fragments WHERE fname = 'revoke_all_player_identity_for_subject'),
  'P2 is identical in prepare''s residual-authority assertion and in the erasure'
);

SELECT is(
  (SELECT p3 FROM ps328_fragments WHERE fname = 'prepare_player_account_deletion'),
  (SELECT p3 FROM ps328_fragments WHERE fname = 'revoke_all_player_identity_for_subject'),
  'P3, guard included, is identical in prepare''s target selection and in the erasure'
);

CREATE TEMP TABLE ps328_prepare_result ON COMMIT DROP AS
SELECT public.prepare_player_account_deletion(
         '00000000-0000-0000-0000-000000000328', 'account_delete'
       ) AS payload;

-- Compare with tombstones from the same run; across runs both would move and stay green.
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.player_mapping AS mapping
    WHERE mapping.player_id LIKE 'PS328S1%'
      AND mapping.display_name LIKE '[DELETED_USER_%'
  ),
  (SELECT (payload ->> 'cleared_mapping_count')::integer FROM ps328_prepare_result),
  'every mapping prepare counts as cleared is a mapping the erasure actually tombstoned'
);

SELECT set_eq(
  $q$
    SELECT right(mapping.player_id, 1)
    FROM public.player_mapping AS mapping
    WHERE mapping.player_id LIKE 'PS328S1%'
      AND mapping.display_name LIKE '[DELETED_USER_%'
  $q$,
  ARRAY['A', 'B', 'C'],
  'prepare clears the same three roles the erasure tombstones on its own (assertion 6)'
);

SELECT is(
  (SELECT display_name || '|' || tacticus_api_key_encrypted
     FROM public.player_mapping WHERE player_id = 'PS328S1D'),
  'S1 Reclaimed Live|KEY_S1D',
  'prepare leaves the re-claimed mapping''s name and encrypted API key intact'
);

\endif

SELECT * FROM finish();
ROLLBACK;

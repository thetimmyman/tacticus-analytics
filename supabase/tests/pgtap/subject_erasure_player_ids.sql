-- Erasure reaches departed players and refuses every ambiguous one: anonymisation is irreversible.
-- target-db: general. On a database without the 20260925010500 and
-- 20260925040000 ledger rows, every assertion is a reviewed skip.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT NOT (
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260925010500'
      AND name = 'ps670_subject_erasure_player_ids'
  )
  AND EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260925040000'
      AND name = 'ps670_anonymize_subject_battle_rows'
  )
) AS tp670e_not_applied
\gset

\if :tp670e_not_applied
SELECT plan(39);
SELECT * FROM skip(
  39,
  'this database does not carry the departed-member erasure migrations 20260925010500 + 20260925040000 (target-db: general); the departed-member erasure contract executes once the migration is applied and ledgered'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(39);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260925010500' AND name = 'ps670_subject_erasure_player_ids'),
  1,
  'the ps670_subject_erasure_player_ids erasure-ids migration is recorded exactly once'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = to_regprocedure('public.subject_erasure_player_ids(uuid)')
      AND fn.prosecdef
      AND pg_catalog.pg_get_userbyid(fn.proowner) = 'postgres'
      AND fn.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND fn.provolatile = 's'
  ),
  'subject_erasure_player_ids(uuid) is a postgres-owned STABLE SECURITY DEFINER with a pinned search_path'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.subject_erasure_player_ids(uuid)', 'EXECUTE'),
  'anon cannot execute subject_erasure_player_ids'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.subject_erasure_player_ids(uuid)', 'EXECUTE'),
  'authenticated cannot execute subject_erasure_player_ids (no user can list another subject''s players)'
);
SELECT ok(
  has_function_privilege('service_role', 'public.subject_erasure_player_ids(uuid)', 'EXECUTE'),
  'service_role (the erasure caller) holds EXECUTE on subject_erasure_player_ids'
);
SELECT is(
  (SELECT count(*)::integer FROM public.subject_erasure_player_ids(NULL)),
  0,
  'a NULL subject returns nothing'
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000067a0'),   -- S, the subject
  ('00000000-0000-0000-0000-0000000067a1');   -- O, another existing user
-- G = '00000000-0000-0000-0000-0000000067a2' is deliberately NOT in auth.users.

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('TP670E', 'Test erasure pgTAP guild');

INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, is_current, is_active)
SELECT 'TP670E_' || v.label, 'tp670e ' || v.label, 'TP670E', v.cur, v.cur
FROM (VALUES
  (1, 'CUR', true), (2, 'DEP', false), (3, 'MOVE', false),
  (4, 'GUILDDEL', false), (5, 'CORR', false), (6, 'UNLINK', false),
  (7, 'REVERIFY', false), (8, 'RECOVERY', false), (9, 'MAPDEL', false),
  (10, 'RECLAIM', true), (11, 'HANDOFF', false), (12, 'HANDOFF_GONE', false),
  (13, 'HANDOFF_DISPUTED', false), (14, 'HANDOFF_DEPARTED', false)
) AS v(n, label, cur);

INSERT INTO public.player_identity_attestations
  (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-0000000067a0'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id LIKE 'TP670E\_%'
  AND mapping.player_id <> 'TP670E_RECLAIM';

UPDATE public.player_mapping AS mapping
   SET user_id = '00000000-0000-0000-0000-0000000067a0',
       ownership_attestation_id = attestation.id
  FROM public.player_identity_attestations AS attestation
 WHERE attestation.mapping_id = mapping.id
   AND attestation.subject_user_id = '00000000-0000-0000-0000-0000000067a0'
   AND mapping.player_id = 'TP670E_CUR';

INSERT INTO public.player_identity_attestations
  (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-0000000067a1'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'TP670E_RECLAIM';

UPDATE public.player_mapping AS mapping
   SET user_id = '00000000-0000-0000-0000-0000000067a1',
       ownership_attestation_id = attestation.id
  FROM public.player_identity_attestations AS attestation
 WHERE attestation.mapping_id = mapping.id
   AND attestation.subject_user_id = '00000000-0000-0000-0000-0000000067a1'
   AND mapping.player_id = 'TP670E_RECLAIM';

INSERT INTO public.player_identity_attestations
  (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT mapping.id, mapping.player_id,
       '00000000-0000-0000-0000-0000000067a0'::uuid, now(),
       'operator_quarantine_restore'
FROM public.player_mapping AS mapping
WHERE mapping.player_id = 'TP670E_RECLAIM';

INSERT INTO public.player_identity_attestations
  (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT mapping.id, mapping.player_id, v.subject, now(), 'operator_quarantine_restore'
FROM public.player_mapping AS mapping
JOIN (VALUES
  ('TP670E_HANDOFF',          '00000000-0000-0000-0000-0000000067a1'::uuid),
  ('TP670E_HANDOFF_GONE',     '00000000-0000-0000-0000-0000000067a2'::uuid),
  ('TP670E_HANDOFF_DISPUTED', '00000000-0000-0000-0000-0000000067a1'::uuid),
  ('TP670E_HANDOFF_DEPARTED', '00000000-0000-0000-0000-0000000067a1'::uuid)
) AS v(player_id, subject) ON v.player_id = mapping.player_id;

-- One revocation per attestation (UNIQUE on attestation_id).
SELECT public.append_player_identity_revocation(attestation.id, v.reason, NULL, v.source)
FROM public.player_identity_attestations AS attestation
JOIN (VALUES
  ('TP670E_DEP',      'roster_deactivation',  'edge.db-mappings.mark-absent'),
  ('TP670E_MOVE',     'player_id_correction', 'profile/change-player-id'),
  ('TP670E_GUILDDEL', 'guild_delete',         'tp670_pgtap_guild_delete'),
  ('TP670E_CORR',     'player_id_correction', 'tp670_pgtap_operator_fix'),
  ('TP670E_UNLINK',   'admin_unlink',         'admin/unlink-player'),
  ('TP670E_REVERIFY', 'support_reverify',     'tp670_pgtap_support'),
  ('TP670E_RECOVERY', 'authority_recovery',   'tp670_pgtap_support'),
  ('TP670E_MAPDEL',   'mapping_delete',       'tp670_pgtap_mapping_delete'),
  ('TP670E_HANDOFF_DEPARTED', 'roster_deactivation', 'edge.db-mappings.mark-absent')
) AS v(player_id, reason, source) ON v.player_id = attestation.player_id
WHERE attestation.subject_user_id = '00000000-0000-0000-0000-0000000067a0';

-- user_id is NULL here, so a "different live owner" guard alone would let S's erasure through.
SELECT public.append_player_identity_revocation(attestation.id, 'roster_deactivation', NULL, 'edge.db-mappings.mark-absent')
FROM public.player_identity_attestations AS attestation
WHERE attestation.player_id = 'TP670E_HANDOFF_DEPARTED'
  AND attestation.subject_user_id = '00000000-0000-0000-0000-0000000067a1';

SELECT public.append_player_identity_revocation(attestation.id, 'admin_unlink', NULL, 'admin/unlink-player')
FROM public.player_identity_attestations AS attestation
WHERE attestation.player_id = 'TP670E_HANDOFF_DISPUTED'
  AND attestation.subject_user_id = '00000000-0000-0000-0000-0000000067a1';

CREATE TEMP TABLE tp670e_s ON COMMIT DROP AS
SELECT player_id FROM public.subject_erasure_player_ids('00000000-0000-0000-0000-0000000067a0')
WHERE player_id LIKE 'TP670E\_%';
CREATE TEMP TABLE tp670e_o ON COMMIT DROP AS
SELECT player_id FROM public.subject_erasure_player_ids('00000000-0000-0000-0000-0000000067a1')
WHERE player_id LIKE 'TP670E\_%';

SELECT is(
  (SELECT array_agg(player_id ORDER BY player_id) FROM public.player_mapping
    WHERE user_id = '00000000-0000-0000-0000-0000000067a0'
      AND player_id LIKE 'TP670E\_%'),
  ARRAY['TP670E_CUR']::text[],
  'POSITIVE CONTROL: the pre-migration user_id-only predicate returns CUR alone and misses every departed player'
);

SELECT is(
  (SELECT array_agg(player_id ORDER BY player_id) FROM tp670e_s),
  ARRAY['TP670E_CUR', 'TP670E_DEP', 'TP670E_GUILDDEL', 'TP670E_HANDOFF_DISPUTED',
        'TP670E_HANDOFF_GONE', 'TP670E_MOVE']::text[],
  'S gets exactly the six players that are provably S''s'
);

SELECT ok('TP670E_DEP' IN (SELECT player_id FROM tp670e_s),
  'departed player (user_id NULL, attestation revoked on departure) is erased');
SELECT ok('TP670E_MOVE' IN (SELECT player_id FROM tp670e_s),
  'self-service player-id move (player_id_correction from profile/change-player-id) is ownership-preserving: the earlier player is erased');
SELECT ok('TP670E_GUILDDEL' IN (SELECT player_id FROM tp670e_s),
  'guild_delete does not dispute ownership: the player is erased');
SELECT ok('TP670E_CORR' NOT IN (SELECT player_id FROM tp670e_s),
  'operator player_id_correction (any other source) disputes ownership: excluded');
SELECT ok('TP670E_UNLINK' NOT IN (SELECT player_id FROM tp670e_s),
  'admin_unlink disputes ownership: excluded');
SELECT ok('TP670E_REVERIFY' NOT IN (SELECT player_id FROM tp670e_s),
  'support_reverify disputes ownership: excluded');
SELECT ok('TP670E_RECOVERY' NOT IN (SELECT player_id FROM tp670e_s),
  'authority_recovery disputes ownership: excluded');
SELECT ok('TP670E_MAPDEL' NOT IN (SELECT player_id FROM tp670e_s),
  'mapping_delete is treated as a dispute: excluded');
SELECT ok('TP670E_RECLAIM' NOT IN (SELECT player_id FROM tp670e_s),
  'a player now bound to a different live user is excluded (over-match control)');
SELECT ok('TP670E_HANDOFF' NOT IN (SELECT player_id FROM tp670e_s),
  'A->B handoff: another existing subject holds a non-disputed attestation, so S''s erasure does not touch it');
SELECT ok('TP670E_HANDOFF' NOT IN (SELECT player_id FROM tp670e_o),
  'A->B handoff is excluded for the other subject too (ambiguous either way)');
SELECT ok('TP670E_HANDOFF_DEPARTED' NOT IN (SELECT player_id FROM tp670e_s),
  'O reclaimed S''s former player and then departed too (no live owner): O''s surviving non-disputed attestation still excludes it from S''s erasure');
SELECT ok('TP670E_HANDOFF_DEPARTED' NOT IN (SELECT player_id FROM tp670e_o),
  'the doubly-departed player is excluded from O''s erasure as well');
SELECT ok('TP670E_HANDOFF_GONE' IN (SELECT player_id FROM tp670e_s),
  'a co-attesting subject that no longer exists in auth.users does not block the erasure');
SELECT ok('TP670E_HANDOFF_DISPUTED' IN (SELECT player_id FROM tp670e_s),
  'a co-attesting subject whose own claim is disputed does not block the erasure');
SELECT ok('TP670E_HANDOFF_DISPUTED' NOT IN (SELECT player_id FROM tp670e_o),
  'the disputed co-attestor does not get the player either');
SELECT is(
  (SELECT array_agg(player_id ORDER BY player_id) FROM tp670e_o),
  ARRAY['TP670E_RECLAIM']::text[],
  'O gets exactly the player O owns now'
);

SET LOCAL ROLE service_role;
SELECT coalesce(string_agg(player_id, ',' ORDER BY player_id), '') AS tp670e_as_service
FROM public.subject_erasure_player_ids('00000000-0000-0000-0000-0000000067a0')
WHERE player_id LIKE 'TP670E\_%'
\gset
RESET ROLE;

SELECT is(
  :'tp670e_as_service'::text,
  'TP670E_CUR,TP670E_DEP,TP670E_GUILDDEL,TP670E_HANDOFF_DISPUTED,TP670E_HANDOFF_GONE,TP670E_MOVE'::text,
  'executed AS service_role, the function returns the same six players'
);

-- The two-session race cannot run inside pgTAP.
SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260925040000' AND name = 'ps670_anonymize_subject_battle_rows'),
  1,
  'the ps670_anonymize_subject_battle_rows atomic-anonymisation migration is recorded exactly once'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = to_regprocedure('public.anonymize_subject_battle_rows(uuid)')
      AND fn.prosecdef
      AND pg_catalog.pg_get_userbyid(fn.proowner) = 'postgres'
      AND fn.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND fn.provolatile = 'v'
  ),
  'anonymize_subject_battle_rows(uuid) is a postgres-owned VOLATILE SECURITY DEFINER with a pinned search_path'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.anonymize_subject_battle_rows(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.anonymize_subject_battle_rows(uuid)', 'EXECUTE'),
  'no client role can execute anonymize_subject_battle_rows'
);
SELECT ok(
  has_function_privilege('service_role', 'public.anonymize_subject_battle_rows(uuid)', 'EXECUTE'),
  'service_role (the erasure caller) holds EXECUTE on anonymize_subject_battle_rows'
);

SELECT ok(
  (SELECT fn.prosrc ~ 'FOR SHARE'
          AND (SELECT count(*) FROM regexp_matches(fn.prosrc, 'subject_erasure_player_ids\(p_user_id\)', 'g')) = 2
     FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = to_regprocedure('public.anonymize_subject_battle_rows(uuid)')),
  'the body row-locks the resolved players'' mappings (FOR SHARE) and re-resolves under the lock before updating'
);

SELECT throws_ok(
  'SELECT public.anonymize_subject_battle_rows(NULL)',
  '22004',
  NULL,
  'a NULL subject is refused, not treated as "nobody"'
);

INSERT INTO public."EOT_GR_data" ("Guild", "userId", "displayName")
SELECT 'TP670E', mapping.player_id, 'tp670e keep'
FROM public.player_mapping AS mapping
WHERE mapping.player_id LIKE 'TP670E\_%';

SET LOCAL ROLE service_role;
SELECT public.anonymize_subject_battle_rows('00000000-0000-0000-0000-0000000067a0') AS tp670e_anonymized
\gset
RESET ROLE;

SELECT is(
  :tp670e_anonymized::integer,
  6,
  'executed AS service_role, it reports exactly the six rows of S''s six erasable players'
);
SELECT is(
  (SELECT array_agg("userId" ORDER BY "userId") FROM public."EOT_GR_data"
    WHERE "Guild" = 'TP670E' AND "displayName" <> 'tp670e keep'),
  (SELECT array_agg(player_id ORDER BY player_id) FROM tp670e_s),
  'the rows it tombstoned are exactly subject_erasure_player_ids(S)'
);
SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data"
    WHERE "Guild" = 'TP670E' AND "displayName" = 'tp670e keep'),
  (SELECT count(*)::integer FROM public.player_mapping
    WHERE player_id LIKE 'TP670E\_%') - 6,
  'every other fixture player (disputed, reclaimed, handoffs) keeps its name'
);
SELECT ok(
  (SELECT bool_and("displayName" ~ '^\[DELETED_USER_[0-9]+\]$') FROM public."EOT_GR_data"
    WHERE "Guild" = 'TP670E' AND "displayName" <> 'tp670e keep'),
  'the tombstone keeps the [DELETED_USER_<epoch-ms>] shape the app wrote before'
);

SELECT is(
  (SELECT array_agg(player_key ORDER BY player_key) FROM public.battle_row_erasures
    WHERE player_key LIKE 'tp670e\_%'),
  (SELECT array_agg(lower(btrim(player_id)) ORDER BY lower(btrim(player_id))) FROM tp670e_s),
  'the erasure recorded exactly subject_erasure_player_ids(S) in battle_row_erasures'
);

INSERT INTO public."EOT_GR_data" ("Guild", "userId", "displayName", "Season", "completedOn", "damageDealt")
SELECT 'TP670E-REINSERT', player_id, 'real upstream name', '1', '2000-01-01T00:00:00Z', 1
FROM tp670e_s;

SELECT ok(
  (SELECT bool_and("displayName" ~ '^\[DELETED_USER_[0-9]{13}\]$') FROM public."EOT_GR_data"
    WHERE "Guild" = 'TP670E-REINSERT'),
  'a pre-erasure battle re-inserted for an erased player is written with the tombstone'
);

SELECT is(
  public.anonymize_subject_battle_rows('00000000-0000-0000-0000-000000000000'),
  0,
  'a subject with no players anonymises nothing'
);

SELECT * FROM finish();
ROLLBACK;
\endif

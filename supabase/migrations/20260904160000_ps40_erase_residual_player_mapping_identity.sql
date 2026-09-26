-- Account erasure tombstones every residual identity column on the subject's
-- player_mapping rows, not just the authority columns; rows stay (player_roster cascades).
-- target-db: general
-- Same three predicates as prepare_player_account_deletion, the third guarded so a
-- re-claimed mapping is untouched. player_id stays as the pseudonymous battle key.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-40 migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$$;

-- The body is live verbatim above the marked block inside the UPDATE.
CREATE OR REPLACE FUNCTION public.revoke_all_player_identity_for_subject(p_user_id uuid, p_reason text, p_actor_user_id uuid, p_source text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attestation record;
  v_revoked integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_reason NOT IN ('account_delete', 'gdpr_erasure')
    OR p_source IS NULL OR length(btrim(p_source)) < 3
    OR length(p_source) > 120
  THEN
    RAISE EXCEPTION 'Invalid subject-wide identity revocation request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(6208, hashtext(p_user_id::text));
  FOR v_attestation IN
    SELECT attestation.id
    FROM public.player_identity_attestations AS attestation
    WHERE attestation.subject_user_id = p_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestation_revocations AS revoked
        WHERE revoked.attestation_id = attestation.id
      )
    ORDER BY attestation.id
    FOR UPDATE
  LOOP
    PERFORM public.append_player_identity_revocation(
      v_attestation.id, p_reason, p_actor_user_id, p_source
    );
    v_revoked := v_revoked + 1;
  END LOOP;

  -- Clear current and inactive attachments after every subject attestation is
  -- revoked. The ownership trigger observes the revocations in this transaction.
  UPDATE public.player_mapping AS mapping
  SET user_id = NULL,
      ownership_attestation_id = NULL,
      discord_user_id = NULL,
      discord_username = NULL,
      is_app_admin = false,
      -- PS-40: the five columns above end the subject's AUTHORITY over the
      -- row. The columns below end the subject's PRESENCE in it. Without
      -- them, a deleted account leaves its name, avatar, notes and encrypted
      -- Tacticus API key sitting in the roster slot forever, because the
      -- account_delete branch of prepare_player_account_deletion keeps the
      -- row instead of deleting it.
      --
      -- display_name is NOT NULL, so it is tombstoned rather than nulled.
      -- The prefix is the one the TypeScript half already writes into
      -- "EOT_GR_data".displayName and the PS-212/PS-288 tests match on; the
      -- md5 suffix is derived from the immutable mapping id, so a retried
      -- erasure recomputes the identical value (idempotent) and no two
      -- tombstones collide (no manufactured duplicate names).
      display_name = '[DELETED_USER_'
                     || substr(md5(mapping.id::text), 1, 8) || ']',
      original_display_name = NULL,
      username = NULL,
      avatar_url = NULL,
      avatar_unit_id = NULL,
      tacticus_share_url = NULL,
      patreon_user_id = NULL,
      player_notes = NULL,
      officer_notes = NULL,
      -- The credential and its whole verification history. api_key_is_valid
      -- and consecutive_api_key_failures are NOT nulled but reset to their
      -- column defaults, which is the state of a row that has never held a
      -- key -- consecutive_api_key_failures is NOT NULL and cannot be nulled.
      tacticus_api_key_encrypted = NULL,
      api_key_added_at = NULL,
      api_key_last_verified = NULL,
      api_key_is_valid = true,
      consecutive_api_key_failures = 0,
      last_api_key_failure_at = NULL,
      -- Personal preferences, back to their column defaults.
      theme_preference = NULL,
      timezone = 'UTC',
      boss_preferences = '{}'::jsonb,
      notify_boss_kills = false,
      notify_prime_kills = false,
      notify_when_capped = false,
      preferences_updated_at = clock_timestamp(),
      -- Derived from display_name, which is now unique per mapping id.
      has_duplicate_name = false,
      updated_at = clock_timestamp()
  -- PS-40 F1: THREE predicates, not two. The first two are this function's
  -- own, verbatim. The third is prepare_player_account_deletion's, copied
  -- verbatim from its live body -- including its guard, which is not optional.
  --
  -- Without it the erasure misses every mapping whose AUTHORITY columns are
  -- already NULL but whose attestation still names the subject. Those rows are
  -- exactly the ones prepare_player_account_deletion counts as the subject's
  -- (cleared_mapping_count) and, on gdpr_erasure, DELETES -- so before this
  -- fix the two functions disagreed about which rows belong to the subject,
  -- and the account_delete path would report a mapping cleared while it kept
  -- its display name, username and encrypted API key. Measured on the General
  -- primary 2026-09-05: 4 mappings sit in that shape today, one carrying a
  -- 130-character tacticus_api_key_encrypted. All four belong to LIVE users
  -- (auth user present, no erasure revocation), so the defect is what happens
  -- when one of them deletes, not a residual sitting there now.
  --
  -- THE GUARD IS THE SAFETY PROPERTY. `user_id IS NULL AND
  -- ownership_attestation_id IS NULL` is what keeps this from erasing a
  -- stranger. A mapping the subject once held and ANOTHER user has since
  -- legitimately re-claimed still carries the subject's historical
  -- attestation; an unguarded EXISTS would tombstone that live player's name
  -- and null their API key. prepare_player_account_deletion states the same
  -- rule in its own words ("a delayed GDPR retry must never purge a credential
  -- uploaded after the mapping was legitimately re-claimed by someone else"),
  -- and the VERIFY block below carries a re-claimed fixture mapping that must
  -- come through untouched.
  WHERE mapping.user_id = p_user_id
     OR mapping.ownership_attestation_id IN (
       SELECT attestation.id
       FROM public.player_identity_attestations AS attestation
       WHERE attestation.subject_user_id = p_user_id
     )
     OR (
       mapping.user_id IS NULL
       AND mapping.ownership_attestation_id IS NULL
       AND EXISTS (
         SELECT 1
         FROM public.player_identity_attestations AS attestation
         WHERE attestation.mapping_id = mapping.id
           AND attestation.subject_user_id = p_user_id
       )
     );

  RETURN v_revoked;
END
$function$;

ALTER FUNCTION public.revoke_all_player_identity_for_subject(uuid, text, uuid, text)
  OWNER TO postgres;

-- One-time idempotent backfill for revoked subjects erased before this. It applies
-- the SET list directly: the function would revoke a re-claimed subject's attestations.
DO $backfill$
DECLARE
  v_count integer;
  v_role text := current_user;
BEGIN
  -- prevent_privilege_column_self_escalation returns early only for server
  -- authority. Fail with a sentence rather than a bare 42501 from a trigger.
  IF v_role NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'PS-40 backfill requires server authority; current_user is %', v_role;
  END IF;

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
           SELECT attestation.id
           FROM public.player_identity_attestations AS attestation
           WHERE attestation.subject_user_id = subject.subject_user_id
         )
      OR (
           mapping.user_id IS NULL
           AND mapping.ownership_attestation_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM public.player_identity_attestations AS attestation
             WHERE attestation.mapping_id = mapping.id
               AND attestation.subject_user_id = subject.subject_user_id
           )
         )
    )
  )
  UPDATE public.player_mapping AS mapping
  SET user_id = NULL,
      ownership_attestation_id = NULL,
      discord_user_id = NULL,
      discord_username = NULL,
      is_app_admin = false,
      display_name = '[DELETED_USER_'
                     || substr(md5(mapping.id::text), 1, 8) || ']',
      original_display_name = NULL,
      username = NULL,
      avatar_url = NULL,
      avatar_unit_id = NULL,
      tacticus_share_url = NULL,
      patreon_user_id = NULL,
      player_notes = NULL,
      officer_notes = NULL,
      tacticus_api_key_encrypted = NULL,
      api_key_added_at = NULL,
      api_key_last_verified = NULL,
      api_key_is_valid = true,
      consecutive_api_key_failures = 0,
      last_api_key_failure_at = NULL,
      theme_preference = NULL,
      timezone = 'UTC',
      boss_preferences = '{}'::jsonb,
      notify_boss_kills = false,
      notify_prime_kills = false,
      notify_when_capped = false,
      preferences_updated_at = clock_timestamp(),
      has_duplicate_name = false,
      updated_at = clock_timestamp()
  FROM targets
  WHERE mapping.id = targets.id
    -- Idempotence: only rows that still carry something.
    AND (
         mapping.display_name NOT LIKE '[DELETED\_USER\_%'
      OR mapping.original_display_name IS NOT NULL
      OR mapping.username IS NOT NULL
      OR mapping.avatar_url IS NOT NULL
      OR mapping.avatar_unit_id IS NOT NULL
      OR mapping.tacticus_share_url IS NOT NULL
      OR mapping.patreon_user_id IS NOT NULL
      OR mapping.player_notes IS NOT NULL
      OR mapping.officer_notes IS NOT NULL
      OR mapping.tacticus_api_key_encrypted IS NOT NULL
      OR mapping.api_key_added_at IS NOT NULL
      OR mapping.api_key_last_verified IS NOT NULL
      OR mapping.api_key_is_valid IS DISTINCT FROM true
      OR mapping.consecutive_api_key_failures <> 0
      OR mapping.last_api_key_failure_at IS NOT NULL
      OR mapping.theme_preference IS NOT NULL
      OR mapping.timezone IS DISTINCT FROM 'UTC'
      OR mapping.boss_preferences IS DISTINCT FROM '{}'::jsonb
      OR mapping.notify_boss_kills
      OR mapping.notify_prime_kills
      OR mapping.notify_when_capped
      OR mapping.has_duplicate_name
      OR mapping.user_id IS NOT NULL
      OR mapping.ownership_attestation_id IS NOT NULL
      OR mapping.discord_user_id IS NOT NULL
      OR mapping.discord_username IS NOT NULL
      OR mapping.is_app_admin
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'PS-40 backfill: % mapping(s) of already-revoked subjects tombstoned (0 is the expected count on both databases as measured 2026-09-05)', v_count;
END $backfill$;

DO $verify$
DECLARE
  v_acl text[];
  v_prosecdef boolean;
  v_proconfig text[];
  v_owner text;
  v_user_id uuid := '00000000-0000-0000-0000-00000000ff40';
  v_other_id uuid := '00000000-0000-0000-0000-00000000ff41';
  v_guild text := 'PS40VERIFY';
  v_mapping_id integer;          -- A: current, owned by the subject
  v_nulled_id integer;           -- B: current, authority already NULL
  v_historical_id integer;       -- C: is_current = false
  v_reclaimed_id integer;        -- D: re-claimed by ANOTHER user
  v_attestation_id uuid;
  v_revoked integer;
  v_row public.player_mapping%ROWTYPE;
  v_residual text;
  v_label text;
  v_case record;
  v_roster_id bigint;
  v_residual_rows integer;
  v_guild_id integer;
  v_mapping_base integer;
  v_roster_pk bigint;
BEGIN
  -- 1. The function still has exactly the live ACL, owner, security mode and
  --    pinned search_path. CREATE OR REPLACE must not have widened any of
  --    them.
  SELECT coalesce(array_agg(a.grantee::regrole::text || '/' || a.privilege_type
                            ORDER BY a.grantee::regrole::text), ARRAY[]::text[]),
         p.prosecdef, p.proconfig, p.proowner::regrole::text
  INTO v_acl, v_prosecdef, v_proconfig, v_owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
  WHERE n.nspname = 'public'
    AND p.proname = 'revoke_all_player_identity_for_subject'
  GROUP BY p.prosecdef, p.proconfig, p.proowner;

  IF v_acl IS DISTINCT FROM ARRAY['postgres/EXECUTE'] THEN
    RAISE EXCEPTION 'PS-40 verify: function ACL changed -- expected {postgres/EXECUTE}, got %', v_acl;
  END IF;
  IF v_prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PS-40 verify: function is no longer SECURITY DEFINER (prosecdef=%)', v_prosecdef;
  END IF;
  IF v_proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'PS-40 verify: pinned search_path changed (proconfig=%)', v_proconfig;
  END IF;
  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'PS-40 verify: function owner changed (owner=%)', v_owner;
  END IF;

  -- 1b. After the backfill, no fully-revoked subject's mapping keeps a
  --     residual. On both databases this set is empty today, so this assertion
  --     is a STANDING invariant rather than a measurement of work done; the
  --     pgTAP suite pairs it with a seeded violation so the query cannot pass
  --     vacuously.
  SELECT count(*) INTO v_residual_rows
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
  );
  IF v_residual_rows <> 0 THEN
    RAISE EXCEPTION 'PS-40 verify: % mapping(s) of fully-revoked subjects still carry residual identity after the backfill', v_residual_rows;
  END IF;

  -- 2. Erase a fixture subject through the real function and assert the whole
  --    post-erasure row shape, across ALL THREE predicates the erasure must
  --    match, plus a fourth mapping that it must NOT match. The fixture is
  --    built and destroyed inside this block's own subtransaction, so the
  --    migration commits no fixture rows.
  BEGIN
    -- FIXTURE IDS ARE COMPUTED, NEVER TAKEN FROM A SEQUENCE.
    --
    -- public.guild_config's id sequence is BELOW max(id) on the General
    -- primary: last_value 856 against max(id) 1599, measured 2026-09-05. A
    -- fixture INSERT that lets the sequence assign the id therefore draws a
    -- value that may already be taken -- 64 of the next 743 are -- and the
    -- apply dies on guild_config_pkey. That is not hypothetical: a rehearsal
    -- of the previous revision of this migration aborted with
    --
    --   ERROR:  duplicate key value violates unique constraint "guild_config_pkey"
    --   DETAIL:  Key (id)=(857) already exists.
    --
    -- The drift itself predates this migration and is filed separately. This
    -- fixture simply must not depend on it, so every fixture id is derived at
    -- run time from GREATEST(max(id), the sequence's last_value) + 1000. The
    -- max alone is not enough: where the sequence is AHEAD of max(id), which
    -- is the ordinary case, that is the value a concurrent insert would take.
    -- Nothing here advances any sequence, and the whole fixture is rolled back.
    SELECT GREATEST(
             coalesce((SELECT max(id) FROM public.guild_config), 0),
             coalesce(pg_sequence_last_value('public.guild_config_id_seq'::regclass), 0)
           ) + 1000 INTO v_guild_id;
    SELECT GREATEST(
             coalesce((SELECT max(id) FROM public.player_mapping), 0),
             coalesce(pg_sequence_last_value('public.player_mapping_id_seq'::regclass), 0)
           ) + 1000 INTO v_mapping_base;
    SELECT GREATEST(
             coalesce((SELECT max(id) FROM public.player_roster), 0),
             coalesce(pg_sequence_last_value('public.player_roster_id_seq'::regclass), 0)
           ) + 1000 INTO v_roster_pk;

    INSERT INTO auth.users (id) VALUES (v_user_id), (v_other_id);
    INSERT INTO public.guild_config (id, guild_code, display_name)
      VALUES (v_guild_id, v_guild, 'PS-40 verify guild');

    -- A -- current, owned by the subject. Matched by predicate 1
    -- (mapping.user_id = p_user_id). Explicit column lists throughout:
    -- player_mapping has defaulted and derived columns and must never be
    -- inserted positionally.
    INSERT INTO public.player_mapping (
      id,
      player_id, display_name, guild_code, is_current, is_active,
      username, avatar_url, avatar_unit_id, tacticus_share_url, patreon_user_id,
      player_notes, officer_notes, original_display_name,
      tacticus_api_key_encrypted, api_key_added_at, api_key_last_verified,
      api_key_is_valid, consecutive_api_key_failures, last_api_key_failure_at,
      theme_preference, timezone, boss_preferences,
      notify_boss_kills, notify_prime_kills, notify_when_capped,
      has_duplicate_name
    ) VALUES (
      v_mapping_base + 1,
      'PS40VERIFYPLAYER', 'Subject Real Name', v_guild, true, true,
      'subject_username', 'https://cdn.invalid/avatar.png', 'unit_subject',
      'https://tacticus.invalid/share/subject', 'patreon-subject-1',
      'player note authored by the subject', 'officer note naming the subject',
      'Subject Former Name',
      'ENCRYPTED_API_KEY_BLOB', now(), now(),
      false, 3, now(),
      'dark', 'America/Chicago', '{"boss":"szarekh"}'::jsonb,
      true, true, true,
      true
    ) RETURNING id INTO v_mapping_id;

    INSERT INTO public.player_identity_attestations (
      mapping_id, player_id, subject_user_id, consumed_at, source
    ) VALUES (
      v_mapping_id, 'PS40VERIFYPLAYER', v_user_id, now(),
      'operator_quarantine_restore'
    ) RETURNING id INTO v_attestation_id;

    UPDATE public.player_mapping
       SET user_id = v_user_id,
           ownership_attestation_id = v_attestation_id
     WHERE id = v_mapping_id;

    -- B -- current, but user_id and ownership_attestation_id are ALREADY NULL
    -- while an attestation still names the subject. Matched ONLY by the third
    -- predicate. This is the row class the pre-F1 body missed, and the class
    -- prepare_player_account_deletion counts as the subject's.
    INSERT INTO public.player_mapping (
      id,
      player_id, display_name, guild_code, is_current, is_active,
      username, tacticus_api_key_encrypted, api_key_is_valid,
      consecutive_api_key_failures, officer_notes
    ) VALUES (
      v_mapping_base + 2,
      'PS40VERIFYNULLED', 'Already Nulled Subject', v_guild, true, true,
      'nulled_username', 'ENCRYPTED_API_KEY_BLOB_B', false, 2,
      'officer note on the already-nulled row'
    ) RETURNING id INTO v_nulled_id;

    INSERT INTO public.player_identity_attestations (
      mapping_id, player_id, subject_user_id, consumed_at, source
    ) VALUES (
      v_nulled_id, 'PS40VERIFYNULLED', v_user_id, now(),
      'operator_quarantine_restore'
    );

    -- C -- a HISTORICAL row of the same subject. enforce_player_identity_
    -- provenance forbids an inactive mapping from retaining user or Discord
    -- authority, so a historical row of the subject necessarily has both
    -- authority columns NULL: it too is reachable only by the third predicate.
    INSERT INTO public.player_mapping (
      id,
      player_id, display_name, guild_code, is_current, is_active,
      username, tacticus_api_key_encrypted, api_key_is_valid,
      consecutive_api_key_failures, original_display_name
    ) VALUES (
      v_mapping_base + 3,
      'PS40VERIFYHIST', 'Historical Subject Name', v_guild, false, false,
      'hist_username', 'ENCRYPTED_API_KEY_BLOB_C', false, 1,
      'Historical Former Name'
    ) RETURNING id INTO v_historical_id;

    INSERT INTO public.player_identity_attestations (
      mapping_id, player_id, subject_user_id, consumed_at, source
    ) VALUES (
      v_historical_id, 'PS40VERIFYHIST', v_user_id, now(),
      'operator_quarantine_restore'
    );

    -- A dependent roster row on the historical mapping. player_roster FKs
    -- player_mapping(id) ON DELETE CASCADE, so this is the fixture that proves
    -- the erasure TOMBSTONES rather than deletes: if the row were deleted, this
    -- roster row would cascade away with it.
    INSERT INTO public.player_roster (id, player_mapping_id, rank_name)
      VALUES (v_roster_pk, v_historical_id, 'PS-40 verify rank')
      RETURNING id INTO v_roster_id;

    -- D -- THE OVER-MATCH CONTROL. A mapping the subject once held that another
    -- user has since legitimately re-claimed. Its ownership_attestation_id is
    -- the OTHER user's, and it still carries the subject's older attestation.
    -- The erasure must leave every one of its columns alone; an unguarded
    -- EXISTS in the third predicate would tombstone this live player.
    INSERT INTO public.player_mapping (
      id,
      player_id, display_name, guild_code, is_current, is_active,
      username, tacticus_api_key_encrypted, api_key_is_valid,
      consecutive_api_key_failures
    ) VALUES (
      v_mapping_base + 4,
      'PS40VERIFYRECLAIM', 'Reclaimed Live Player', v_guild, true, true,
      'other_username', 'OTHER_USER_KEY_BLOB', true, 0
    ) RETURNING id INTO v_reclaimed_id;

    INSERT INTO public.player_identity_attestations (
      mapping_id, player_id, subject_user_id, consumed_at, source
    ) VALUES (
      v_reclaimed_id, 'PS40VERIFYRECLAIM', v_other_id, now(),
      'operator_quarantine_restore'
    ) RETURNING id INTO v_attestation_id;

    UPDATE public.player_mapping
       SET user_id = v_other_id,
           ownership_attestation_id = v_attestation_id
     WHERE id = v_reclaimed_id;

    -- The subject's stale attestation on the re-claimed mapping, added after
    -- the binding so it cannot be mistaken for the one the provenance trigger
    -- validated.
    INSERT INTO public.player_identity_attestations (
      mapping_id, player_id, subject_user_id, consumed_at, source
    ) VALUES (
      v_reclaimed_id, 'PS40VERIFYRECLAIM', v_user_id, now(),
      'operator_quarantine_restore'
    );

    v_revoked := public.revoke_all_player_identity_for_subject(
      v_user_id, 'account_delete', v_user_id, 'ps40_migration_verify'
    );
    -- Four live attestations name the subject: A, B, C and the stale one on D.
    IF v_revoked <> 4 THEN
      RAISE EXCEPTION 'PS-40 verify: expected 4 revoked attestations, got %', v_revoked;
    END IF;

    -- 2a. Every one of the three subject mappings is tombstoned in place.
    FOR v_case IN
      SELECT * FROM (VALUES
        (v_mapping_id,    'A current-owned (predicate 1)'),
        (v_nulled_id,     'B authority-already-null (predicate 3)'),
        (v_historical_id, 'C historical is_current=false (predicate 3)')
      ) AS cases(mapping_id, label)
    LOOP
      v_label := v_case.label;
      SELECT * INTO v_row FROM public.player_mapping WHERE id = v_case.mapping_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PS-40 verify: fixture mapping % disappeared; account_delete must tombstone in place, not delete', v_label;
      END IF;

      -- The pre-existing authority contract still holds.
      v_residual := NULL;
      IF v_row.user_id IS NOT NULL THEN v_residual := 'user_id';
      ELSIF v_row.ownership_attestation_id IS NOT NULL THEN v_residual := 'ownership_attestation_id';
      ELSIF v_row.discord_user_id IS NOT NULL THEN v_residual := 'discord_user_id';
      ELSIF v_row.discord_username IS NOT NULL THEN v_residual := 'discord_username';
      ELSIF v_row.is_app_admin IS NOT false THEN v_residual := 'is_app_admin';
      END IF;
      IF v_residual IS NOT NULL THEN
        RAISE EXCEPTION 'PS-40 verify: the pre-existing authority erasure regressed on % [%]', v_residual, v_label;
      END IF;

      -- The PS-40 columns are erased. Each is named individually so a failure
      -- says which column survived, on which mapping.
      v_residual := NULL;
      IF v_row.display_name IS DISTINCT FROM
         '[DELETED_USER_' || substr(md5(v_case.mapping_id::text), 1, 8) || ']'
        THEN v_residual := 'display_name (got ' || coalesce(v_row.display_name, '<null>') || ')';
      ELSIF v_row.original_display_name IS NOT NULL THEN v_residual := 'original_display_name';
      ELSIF v_row.username IS NOT NULL THEN v_residual := 'username';
      ELSIF v_row.avatar_url IS NOT NULL THEN v_residual := 'avatar_url';
      ELSIF v_row.avatar_unit_id IS NOT NULL THEN v_residual := 'avatar_unit_id';
      ELSIF v_row.tacticus_share_url IS NOT NULL THEN v_residual := 'tacticus_share_url';
      ELSIF v_row.patreon_user_id IS NOT NULL THEN v_residual := 'patreon_user_id';
      ELSIF v_row.player_notes IS NOT NULL THEN v_residual := 'player_notes';
      ELSIF v_row.officer_notes IS NOT NULL THEN v_residual := 'officer_notes';
      ELSIF v_row.tacticus_api_key_encrypted IS NOT NULL THEN v_residual := 'tacticus_api_key_encrypted';
      ELSIF v_row.api_key_added_at IS NOT NULL THEN v_residual := 'api_key_added_at';
      ELSIF v_row.api_key_last_verified IS NOT NULL THEN v_residual := 'api_key_last_verified';
      ELSIF v_row.api_key_is_valid IS DISTINCT FROM true THEN v_residual := 'api_key_is_valid';
      ELSIF v_row.consecutive_api_key_failures IS DISTINCT FROM 0 THEN v_residual := 'consecutive_api_key_failures';
      ELSIF v_row.last_api_key_failure_at IS NOT NULL THEN v_residual := 'last_api_key_failure_at';
      ELSIF v_row.theme_preference IS NOT NULL THEN v_residual := 'theme_preference';
      ELSIF v_row.timezone IS DISTINCT FROM 'UTC' THEN v_residual := 'timezone';
      ELSIF v_row.boss_preferences IS DISTINCT FROM '{}'::jsonb THEN v_residual := 'boss_preferences';
      ELSIF v_row.notify_boss_kills IS DISTINCT FROM false THEN v_residual := 'notify_boss_kills';
      ELSIF v_row.notify_prime_kills IS DISTINCT FROM false THEN v_residual := 'notify_prime_kills';
      ELSIF v_row.notify_when_capped IS DISTINCT FROM false THEN v_residual := 'notify_when_capped';
      ELSIF v_row.has_duplicate_name IS DISTINCT FROM false THEN v_residual := 'has_duplicate_name';
      END IF;
      IF v_residual IS NOT NULL THEN
        RAISE EXCEPTION 'PS-40 verify: residual identity survived erasure on % [%]', v_residual, v_label;
      END IF;
    END LOOP;

    -- 2b. The pseudonymous linkage the branch exists to preserve is intact on
    --     all three, and the roster row on the historical mapping survived.
    IF (SELECT count(*) FROM public.player_mapping
         WHERE id IN (v_mapping_id, v_nulled_id, v_historical_id)
           AND player_id IN ('PS40VERIFYPLAYER', 'PS40VERIFYNULLED', 'PS40VERIFYHIST')) <> 3
    THEN
      RAISE EXCEPTION 'PS-40 verify: player_id must survive account_delete on all three subject mappings; PS-288 keys battle-row anonymisation on it';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.player_roster AS roster
      JOIN public.player_mapping AS mapping ON mapping.id = roster.player_mapping_id
      WHERE roster.id = v_roster_id
        AND mapping.id = v_historical_id
    ) THEN
      RAISE EXCEPTION 'PS-40 verify: the roster row on the historical mapping did not survive; the erasure deleted a row it must tombstone';
    END IF;

    -- 2c. THE OVER-MATCH CONTROL. The re-claimed mapping belongs to another
    --     live user and must come through completely untouched.
    SELECT * INTO v_row FROM public.player_mapping WHERE id = v_reclaimed_id;
    v_residual := NULL;
    IF v_row.display_name IS DISTINCT FROM 'Reclaimed Live Player' THEN v_residual := 'display_name';
    ELSIF v_row.username IS DISTINCT FROM 'other_username' THEN v_residual := 'username';
    ELSIF v_row.tacticus_api_key_encrypted IS DISTINCT FROM 'OTHER_USER_KEY_BLOB' THEN v_residual := 'tacticus_api_key_encrypted';
    ELSIF v_row.user_id IS DISTINCT FROM v_other_id THEN v_residual := 'user_id';
    ELSIF v_row.ownership_attestation_id IS NULL THEN v_residual := 'ownership_attestation_id';
    END IF;
    IF v_residual IS NOT NULL THEN
      RAISE EXCEPTION 'PS-40 verify: the erasure OVER-MATCHED and damaged a mapping re-claimed by another user, on %. The third predicate must keep its user_id IS NULL AND ownership_attestation_id IS NULL guard.', v_residual;
    END IF;

    -- 2d. Idempotent: a retried erasure recomputes the identical tombstones.
    --     After the first pass A and B and C all satisfy the third predicate,
    --     so the retry matches them again and must not change what it wrote.
    CREATE TEMP TABLE ps40_verify_tombstones ON COMMIT DROP AS
      SELECT id, display_name FROM public.player_mapping
       WHERE id IN (v_mapping_id, v_nulled_id, v_historical_id);
    PERFORM public.revoke_all_player_identity_for_subject(
      v_user_id, 'account_delete', v_user_id, 'ps40_migration_verify_retry'
    );
    IF EXISTS (
      SELECT 1
      FROM ps40_verify_tombstones AS before
      JOIN public.player_mapping AS after_row ON after_row.id = before.id
      WHERE after_row.display_name IS DISTINCT FROM before.display_name
    ) THEN
      RAISE EXCEPTION 'PS-40 verify: the tombstone is not idempotent across a retried erasure';
    END IF;

    -- Unwind the fixture. This is the only way out of the block.
    RAISE EXCEPTION 'PS40_VERIFY_FIXTURE_ROLLBACK' USING ERRCODE = 'PS040';
  EXCEPTION
    WHEN SQLSTATE 'PS040' THEN
      IF SQLERRM <> 'PS40_VERIFY_FIXTURE_ROLLBACK' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PS-40 verify: fixture subject erased and asserted, fixture rolled back';
  END;
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

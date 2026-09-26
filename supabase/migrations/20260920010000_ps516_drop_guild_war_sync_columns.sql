-- Retire the live-only guild-war-sync RPCs and cron rows, then drop guild_config's
-- five war-sync columns. Manual upload is untouched.
-- target-db: general
-- Replace the credential-purge functions first: one guards its GDPR purge on a column
-- count that includes these five, the others assign them directly. Rollback must
-- not recreate sync.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- The column guard now counts only the three client_secret columns.
CREATE OR REPLACE FUNCTION public.deactivate_player_mappings_legacy_impl(
  p_guild_code text,
  p_player_ids text[],
  p_reason text,
  p_source text,
  p_observed_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
  v_guild_code text;
  v_player_ids text[];
  v_mapping_ids integer[] := ARRAY[]::integer[];
  v_pre_subject_ids uuid[] := ARRAY[]::uuid[];
  v_lock_subject_ids uuid[] := ARRAY[]::uuid[];
  v_locked_subject_ids uuid[] := ARRAY[]::uuid[];
  v_subject_id uuid;
  v_attestation record;
  v_revoked integer := 0;
  v_deactivated integer := 0;
  v_fresh_count integer := 0;
  v_purged_guild_codes text[] := ARRAY[]::text[];
  v_purged_guild_count integer := 0;
BEGIN
  IF v_request_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Roster deactivation requires service authority'
      USING ERRCODE = '42501';
  END IF;
  v_guild_code := nullif(btrim(p_guild_code), '');
  IF v_guild_code IS NULL OR length(v_guild_code) > 64
    OR p_reason IS DISTINCT FROM 'roster_deactivation'
    OR p_source IS NULL OR length(btrim(p_source)) < 3
    OR length(p_source) > 120
    OR p_observed_at IS NULL
    OR p_observed_at > clock_timestamp()
    OR p_player_ids IS NULL OR cardinality(p_player_ids) < 1
    OR cardinality(p_player_ids) > 500
    OR EXISTS (
      SELECT 1 FROM unnest(p_player_ids) AS supplied(player_id)
      WHERE supplied.player_id IS NULL
        OR length(btrim(supplied.player_id)) < 1
        OR length(supplied.player_id) > 200
    )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid exact roster-deactivation request',
      'error_code', 'INVALID_INPUT'
    );
  END IF;
  v_player_ids := ARRAY(
    SELECT DISTINCT btrim(supplied.player_id)
    FROM unnest(p_player_ids) AS supplied(player_id)
    ORDER BY btrim(supplied.player_id)
  );
  IF cardinality(v_player_ids) <> cardinality(p_player_ids) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Roster-deactivation targets must be unique',
      'error_code', 'INVALID_INPUT'
    );
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT mapping.user_id ORDER BY mapping.user_id),
    ARRAY[]::uuid[]
  )
  INTO v_pre_subject_ids
  FROM public.player_mapping AS mapping
  WHERE mapping.guild_code = v_guild_code
    AND mapping.player_id = ANY(v_player_ids)
    AND mapping.is_current IS TRUE
    AND mapping.user_id IS NOT NULL;

  v_lock_subject_ids := v_pre_subject_ids;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guild_config'
      AND column_name = 'client_secret_uploaded_by'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guild_config'
      AND column_name = 'client_secret'
  ) THEN
    EXECUTE $sql$
      SELECT coalesce(
        array_agg(candidate.user_id ORDER BY candidate.user_id),
        ARRAY[]::uuid[]
      )
      FROM (
        SELECT unnest($1::uuid[]) AS user_id
        UNION
        SELECT config.client_secret_uploaded_by
        FROM public.guild_config AS config
        WHERE config.client_secret IS NOT NULL
          AND config.user_id = ANY($2::text[])
          AND config.client_secret_uploaded_by IS NOT NULL
      ) AS candidate
    $sql$
    INTO v_lock_subject_ids
    USING v_pre_subject_ids, v_player_ids;
  END IF;

  FOREACH v_subject_id IN ARRAY v_lock_subject_ids
  LOOP
    PERFORM pg_advisory_xact_lock(6208, hashtext(v_subject_id::text));
  END LOOP;

  SELECT coalesce(
           array_agg(locked.id ORDER BY locked.id), ARRAY[]::integer[]
         ),
         coalesce(
           array_agg(DISTINCT locked.user_id ORDER BY locked.user_id)
             FILTER (WHERE locked.user_id IS NOT NULL),
           ARRAY[]::uuid[]
         ),
         count(*) FILTER (
           WHERE locked.updated_at IS NULL
              OR locked.updated_at > p_observed_at
         )::integer
  INTO v_mapping_ids, v_locked_subject_ids, v_fresh_count
  FROM (
    SELECT mapping.id, mapping.user_id, mapping.updated_at
    FROM public.player_mapping AS mapping
    WHERE mapping.guild_code = v_guild_code
      AND mapping.player_id = ANY(v_player_ids)
      AND mapping.is_current IS TRUE
    ORDER BY mapping.id
    FOR UPDATE
  ) AS locked;

  IF cardinality(v_mapping_ids) <> cardinality(v_player_ids) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Roster-deactivation target set is absent, stale, or ambiguous',
      'error_code', 'TARGET_SET_NOT_EXACT',
      'requested_count', cardinality(v_player_ids),
      'matched_count', cardinality(v_mapping_ids)
    );
  END IF;
  IF v_locked_subject_ids IS DISTINCT FROM v_pre_subject_ids THEN
    RAISE EXCEPTION 'Roster-deactivation subject set changed while locking'
      USING ERRCODE = '40001';
  END IF;
  IF v_fresh_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'observation_stale', true,
      'guild_code', v_guild_code,
      'requested_count', cardinality(v_player_ids),
      'deactivated_count', 0,
      'deactivated_mapping_ids', '[]'::jsonb,
      'revoked_attestations', 0,
      'purged_loki_credential_count', 0,
      'purged_loki_guild_codes', '[]'::jsonb,
      'authority_cleared', true
    );
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guild_config'
      AND column_name IN (
        'client_secret',
        'client_secret_uploaded_by',
        'client_secret_uploaded_at'
      )
  ) = 3 THEN
    EXECUTE $sql$
      WITH locked_credentials AS (
        SELECT config.id
        FROM public.guild_config AS config
        WHERE config.client_secret IS NOT NULL
          AND config.user_id = ANY($1::text[])
        ORDER BY config.id
        FOR UPDATE
      ), purged_credentials AS (
        UPDATE public.guild_config AS config
        SET user_id = NULL,
            client_secret = NULL,
            session_id = NULL,
            client_secret_uploaded_by = NULL,
            client_secret_uploaded_at = NULL,
            updated_at = clock_timestamp()
        WHERE config.id IN (
          SELECT credential.id FROM locked_credentials AS credential
        )
        RETURNING config.guild_code
      )
      SELECT count(*)::integer,
             coalesce(
               array_agg(purged.guild_code ORDER BY purged.guild_code),
               ARRAY[]::text[]
             )
      FROM purged_credentials AS purged
    $sql$
    INTO v_purged_guild_count, v_purged_guild_codes
    USING v_player_ids;
  END IF;

  FOR v_attestation IN
    SELECT attestation.id
    FROM public.player_identity_attestations AS attestation
    WHERE attestation.mapping_id = ANY(v_mapping_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestation_revocations AS revoked
        WHERE revoked.attestation_id = attestation.id
      )
    ORDER BY attestation.id
    FOR UPDATE
  LOOP
    PERFORM public.append_player_identity_revocation(
      v_attestation.id, 'roster_deactivation', NULL, btrim(p_source)
    );
    v_revoked := v_revoked + 1;
  END LOOP;

  UPDATE public.player_mapping AS mapping
  SET user_id = NULL,
      ownership_attestation_id = NULL,
      discord_user_id = NULL,
      discord_username = NULL,
      is_app_admin = false,
      patreon_user_id = NULL,
      tacticus_api_key_encrypted = NULL,
      api_key_is_valid = NULL,
      api_key_last_verified = NULL,
      api_key_added_at = NULL,
      username = NULL,
      avatar_url = NULL,
      timezone = 'UTC',
      tacticus_share_url = NULL,
      player_notes = NULL,
      theme_preference = NULL,
      boss_preferences = '{}'::jsonb,
      preferences_updated_at = clock_timestamp(),
      notify_boss_kills = false,
      notify_prime_kills = false,
      notify_when_capped = false,
      role = 'member'::public.app_role,
      is_current = false,
      is_active = false,
      updated_at = clock_timestamp()
  WHERE mapping.id = ANY(v_mapping_ids);
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;
  IF v_deactivated <> cardinality(v_mapping_ids) THEN
    RAISE EXCEPTION 'Roster-deactivation lost its exact locked target set'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'guild_code', v_guild_code,
    'requested_count', cardinality(v_player_ids),
    'deactivated_count', v_deactivated,
    'deactivated_mapping_ids', to_jsonb(v_mapping_ids),
    'revoked_attestations', v_revoked,
    'purged_loki_credential_count', v_purged_guild_count,
    'purged_loki_guild_codes', to_jsonb(v_purged_guild_codes),
    'authority_cleared', true
  );
END
$function$;

-- Scoped to this database: another database's job in cron.job is not ours.
DO $ps516_unschedule$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $cron$
      SELECT cron.unschedule(jobid)
        FROM cron.job
       WHERE database = current_database()::name
         AND command ~* 'war[-_]sync'
    $cron$;
  END IF;
END;
$ps516_unschedule$;

-- Never created by a migration, so a rebuilt database could not run either erasure path.
ALTER TABLE public.guild_config
  ADD COLUMN IF NOT EXISTS client_secret text,
  ADD COLUMN IF NOT EXISTS client_secret_uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS client_secret_uploaded_at timestamptz;

-- Live bodies with only the war_sync assignments removed.
CREATE OR REPLACE FUNCTION public.prepare_player_account_deletion(
  p_user_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user
  );
  v_cleared integer := 0;
  v_deleted integer := 0;
  v_revoked integer := 0;
  v_owned_player_ids text[];
  v_mapping_ids integer[] := ARRAY[]::integer[];
  v_lock_user_id uuid;
  v_purged_guild_codes text[] := ARRAY[]::text[];
  v_purged_guild_count integer := 0;
BEGIN
  IF v_request_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Account-deletion preparation requires service authority'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_reason NOT IN ('account_delete', 'gdpr_erasure') THEN
    RAISE EXCEPTION 'A user and approved deletion reason are required'
      USING ERRCODE = '22023';
  END IF;

  -- Pre-resolve only player IDs currently bound to this subject. Historical
  -- attestations are evidence, not present authority: a delayed GDPR retry
  -- must never purge a credential uploaded after the mapping was legitimately
  -- re-claimed by someone else. Acquire every affected subject lock in UUID-
  -- text order; credential writers use the same order.
  SELECT coalesce(array_agg(DISTINCT subject_player.player_id
                            ORDER BY subject_player.player_id), ARRAY[]::text[])
  INTO v_owned_player_ids
  FROM (
    SELECT mapping.player_id
    FROM public.player_mapping AS mapping
    WHERE mapping.user_id = p_user_id
  ) AS subject_player;

  FOR v_lock_user_id IN
    WITH affected_credentials AS (
      SELECT config.user_id, config.client_secret_uploaded_by
      FROM public.guild_config AS config
      WHERE config.client_secret_uploaded_by = p_user_id
         OR config.user_id = ANY(v_owned_player_ids)
    ), lock_candidates AS (
      SELECT p_user_id AS user_id
      UNION
      SELECT credential.client_secret_uploaded_by
      FROM affected_credentials AS credential
      WHERE credential.client_secret_uploaded_by IS NOT NULL
      UNION
      SELECT mapping.user_id
      FROM affected_credentials AS credential
      JOIN public.player_mapping AS mapping
        ON mapping.player_id = credential.user_id
       AND mapping.is_current IS TRUE
       AND mapping.user_id IS NOT NULL
    )
    SELECT candidate.user_id
    FROM lock_candidates AS candidate
    WHERE candidate.user_id IS NOT NULL
    ORDER BY candidate.user_id::text
  LOOP
    PERFORM pg_advisory_xact_lock(6208, hashtext(v_lock_user_id::text));
  END LOOP;

  PERFORM public.block_player_identity_subject_authority(
    p_user_id, p_reason, 'prepare_player_account_deletion'
  );

  SELECT coalesce(array_agg(locked.id ORDER BY locked.id), ARRAY[]::integer[])
  INTO v_mapping_ids
  FROM (
    SELECT mapping.id
    FROM public.player_mapping AS mapping
    WHERE mapping.user_id = p_user_id
       OR (
         mapping.user_id IS NULL
         AND mapping.ownership_attestation_id IS NULL
         AND EXISTS (
         SELECT 1
         FROM public.player_identity_attestations AS attestation
         WHERE attestation.mapping_id = mapping.id
           AND attestation.subject_user_id = p_user_id
         )
       )
    ORDER BY mapping.id
    FOR UPDATE
  ) AS locked;

  -- Re-derive the exact credential owner set from only the locked deletion
  -- targets. A mapping currently bound/attested to another subject was
  -- excluded above even when it still carries this subject's historical proof.
  -- Punctuation is data, never PostgREST filter syntax.
  SELECT coalesce(array_agg(DISTINCT mapping.player_id ORDER BY mapping.player_id),
                  ARRAY[]::text[])
  INTO v_owned_player_ids
  FROM public.player_mapping AS mapping
  WHERE mapping.id = ANY(v_mapping_ids);

  WITH locked_credentials AS (
    SELECT config.id
    FROM public.guild_config AS config
    WHERE config.client_secret_uploaded_by = p_user_id
       OR config.user_id = ANY(v_owned_player_ids)
    ORDER BY config.id
    FOR UPDATE
  ), purged_credentials AS (
    UPDATE public.guild_config AS config
    SET user_id = NULL,
        client_secret = NULL,
        session_id = NULL,
        client_secret_uploaded_by = NULL,
        client_secret_uploaded_at = NULL,
        updated_at = clock_timestamp()
    WHERE config.id IN (SELECT locked.id FROM locked_credentials AS locked)
    RETURNING config.guild_code
  )
  SELECT count(*)::integer,
         coalesce(array_agg(purged.guild_code ORDER BY purged.guild_code),
                  ARRAY[]::text[])
  INTO v_purged_guild_count, v_purged_guild_codes
  FROM purged_credentials AS purged;

  v_revoked := public.revoke_all_player_identity_for_subject(
    p_user_id,
    p_reason,
    p_user_id,
    'prepare_player_account_deletion'
  );

  IF EXISTS (
    SELECT 1
    FROM public.player_mapping AS mapping
    WHERE mapping.user_id = p_user_id
       OR mapping.ownership_attestation_id IN (
         SELECT attestation.id
         FROM public.player_identity_attestations AS attestation
         WHERE attestation.subject_user_id = p_user_id
       )
  ) THEN
    RAISE EXCEPTION 'Subject authority survived account-deletion preparation'
      USING ERRCODE = '55000';
  END IF;

  IF p_reason = 'gdpr_erasure' THEN
    DELETE FROM public.player_mapping AS mapping
    WHERE mapping.id = ANY(v_mapping_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> cardinality(v_mapping_ids) THEN
      RAISE EXCEPTION 'GDPR mapping deletion lost its exact locked target set'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    v_cleared := cardinality(v_mapping_ids);
  END IF;

  UPDATE auth.users AS target
  SET raw_user_meta_data = coalesce(target.raw_user_meta_data, '{}'::jsonb)
    - 'discord_user_id' - 'discord_username' - 'discord_synced'
  WHERE target.id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'cleared_mapping_count', v_cleared,
    'deleted_mapping_count', v_deleted,
    'revoked_attestations', v_revoked,
    'purged_loki_credential_count', v_purged_guild_count,
    'purged_loki_guild_codes', to_jsonb(v_purged_guild_codes),
    'subject_authority_blocked', true,
    'binding_restorable', false
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_unlink_player_mapping(
  p_player_id text,
  p_guild_code text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_count integer;
  v_caller_is_admin boolean;
  v_target record;
  v_target_ids integer[];
  v_attestation record;
  v_revoked integer := 0;
  v_prior_user_id uuid;
  v_pre_target_count integer;
  v_pre_user_id uuid;
  v_pre_lock_user_ids uuid[] := ARRAY[]::uuid[];
  v_locked_uploader_ids uuid[] := ARRAY[]::uuid[];
  v_lock_user_id uuid;
  v_credential_ids bigint[] := ARRAY[]::bigint[];
  v_purged_guild_codes text[] := ARRAY[]::text[];
  v_purged_guild_count integer := 0;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Authentication required',
      'error_code', 'AUTH_REQUIRED'
    );
  END IF;
  SELECT count(*), bool_or(verified.is_app_admin)
  INTO v_caller_count, v_caller_is_admin
  FROM public.resolve_verified_players(ARRAY[v_caller_uid]) AS verified;
  IF v_caller_count <> 1 OR v_caller_is_admin IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Not authorized - admin role required',
      'error_code', 'NOT_AUTHORIZED'
    );
  END IF;
  IF p_player_id IS NULL OR length(btrim(p_player_id)) = 0
    OR p_guild_code IS NULL OR length(btrim(p_guild_code)) = 0
    OR p_reason IS NULL OR length(btrim(p_reason)) < 10
    OR length(p_reason) > 500
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'player, guild, and a 10-500 character reason are required',
      'error_code', 'INVALID_INPUT'
    );
  END IF;

  -- Match credential writers' subject-first lock order. The exact mapping and
  -- credential uploader sets are re-read under row locks below; any change
  -- after this pre-read forces a whole-transaction retry.
  SELECT count(*)::integer,
         (array_agg(mapping.user_id ORDER BY mapping.id))[1]
  INTO v_pre_target_count, v_pre_user_id
  FROM public.player_mapping AS mapping
  WHERE mapping.player_id = btrim(p_player_id)
    AND mapping.guild_code = btrim(p_guild_code)
    AND mapping.is_current IS TRUE;
  IF v_pre_target_count <> 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Player mapping is absent or ambiguous',
      'error_code', 'TARGET_NOT_EXACT'
    );
  END IF;
  IF v_pre_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Player mapping is already unclaimed',
      'error_code', 'ALREADY_UNCLAIMED'
    );
  END IF;
  SELECT coalesce(array_agg(candidate.user_id ORDER BY candidate.user_id),
                  ARRAY[]::uuid[])
  INTO v_pre_lock_user_ids
  FROM (
    SELECT v_pre_user_id AS user_id
    UNION
    SELECT config.client_secret_uploaded_by
    FROM public.guild_config AS config
    WHERE config.user_id = btrim(p_player_id)
      AND config.client_secret_uploaded_by IS NOT NULL
  ) AS candidate;
  FOREACH v_lock_user_id IN ARRAY v_pre_lock_user_ids
  LOOP
    PERFORM pg_advisory_xact_lock(6208, hashtext(v_lock_user_id::text));
  END LOOP;

  SELECT array_agg(locked.id ORDER BY locked.id)
  INTO v_target_ids
  FROM (
    SELECT mapping.id
    FROM public.player_mapping AS mapping
    WHERE mapping.player_id = btrim(p_player_id)
      AND mapping.guild_code = btrim(p_guild_code)
      AND mapping.is_current IS TRUE
    ORDER BY mapping.id
    FOR UPDATE
  ) AS locked;
  IF cardinality(v_target_ids) IS DISTINCT FROM 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Player mapping is absent or ambiguous',
      'error_code', 'TARGET_NOT_EXACT'
    );
  END IF;
  SELECT mapping.id, mapping.player_id, mapping.guild_code,
         mapping.user_id, mapping.ownership_attestation_id
  INTO STRICT v_target
  FROM public.player_mapping AS mapping
  WHERE mapping.id = v_target_ids[1];
  IF v_target.user_id IS DISTINCT FROM v_pre_user_id THEN
    RAISE EXCEPTION 'Player mapping owner changed while unlinking'
      USING ERRCODE = '40001';
  END IF;

  v_prior_user_id := v_target.user_id;
  SELECT coalesce(array_agg(locked.id ORDER BY locked.id), ARRAY[]::bigint[]),
         coalesce(
           array_agg(DISTINCT locked.client_secret_uploaded_by
                     ORDER BY locked.client_secret_uploaded_by)
             FILTER (WHERE locked.client_secret_uploaded_by IS NOT NULL),
           ARRAY[]::uuid[]
         )
  INTO v_credential_ids, v_locked_uploader_ids
  FROM (
    SELECT config.id, config.client_secret_uploaded_by
    FROM public.guild_config AS config
    WHERE config.user_id = v_target.player_id
    ORDER BY config.id
    FOR UPDATE
  ) AS locked;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_locked_uploader_ids) AS uploader(user_id)
    WHERE NOT uploader.user_id = ANY(v_pre_lock_user_ids)
  ) THEN
    RAISE EXCEPTION 'Credential uploader set changed while unlinking'
      USING ERRCODE = '40001';
  END IF;

  WITH purged_credentials AS (
    UPDATE public.guild_config AS config
    SET user_id = NULL,
        client_secret = NULL,
        session_id = NULL,
        client_secret_uploaded_by = NULL,
        client_secret_uploaded_at = NULL,
        updated_at = clock_timestamp()
    WHERE config.id = ANY(v_credential_ids)
    RETURNING config.guild_code
  )
  SELECT count(*)::integer,
         coalesce(array_agg(purged.guild_code ORDER BY purged.guild_code),
                  ARRAY[]::text[])
  INTO v_purged_guild_count, v_purged_guild_codes
  FROM purged_credentials AS purged;

  FOR v_attestation IN
    SELECT attestation.id
    FROM public.player_identity_attestations AS attestation
    WHERE attestation.mapping_id = v_target.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestation_revocations AS revoked
        WHERE revoked.attestation_id = attestation.id
      )
    ORDER BY attestation.id
    FOR UPDATE
  LOOP
    PERFORM public.append_player_identity_revocation(
      v_attestation.id,
      'admin_unlink',
      v_caller_uid,
      'admin_unlink_player_mapping'
    );
    v_revoked := v_revoked + 1;
  END LOOP;

  UPDATE public.player_mapping AS mapping
  SET user_id = NULL,
      ownership_attestation_id = NULL,
      discord_user_id = NULL,
      discord_username = NULL,
      is_app_admin = false,
      tacticus_api_key_encrypted = NULL,
      api_key_is_valid = NULL,
      api_key_last_verified = NULL,
      updated_at = clock_timestamp()
  WHERE mapping.id = v_target.id;

  UPDATE auth.users AS target
  SET raw_user_meta_data = coalesce(target.raw_user_meta_data, '{}'::jsonb)
    - 'discord_user_id' - 'discord_username' - 'discord_synced'
  WHERE target.id = v_prior_user_id;

  INSERT INTO public.player_claim_audit (
    user_id, player_id, guild_code, source_path, outcome, details
  ) VALUES (
    v_caller_uid, v_target.player_id, v_target.guild_code,
    'admin/unlink-player', 'admin_unlink',
    jsonb_build_object(
      'prior_user_id', v_prior_user_id,
      'reason', btrim(p_reason),
      'ownership_revoked', true,
      'revoked_attestations', v_revoked,
      'purged_loki_credential_count', v_purged_guild_count,
      'purged_loki_guild_codes', to_jsonb(v_purged_guild_codes)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'player_id', v_target.player_id,
    'guild_code', v_target.guild_code,
    'prior_user_id', v_prior_user_id,
    'revoked_attestations', v_revoked,
    'purged_loki_credential_count', v_purged_guild_count,
    'purged_loki_guild_codes', to_jsonb(v_purged_guild_codes),
    'binding_restorable', false
  );
END;
$function$;

-- No CASCADE: an undeclared dependency must fail the migration.
DROP FUNCTION IF EXISTS public.enqueue_guild_war_sync(text, text, text);
DROP FUNCTION IF EXISTS public.increment_war_sync_failure(text, smallint, boolean);

ALTER TABLE IF EXISTS public.guild_config
  DROP COLUMN IF EXISTS war_sync_enabled,
  DROP COLUMN IF EXISTS consecutive_war_sync_failures,
  DROP COLUMN IF EXISTS last_war_sync_error_at,
  DROP COLUMN IF EXISTS last_war_sync_error_reason,
  DROP COLUMN IF EXISTS last_war_sync_error_details;

NOTIFY pgrst, 'reload schema';

DO $ps516_verify$
DECLARE
  v_columns integer;
  v_control integer;
  v_bodies integer;
  v_body_control integer;
  v_offenders text;
BEGIN
  SELECT count(*)::integer,
         string_agg(c.column_name, ', ' ORDER BY c.column_name)
    INTO v_columns, v_offenders
    FROM information_schema.columns AS c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'guild_config'
     AND c.column_name ~ 'war_sync';

  IF v_columns <> 0 THEN
    RAISE EXCEPTION
      'PS-516: % war-sync column(s) remain on public.guild_config: %',
      v_columns, v_offenders;
  END IF;

  -- Positive control on the census above: the same lookup still finds
  -- guild_config's surviving war column, so a zero is a real zero and not a
  -- query reading nothing. war_visibility is NOT a sync surface and stays.
  SELECT count(*)::integer INTO v_control
    FROM information_schema.columns AS c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'guild_config'
     AND c.column_name = 'war_visibility';

  IF v_control <> 1 THEN
    RAISE EXCEPTION
      'PS-516: positive control failed -- guild_config.war_visibility should exist exactly once, found %',
      v_control;
  END IF;

  -- No function body in `public` may still name one of the five.
  SELECT count(*)::integer,
         string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_bodies, v_offenders
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~* '(war_sync_enabled|consecutive_war_sync_failures|last_war_sync_error_at|last_war_sync_error_reason|last_war_sync_error_details)';

  IF v_bodies <> 0 THEN
    RAISE EXCEPTION
      'PS-516: % function body/bodies in public still name a war-sync column: %',
      v_bodies, v_offenders;
  END IF;

  -- Positive control on the body census: bodies naming guild_config at all.
  SELECT count(*)::integer INTO v_body_control
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'guild_config';

  IF v_body_control = 0 THEN
    RAISE EXCEPTION
      'PS-516: positive control failed -- no function body in public names guild_config, so the body census read nothing';
  END IF;

  IF to_regprocedure('public.enqueue_guild_war_sync(text,text,text)') IS NOT NULL
     OR to_regprocedure('public.increment_war_sync_failure(text,smallint,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-516: a retired guild-war sync RPC still exists';
  END IF;

  IF to_regprocedure('public.prepare_player_account_deletion(uuid,text)') IS NULL
     OR to_regprocedure('public.admin_unlink_player_mapping(text,text,text)') IS NULL THEN
    RAISE EXCEPTION
      'PS-516: a credential-purge function is missing after replacement';
  END IF;

  -- cron.job is cluster-wide, so scope the invariant to this database. Jobs for
  -- another tenant (notably the captured EOT guild-war job) are not ours to
  -- unschedule and do not execute a function from this database.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM cron.job
      WHERE database = current_database()::name
        AND command ~* 'war[-_]sync'
    ) THEN
      RAISE EXCEPTION
        'PS-516: a cron job for this database still references war_sync or war-sync';
    END IF;
  END IF;

  RAISE NOTICE
    'PS-516: guild_config carries no war-sync column; % function body/bodies still name guild_config',
    v_body_control;
END;
$ps516_verify$;


-- Restate live ACLs so source replay and the anon-definer ratchet match production.
REVOKE ALL ON FUNCTION public.admin_unlink_player_mapping(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlink_player_mapping(text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_player_account_deletion(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_player_account_deletion(uuid, text) TO service_role;

COMMIT;

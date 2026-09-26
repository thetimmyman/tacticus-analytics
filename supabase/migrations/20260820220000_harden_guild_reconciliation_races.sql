-- A sync may not deactivate a mapping using a roster older than its latest membership
-- update, and only the newest new-guild onboarding attempt may finalize.

BEGIN;

ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS guild_attempt_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE public.onboarding_progress
  DROP CONSTRAINT IF EXISTS onboarding_progress_guild_attempt_generation_check;
ALTER TABLE public.onboarding_progress
  ADD CONSTRAINT onboarding_progress_guild_attempt_generation_check
  CHECK (guild_attempt_generation >= 0);

DROP FUNCTION IF EXISTS public.begin_own_guild_onboarding_attempt();
DROP FUNCTION IF EXISTS public.settle_own_guild_onboarding_attempt(
  bigint, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.settle_own_guild_onboarding_attempt(
  uuid, bigint, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.begin_own_guild_onboarding_attempt(
  p_subject uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
  v_generation bigint;
BEGIN
  IF v_request_role <> 'service_role' OR p_subject IS NULL THEN
    RAISE EXCEPTION 'Guild onboarding generation is server-only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));

  UPDATE public.onboarding_progress AS progress
  SET guild_attempt_generation = progress.guild_attempt_generation + 1,
      updated_at = clock_timestamp()
  WHERE progress.user_id = p_subject
  RETURNING progress.guild_attempt_generation INTO v_generation;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'Onboarding progress is unavailable'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_generation;
END
$function$;

CREATE OR REPLACE FUNCTION public.settle_own_guild_onboarding_attempt(
  p_subject uuid,
  p_generation bigint,
  p_outcome text,
  p_guild_mode text DEFAULT NULL,
  p_role_intent text DEFAULT NULL,
  p_guild_code text DEFAULT NULL,
  p_guild_name text DEFAULT NULL,
  p_sync_status text DEFAULT NULL,
  p_error_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
  v_progress public.onboarding_progress%ROWTYPE;
BEGIN
  IF v_request_role <> 'service_role' OR p_subject IS NULL THEN
    RAISE EXCEPTION 'Guild onboarding settlement is server-only'
      USING ERRCODE = '42501';
  END IF;
  IF p_generation IS NULL OR p_generation < 1
    OR p_outcome NOT IN ('complete', 'failed')
    OR (
      p_outcome = 'complete'
      AND (
        NOT coalesce(
          (p_guild_mode = 'new_guild' AND p_role_intent = 'leader')
          OR
          (p_guild_mode = 'existing_guild' AND p_role_intent = 'member'),
          false
        )
        OR
        length(btrim(coalesce(p_guild_code, ''))) NOT BETWEEN 2 AND 64
        OR length(btrim(coalesce(p_guild_name, ''))) NOT BETWEEN 1 AND 200
        OR p_sync_status NOT IN ('not_required', 'pending', 'complete')
      )
    )
    OR (
      p_outcome = 'failed'
      AND length(btrim(coalesce(p_error_message, ''))) NOT BETWEEN 1 AND 500
    )
  THEN
    RAISE EXCEPTION 'Invalid guild onboarding settlement'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));

  SELECT progress.*
  INTO v_progress
  FROM public.onboarding_progress AS progress
  WHERE progress.user_id = p_subject
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'PROGRESS_ABSENT'
    );
  END IF;
  IF v_progress.guild_attempt_generation <> p_generation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'ATTEMPT_SUPERSEDED',
      'current_generation', v_progress.guild_attempt_generation
    );
  END IF;

  IF p_outcome = 'complete' THEN
    UPDATE public.onboarding_progress AS progress
    SET guild_mode = p_guild_mode,
        role_intent = p_role_intent,
        guild_status = 'complete',
        guild_code = btrim(p_guild_code),
        guild_name = btrim(p_guild_name),
        guild_error_message = NULL,
        guild_can_retry = true,
        sync_status = p_sync_status,
        sync_error_message = NULL,
        sync_can_retry = true,
        profile_error_message = NULL,
        profile_can_retry = true,
        updated_at = clock_timestamp()
    WHERE progress.user_id = p_subject
      AND progress.guild_attempt_generation = p_generation
    RETURNING progress.* INTO v_progress;
  ELSE
    UPDATE public.onboarding_progress AS progress
    SET guild_status = 'failed',
        guild_error_message = btrim(p_error_message),
        guild_can_retry = true,
        sync_error_message = NULL,
        sync_can_retry = true,
        profile_error_message = NULL,
        profile_can_retry = true,
        updated_at = clock_timestamp()
    WHERE progress.user_id = p_subject
      AND progress.guild_attempt_generation = p_generation
    RETURNING progress.* INTO v_progress;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'ATTEMPT_SUPERSEDED'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'generation', p_generation,
    'progress', to_jsonb(v_progress)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.begin_guild_roster_observation()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
BEGIN
  IF v_request_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Roster observation is server-only'
      USING ERRCODE = '42501';
  END IF;
  RETURN clock_timestamp();
END
$function$;

-- Internal name so clean replay and production converge.
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
        'client_secret_uploaded_at',
        'war_sync_enabled',
        'consecutive_war_sync_failures',
        'last_war_sync_error_at',
        'last_war_sync_error_reason',
        'last_war_sync_error_details'
      )
  ) = 8 THEN
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
            war_sync_enabled = false,
            consecutive_war_sync_failures = 0,
            last_war_sync_error_at = NULL,
            last_war_sync_error_reason = NULL,
            last_war_sync_error_details = NULL,
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

CREATE OR REPLACE FUNCTION public.deactivate_player_mappings_observed(
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
  v_guild_code text := nullif(btrim(p_guild_code), '');
  v_player_ids text[];
  v_result jsonb;
BEGIN
  IF v_request_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Roster deactivation requires service authority'
      USING ERRCODE = '42501';
  END IF;
  IF v_guild_code IS NULL OR length(v_guild_code) > 64
    OR p_reason IS DISTINCT FROM 'roster_deactivation'
    OR p_source IS NULL OR length(btrim(p_source)) NOT BETWEEN 3 AND 120
    OR p_observed_at IS NULL
    OR p_observed_at > clock_timestamp()
    OR p_player_ids IS NULL OR cardinality(p_player_ids) NOT BETWEEN 1 AND 500
    OR EXISTS (
      SELECT 1 FROM unnest(p_player_ids) AS supplied(player_id)
      WHERE supplied.player_id IS NULL
        OR length(btrim(supplied.player_id)) NOT BETWEEN 1 AND 200
    )
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'INVALID_INPUT'
    );
  END IF;

  v_player_ids := ARRAY(
    SELECT DISTINCT btrim(supplied.player_id)
    FROM unnest(p_player_ids) AS supplied(player_id)
    ORDER BY btrim(supplied.player_id)
  );
  IF cardinality(v_player_ids) <> cardinality(p_player_ids) THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'INVALID_INPUT'
    );
  END IF;

  v_result := public.deactivate_player_mappings_legacy_impl(
    v_guild_code, v_player_ids, p_reason, p_source, p_observed_at
  );
  IF v_result ? 'observation_stale' THEN
    RETURN v_result;
  END IF;
  RETURN v_result || jsonb_build_object('observation_stale', false);
END
$function$;

-- Callers without a roster observation time give recent memberships a conservative lease.
CREATE OR REPLACE FUNCTION public.deactivate_player_mappings(
  p_guild_code text,
  p_player_ids text[],
  p_reason text,
  p_source text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.deactivate_player_mappings_observed(
    p_guild_code,
    p_player_ids,
    p_reason,
    p_source,
    '-infinity'::timestamptz
  );
$function$;

-- Fenced by attempt generation under the same per-subject advisory lock as creation.
ALTER FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text
) RENAME TO reconcile_own_guild_membership_legacy_impl;

REVOKE ALL ON FUNCTION public.reconcile_own_guild_membership_legacy_impl(
  uuid, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Fails closed: without a generation witness a request may not mutate identity.
CREATE FUNCTION public.reconcile_own_guild_membership(
  p_subject uuid,
  p_player_id text,
  p_source_guild text,
  p_source_guild_id text,
  p_target_guild text,
  p_target_guild_id text,
  p_target_role text,
  p_upstream_digest text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Guild membership reconciliation is server-only'
      USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'success', false, 'error_code', 'ATTEMPT_GENERATION_REQUIRED'
  );
END
$function$;

CREATE FUNCTION public.reconcile_own_guild_membership(
  p_subject uuid,
  p_player_id text,
  p_source_guild text,
  p_source_guild_id text,
  p_target_guild text,
  p_target_guild_id text,
  p_target_role text,
  p_upstream_digest text,
  p_attempt_generation bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
  v_current_generation bigint;
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Guild membership reconciliation is server-only'
      USING ERRCODE = '42501';
  END IF;
  IF p_subject IS NULL OR p_attempt_generation IS NULL
    OR p_attempt_generation < 1
  THEN
    RAISE EXCEPTION 'Invalid guild reconciliation attempt'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));
  SELECT progress.guild_attempt_generation
  INTO v_current_generation
  FROM public.onboarding_progress AS progress
  WHERE progress.user_id = p_subject
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'PROGRESS_ABSENT'
    );
  END IF;
  IF v_current_generation <> p_attempt_generation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'ATTEMPT_SUPERSEDED',
      'current_generation', v_current_generation
    );
  END IF;

  RETURN public.reconcile_own_guild_membership_legacy_impl(
    p_subject,
    p_player_id,
    p_source_guild,
    p_source_guild_id,
    p_target_guild,
    p_target_guild_id,
    p_target_role,
    p_upstream_digest
  );
END
$function$;

REVOKE ALL ON FUNCTION public.begin_own_guild_onboarding_attempt(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_own_guild_onboarding_attempt(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.begin_guild_roster_observation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_guild_roster_observation()
  TO service_role;

REVOKE ALL ON FUNCTION public.settle_own_guild_onboarding_attempt(
  uuid, bigint, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_own_guild_onboarding_attempt(
  uuid, bigint, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.deactivate_player_mappings_legacy_impl(
  text, text[], text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.deactivate_player_mappings_observed(
  text, text[], text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_player_mappings_observed(
  text, text[], text, text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.deactivate_player_mappings(
  text, text[], text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_player_mappings(
  text, text[], text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text, bigint
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Move one attested mapping between guilds once the route has verified both rosters.

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_own_guild_membership(
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
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user
  );
  v_mapping record;
  v_source record;
  v_target record;
  v_locked_guild_count integer;
  v_current_count integer;
  v_role public.app_role;
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Guild membership reconciliation is server-only'
      USING ERRCODE = '42501';
  END IF;
  IF p_subject IS NULL
    OR length(btrim(coalesce(p_player_id, ''))) NOT BETWEEN 1 AND 128
    OR length(btrim(coalesce(p_source_guild, ''))) NOT BETWEEN 2 AND 32
    OR length(btrim(coalesce(p_source_guild_id, ''))) NOT BETWEEN 1 AND 128
    OR length(btrim(coalesce(p_target_guild, ''))) NOT BETWEEN 2 AND 32
    OR length(btrim(coalesce(p_target_guild_id, ''))) NOT BETWEEN 1 AND 128
    OR p_source_guild = p_target_guild
    OR p_upstream_digest IS NULL
    OR p_upstream_digest !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Invalid guild reconciliation evidence'
      USING ERRCODE = '22023';
  END IF;

  v_role := CASE lower(btrim(coalesce(p_target_role, '')))
    WHEN 'leader' THEN 'leader'::public.app_role
    WHEN 'officer' THEN 'officer'::public.app_role
    ELSE NULL
  END;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Target role must be elevated'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));

  IF EXISTS (
    SELECT 1
    FROM public.player_identity_subject_authority_blocks AS block
    WHERE block.subject_user_id = p_subject
  ) THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'SUBJECT_AUTHORITY_BLOCKED'
    );
  END IF;

  PERFORM 1
  FROM auth.users AS subject
  WHERE subject.id = p_subject
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'AUTH_SUBJECT_ABSENT'
    );
  END IF;

  -- Bind the upstream identities to the exact guild rows under database locks.
  -- A concurrent create-config retry may update an incomplete row, so codes
  -- alone are not sufficient evidence after the network checks complete.
  PERFORM 1
  FROM public.guild_config AS guild
  WHERE guild.guild_code IN (btrim(p_source_guild), btrim(p_target_guild))
  ORDER BY guild.guild_code
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_guild_count = ROW_COUNT;
  IF v_locked_guild_count <> 2 THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'GUILD_ROWS_CHANGED'
    );
  END IF;

  SELECT guild.guild_code, guild.guild_id
  INTO v_source
  FROM public.guild_config AS guild
  WHERE guild.guild_code = btrim(p_source_guild);
  IF NOT FOUND OR v_source.guild_id IS DISTINCT FROM btrim(p_source_guild_id) THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'SOURCE_GUILD_ID_CHANGED'
    );
  END IF;

  SELECT guild.guild_code, guild.guild_id, guild.cluster_code, guild.cluster_id
  INTO v_target
  FROM public.guild_config AS guild
  WHERE guild.guild_code = btrim(p_target_guild);
  IF NOT FOUND OR v_target.guild_id IS DISTINCT FROM btrim(p_target_guild_id) THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'TARGET_GUILD_ID_CHANGED'
    );
  END IF;

  SELECT count(*)
  INTO v_current_count
  FROM public.player_mapping AS mapping
  WHERE mapping.user_id = p_subject
    AND mapping.is_current IS TRUE;
  IF v_current_count <> 1 THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'SOURCE_NOT_EXACT'
    );
  END IF;

  SELECT mapping.id, mapping.player_id, mapping.guild_code,
         mapping.ownership_attestation_id
  INTO v_mapping
  FROM public.player_mapping AS mapping
  JOIN public.player_identity_attestations AS proof
    ON proof.id = mapping.ownership_attestation_id
   AND proof.mapping_id = mapping.id
   AND proof.player_id = mapping.player_id
   AND proof.subject_user_id = mapping.user_id
  WHERE mapping.user_id = p_subject
    AND mapping.is_current IS TRUE
    AND mapping.player_id = btrim(p_player_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.player_identity_attestation_revocations AS revoked
      WHERE revoked.attestation_id = proof.id
    )
  FOR UPDATE OF mapping;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'SOURCE_CHANGED'
    );
  END IF;

  -- Idempotent success covers a roster sync that completed after the route
  -- captured the source but before this locked transition.
  IF v_mapping.guild_code = btrim(p_target_guild) THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'player_id', v_mapping.player_id,
      'guild_code', v_mapping.guild_code,
      'mapping_id', v_mapping.id
    );
  END IF;
  IF v_mapping.guild_code <> btrim(p_source_guild) THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'SOURCE_CHANGED'
    );
  END IF;

  PERFORM set_config(
    'app.guild_membership_reconciliation_subject', p_subject::text, true
  );
  UPDATE public.player_mapping AS mapping
  SET guild_code = v_target.guild_code,
      cluster_code = v_target.cluster_code,
      cluster_id = v_target.cluster_id,
      role = v_role,
      is_current = true,
      is_active = true,
      updated_at = clock_timestamp()
  WHERE mapping.id = v_mapping.id
    AND mapping.user_id = p_subject
    AND mapping.player_id = btrim(p_player_id)
    AND mapping.guild_code = btrim(p_source_guild)
    AND mapping.is_current IS TRUE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'SOURCE_CHANGED'
    );
  END IF;

  INSERT INTO public.player_claim_audit (
    user_id, player_id, guild_code, source_path, outcome, details
  ) VALUES (
    p_subject, btrim(p_player_id), v_target.guild_code,
    'onboarding/guild-membership-reconciliation', 'success',
    jsonb_build_object(
      'action', 'reconcile_own_guild_membership',
      'mapping_id', v_mapping.id,
      'source_guild_code', btrim(p_source_guild),
      'target_guild_code', v_target.guild_code,
      'upstream_digest', p_upstream_digest
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'player_id', btrim(p_player_id),
    'guild_code', v_target.guild_code,
    'mapping_id', v_mapping.id
  );
EXCEPTION
  WHEN unique_violation OR exclusion_violation THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'TRANSFER_CONFLICT'
    );
END
$function$;

-- Roster syncs never move a live attested account, even via a stale ON CONFLICT update;
-- only the locked RPC above sets the transaction-local witness.
CREATE OR REPLACE FUNCTION public.guard_attested_guild_membership_move()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.guild_code IS DISTINCT FROM NEW.guild_code
    AND OLD.is_current IS TRUE
    AND OLD.user_id IS NOT NULL
    AND OLD.ownership_attestation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.player_identity_attestation_revocations AS revoked
      WHERE revoked.attestation_id = OLD.ownership_attestation_id
    )
    AND (
      current_user <> 'postgres'
      OR coalesce(
        current_setting(
          'app.guild_membership_reconciliation_subject', true
        ),
        ''
      ) <> OLD.user_id::text
    )
  THEN
    RAISE EXCEPTION 'Attested guild membership requires reconciliation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS guard_attested_guild_membership_move
  ON public.player_mapping;
CREATE TRIGGER guard_attested_guild_membership_move
BEFORE UPDATE OF guild_code ON public.player_mapping
FOR EACH ROW
EXECUTE FUNCTION public.guard_attested_guild_membership_move();

REVOKE ALL ON FUNCTION public.guard_attested_guild_membership_move()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_attested_guild_membership_move()
  TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_own_guild_membership(
  uuid, text, text, text, text, text, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

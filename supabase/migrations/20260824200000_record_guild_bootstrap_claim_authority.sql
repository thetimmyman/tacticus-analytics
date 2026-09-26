-- Record a server-verified new-guild registration so the registrar can link their
-- profile; browser-owned onboarding_progress is not authority.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_guild_bootstrap_claim_authority(
  p_subject uuid,
  p_guild_code text,
  p_attempt_generation bigint,
  p_source text DEFAULT 'verified_registration'
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user
  );
  v_guild_code text := upper(btrim(coalesce(p_guild_code, '')));
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Bootstrap claim authority may only be recorded by the server'
      USING ERRCODE = '42501';
  END IF;
  IF p_subject IS NULL THEN
    RAISE EXCEPTION 'A registration subject is required'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_guild_code) < 1 OR length(v_guild_code) > 64 THEN
    RAISE EXCEPTION 'A bounded guild code is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_attempt_generation IS NULL OR p_attempt_generation < 1 THEN
    RAISE EXCEPTION 'A positive onboarding attempt generation is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('verified_registration', 'support_verified') THEN
    RAISE EXCEPTION 'Unsupported bootstrap authority source'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize authority receipts with the other subject-scoped identity
  -- corridors. This also proves the subject and guild still exist at write
  -- time without trusting identifiers supplied by a browser.
  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));
  PERFORM 1 FROM auth.users WHERE id = p_subject FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration subject does not exist'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1
  FROM public.guild_config
  WHERE guild_code = v_guild_code
    AND enabled IS NOT FALSE
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registered guild does not exist or is disabled'
      USING ERRCODE = '22023';
  END IF;

  -- player_claim_audit is service-write-only under RLS. This receipt is the
  -- durable server-side bridge between the Guild-scoped registration proof and
  -- the later Player-only possession proof.
  INSERT INTO public.player_claim_audit (
    user_id,
    guild_code,
    source_path,
    outcome,
    details
  ) VALUES (
    p_subject,
    v_guild_code,
    'onboarding/guild-registration/bootstrap-authority',
    'success',
    jsonb_build_object(
      'version', 1,
      'attempt_generation', p_attempt_generation,
      'source', p_source
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.record_guild_bootstrap_claim_authority(uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_guild_bootstrap_claim_authority(uuid, text, bigint, text)
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_player_claim_audit_bootstrap_authority
  ON public.player_claim_audit (user_id, claimed_at DESC)
  WHERE source_path = 'onboarding/guild-registration/bootstrap-authority'
    AND outcome = 'success';

-- The registrar keeps verified authority even if another leader links first.
CREATE OR REPLACE FUNCTION public.mint_registrar_seat_invite(
  p_subject uuid,
  p_player_id text,
  p_upstream_digest text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user
  );
  v_player_id text := btrim(coalesce(p_player_id, ''));
  v_target record;
  v_invite_id uuid := gen_random_uuid();
  v_code text;
  v_attempt integer;
  v_expires_at timestamptz := clock_timestamp() + interval '10 minutes';
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Registrar seat invites may only be minted by the server route'
      USING ERRCODE = '42501', DETAIL = 'MINT_ROLE_REQUIRED';
  END IF;
  IF p_subject IS NULL THEN
    RAISE EXCEPTION 'A claim subject is required'
      USING ERRCODE = '22023', DETAIL = 'MINT_SUBJECT_REQUIRED';
  END IF;
  IF length(v_player_id) < 1 OR length(v_player_id) > 128 THEN
    RAISE EXCEPTION 'A bounded target player id is required'
      USING ERRCODE = '22023', DETAIL = 'MINT_PLAYER_REQUIRED';
  END IF;
  IF p_upstream_digest IS NULL OR p_upstream_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A sha256 hex upstream digest is required'
      USING ERRCODE = '22023', DETAIL = 'MINT_DIGEST_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));

  IF EXISTS (
    SELECT 1
    FROM public.player_identity_subject_authority_blocks AS block
    WHERE block.subject_user_id = p_subject
  ) THEN
    RAISE EXCEPTION 'Account authority is permanently blocked'
      USING ERRCODE = '42501', DETAIL = 'SUBJECT_AUTHORITY_BLOCKED';
  END IF;
  PERFORM 1 FROM auth.users WHERE id = p_subject FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim subject does not exist'
      USING ERRCODE = '42501', DETAIL = 'AUTH_SUBJECT_ABSENT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.player_mapping AS held
    WHERE held.user_id = p_subject AND held.is_current IS TRUE
  ) THEN
    RAISE EXCEPTION 'This account already holds a player seat'
      USING ERRCODE = '22023', DETAIL = 'SUBJECT_ALREADY_LINKED';
  END IF;

  SELECT mapping.id, mapping.player_id, mapping.display_name,
         mapping.guild_code, mapping.user_id, mapping.ownership_attestation_id,
         mapping.role, mapping.is_app_admin
  INTO v_target
  FROM public.player_mapping AS mapping
  WHERE mapping.player_id = v_player_id
    AND mapping.is_current IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not on a tracked guild roster yet'
      USING ERRCODE = '22023', DETAIL = 'PLAYER_NOT_ON_TRACKED_ROSTER';
  END IF;

  PERFORM pg_advisory_xact_lock(6209, hashtext(v_target.guild_code));
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_claim_audit AS receipt
    WHERE receipt.user_id = p_subject
      AND receipt.guild_code = v_target.guild_code
      AND receipt.source_path = 'onboarding/guild-registration/bootstrap-authority'
      AND receipt.outcome = 'success'
  ) THEN
    RAISE EXCEPTION 'Verified guild registration authority is required'
      USING ERRCODE = '42501', DETAIL = 'REGISTRATION_AUTHORITY_REQUIRED';
  END IF;
  IF NOT (
    lower(coalesce(v_target.role::text, '')) IN ('leader', 'officer')
    OR v_target.is_app_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'The registrar seat must be a guild leader or officer'
      USING ERRCODE = '22023', DETAIL = 'TARGET_NOT_INVITE_CAPABLE';
  END IF;
  IF v_target.user_id IS NOT NULL
     OR v_target.ownership_attestation_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'That player profile is already claimed'
      USING ERRCODE = '22023', DETAIL = 'TARGET_ALREADY_CLAIMED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.player_invite_codes AS live
    WHERE live.created_by = p_subject
      AND live.guild_code = v_target.guild_code
      AND live.used_at IS NULL
      AND live.revoked_at IS NULL
      AND live.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'A registrar claim for this account is already in flight'
      USING ERRCODE = '40001', DETAIL = 'BOOTSTRAP_ALREADY_IN_FLIGHT';
  END IF;

  FOR v_attempt IN 1..8 LOOP
    v_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.player_invite_codes AS invite
      WHERE invite.code = v_code
    );
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.player_invite_codes AS invite
    WHERE invite.code = v_code
  ) THEN
    RAISE EXCEPTION 'Could not allocate a unique invite code'
      USING ERRCODE = '40001', DETAIL = 'MINT_CODE_COLLISION';
  END IF;

  INSERT INTO public.player_invite_codes (
    id, code, player_id, display_name, guild_code,
    created_by, created_at, expires_at
  ) VALUES (
    v_invite_id, v_code, v_target.player_id, v_target.display_name,
    v_target.guild_code, p_subject, clock_timestamp(), v_expires_at
  );

  INSERT INTO public.player_claim_audit (
    user_id, player_id, guild_code, source_path, outcome, details
  ) VALUES (
    p_subject, v_target.player_id, v_target.guild_code,
    'onboarding/leader-seat/mint', 'success',
    jsonb_build_object(
      'action', 'mint_registrar_seat_invite',
      'invite_id', v_invite_id::text,
      'target_mapping_id', v_target.id,
      'upstream_digest', p_upstream_digest,
      'expires_at', v_expires_at
    )
  );

  RETURN v_code;
END
$function$;

REVOKE ALL ON FUNCTION public.mint_registrar_seat_invite(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_registrar_seat_invite(uuid, text, text)
  TO service_role;

COMMIT;

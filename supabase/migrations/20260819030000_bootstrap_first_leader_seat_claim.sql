-- A new guild's first leader claims their seat via an ordinary invite and the audited claim path.

BEGIN;

CREATE OR REPLACE FUNCTION public.mint_bootstrap_seat_invite(
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
  -- Short TTL: the caller consumes this immediately in the same flow. It is
  -- not an officer invite handed to someone else.
  v_expires_at timestamptz := clock_timestamp() + interval '10 minutes';
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Bootstrap seat invites may only be minted by the server route'
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
  -- sha256 hex of the route's upstream verification evidence. Bounded and
  -- shaped on purpose: an unbounded caller-supplied blob is what WI-6240
  -- architect criterion 7 refuses.
  IF p_upstream_digest IS NULL OR p_upstream_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A sha256 hex upstream digest is required'
      USING ERRCODE = '22023', DETAIL = 'MINT_DIGEST_REQUIRED';
  END IF;

  -- Same subject key the claim, deletion, and transfer corridors serialize on.
  PERFORM pg_advisory_xact_lock(6208, hashtext(p_subject::text));

  IF EXISTS (
    SELECT 1
    FROM public.player_identity_subject_authority_blocks AS block
    WHERE block.subject_user_id = p_subject
  ) THEN
    RAISE EXCEPTION 'Account authority is permanently blocked'
      USING ERRCODE = '42501', DETAIL = 'SUBJECT_AUTHORITY_BLOCKED';
  END IF;
  PERFORM 1
  FROM auth.users AS subject
  WHERE subject.id = p_subject
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim subject does not exist'
      USING ERRCODE = '42501', DETAIL = 'AUTH_SUBJECT_ABSENT';
  END IF;

  -- FIRST claim only. A subject that already holds a seat has an attested
  -- identity, and moving it is the transfer corridor's job
  -- (profile/change-player-id), which revokes the old attestation. Minting
  -- here for such a subject would hand them a second seat with no revocation.
  IF EXISTS (
    SELECT 1
    FROM public.player_mapping AS held
    WHERE held.user_id = p_subject
      AND held.is_current IS TRUE
  ) THEN
    RAISE EXCEPTION 'This account already holds a player seat'
      USING ERRCODE = '22023', DETAIL = 'SUBJECT_ALREADY_LINKED';
  END IF;

  -- player_id is globally unique, so a current row is exact by construction.
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

  -- The bootstrap seat must itself be able to invite the rest of the guild.
  -- create_player_invite_code admits only leader/officer, so handing the one
  -- self-claimable seat to a plain member would close this corridor behind an
  -- account that still cannot issue invites — recreating the exact deadlock
  -- this migration exists to remove.
  IF NOT (
    lower(coalesce(v_target.role::text, '')) IN ('leader', 'officer')
    OR v_target.is_app_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'The first self-claimed seat must be a guild leader or officer'
      USING ERRCODE = '22023', DETAIL = 'TARGET_NOT_INVITE_CAPABLE';
  END IF;

  -- BOOTSTRAP ONLY, measured by whether anyone can actually issue an invite.
  -- Testing merely "is any seat linked" would strand a guild whose first
  -- linked account is a plain member: they cannot mint an ordinary invite, and
  -- a blanket check would refuse to bootstrap the real leader.
  IF EXISTS (
    SELECT 1
    FROM public.player_mapping AS peer
    WHERE peer.guild_code = v_target.guild_code
      AND peer.is_current IS TRUE
      AND peer.user_id IS NOT NULL
      AND (
        lower(coalesce(peer.role::text, '')) IN ('leader', 'officer')
        OR peer.is_app_admin IS TRUE
      )
  ) THEN
    RAISE EXCEPTION 'That guild already has a linked leader or officer who can issue invites'
      USING ERRCODE = '22023', DETAIL = 'GUILD_ALREADY_BOOTSTRAPPED';
  END IF;

  -- Fix 1 (concurrency): the subject lock above serializes one subject, not
  -- one guild. Two different subjects minting for two different players in the
  -- same empty guild would both observe "no linked peer" and both receive a
  -- valid ordinary code, and validate_and_use_invite_code does not re-test
  -- bootstrap eligibility. Serialize on the guild too, and refuse while any
  -- live bootstrap invite for it is still outstanding — that closes the
  -- mint-mint-then-consume-both window the lock alone cannot.
  PERFORM pg_advisory_xact_lock(6209, hashtext(v_target.guild_code));
  IF EXISTS (
    SELECT 1
    FROM public.player_invite_codes AS live
    JOIN public.player_claim_audit AS receipt
      ON receipt.details ->> 'invite_id' = live.id::text
     AND receipt.source_path = 'onboarding/leader-seat/mint'
    WHERE live.guild_code = v_target.guild_code
      AND live.used_at IS NULL
      AND live.revoked_at IS NULL
      AND live.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'A bootstrap claim for that guild is already in flight'
      USING ERRCODE = '40001', DETAIL = 'BOOTSTRAP_ALREADY_IN_FLIGHT';
  END IF;
  -- Mirror of the transfer corridor's target predicate. A row carrying a stale
  -- attestation id with no user binding must fail HERE, at mint time, rather
  -- than minting forever and burning each code downstream.
  IF v_target.user_id IS NOT NULL
     OR v_target.ownership_attestation_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'That player profile is already claimed'
      USING ERRCODE = '22023', DETAIL = 'TARGET_ALREADY_CLAIMED';
  END IF;

  -- ORDINARY invite format (12 uppercase hex), matching
  -- create_player_invite_code. Deliberately NOT the PP6240- possession-proof
  -- prefix: that prefix is barred from validate_and_use_invite_code and
  -- belongs to the transfer corridor. This code is meant to bind through the
  -- ordinary claim path.
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

  -- Mint receipt. Carries the upstream digest (the invite row has nowhere to
  -- put one) so a seat claimed this way stays attributable after the fact.
  INSERT INTO public.player_claim_audit (
    user_id, player_id, guild_code, source_path, outcome, details
  ) VALUES (
    p_subject, v_target.player_id, v_target.guild_code,
    'onboarding/leader-seat/mint', 'success',
    jsonb_build_object(
      'action', 'mint_bootstrap_seat_invite',
      'invite_id', v_invite_id::text,
      'target_mapping_id', v_target.id,
      'upstream_digest', p_upstream_digest,
      'expires_at', v_expires_at
    )
  );

  RETURN v_code;
END
$function$;

-- A bootstrap code belongs to the one subject who proved possession: bind consumption
-- to that subject, then delegate. SECURITY DEFINER keeps the JWT, so auth.uid() holds.
CREATE OR REPLACE FUNCTION public.claim_bootstrap_seat(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user
  );
  v_invite record;
BEGIN
  IF v_request_role <> 'authenticated' OR v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to claim a bootstrap seat'
      USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR length(btrim(p_code)) < 6 OR length(p_code) > 64 THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Invalid or expired invite code',
      'error_code', 'INVALID_CODE'
    );
  END IF;

  SELECT invite.id, invite.created_by, invite.used_at, invite.revoked_at,
         invite.expires_at
  INTO v_invite
  FROM public.player_invite_codes AS invite
  WHERE invite.code = upper(btrim(p_code))
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Invalid or expired invite code',
      'error_code', 'INVALID_CODE'
    );
  END IF;

  -- The binding this corridor adds over the officer path. Deliberately the
  -- same opaque answer as an unknown code: a mismatched claimant must not be
  -- able to distinguish "wrong account" from "no such code".
  IF v_invite.created_by IS DISTINCT FROM v_auth_uid THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Invalid or expired invite code',
      'error_code', 'INVALID_CODE'
    );
  END IF;

  RETURN public.validate_and_use_invite_code(p_code, v_auth_uid);
END
$function$;

-- Load-bearing: default privileges grant EXECUTE on new functions to anon/authenticated.
REVOKE ALL ON FUNCTION public.mint_bootstrap_seat_invite(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_bootstrap_seat_invite(uuid, text, text)
  TO service_role;

-- Never service_role: it would bypass the auth.uid() binding.
REVOKE ALL ON FUNCTION public.claim_bootstrap_seat(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_bootstrap_seat(text) TO authenticated;

COMMIT;

-- get_invite_code_info returns one generic invalid shape, so anon cannot learn a
-- guessed code was once real. anon keeps EXECUTE for the pre-login claim page.
-- target-db: general

BEGIN;

CREATE OR REPLACE FUNCTION public.get_invite_code_info(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invite RECORD;
BEGIN
  -- WI-6240 (B1): a possession-proof code must be indistinguishable from a
  -- nonexistent code through this anon-reachable probe. PS-377 folds this
  -- into the single generic invalid response below rather than special
  -- casing its own message.
  IF public.is_possession_proof_code(UPPER(p_code)) THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Invalid or expired invite code.'
    );
  END IF;

  SELECT
    pic.*,
    gc.display_name as guild_name
  INTO v_invite
  FROM player_invite_codes pic
  JOIN guild_config gc ON gc.guild_code = pic.guild_code
  WHERE pic.code = UPPER(p_code);

  -- PS-377: not-found, used, revoked and expired are now ONE shape. Do not
  -- reintroduce a per-reason branch here -- that is exactly the oracle this
  -- migration closes. supabase/tests/pgtap/ps377_invite_code_info_shape.sql
  -- pins byte-identical output across all four.
  IF NOT FOUND
     OR v_invite.used_at IS NOT NULL
     OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at < NOW()
  THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Invalid or expired invite code.'
    );
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'player_id', v_invite.player_id,
    'display_name', v_invite.display_name,
    'guild_code', v_invite.guild_code,
    'guild_name', v_invite.guild_name,
    'expires_at', v_invite.expires_at
  );
END;
$$;

ALTER FUNCTION public.get_invite_code_info(p_code text) OWNER TO postgres;

COMMIT;

NOTIFY pgrst, 'reload schema';

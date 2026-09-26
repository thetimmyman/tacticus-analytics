-- The ledgers are function-only (RLS without policies, closed even to service_role);
-- this definer is the sanctioned read for the claim-consume route.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.claim_consume_read_invite(p_code text)
RETURNS TABLE (
  id uuid,
  code text,
  player_id text,
  guild_code text,
  display_name text,
  expires_at timestamp with time zone,
  used_at timestamp with time zone,
  revoked_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    invite.id,
    invite.code,
    invite.player_id,
    invite.guild_code,
    invite.display_name,
    invite.expires_at,
    invite.used_at,
    invite.revoked_at
  FROM public.player_invite_codes AS invite
  WHERE invite.code = p_code;
$$;

ALTER FUNCTION public.claim_consume_read_invite(p_code text) OWNER TO postgres;

-- service_role only; browsers must never see live codes.
REVOKE ALL ON FUNCTION public.claim_consume_read_invite(p_code text)
  FROM PUBLIC, anon, authenticated;

-- analytics_ro is production-only; an unconditional REVOKE would abort clean replays.
DO $claim_read_analytics_ro$
BEGIN
  IF to_regrole('analytics_ro') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.claim_consume_read_invite(p_code text)
      FROM analytics_ro;
  END IF;
END;
$claim_read_analytics_ro$;

GRANT EXECUTE ON FUNCTION public.claim_consume_read_invite(p_code text)
  TO service_role;

COMMIT;

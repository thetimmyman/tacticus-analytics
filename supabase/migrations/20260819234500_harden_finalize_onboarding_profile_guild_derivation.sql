-- finalize_onboarding_profile() derives guild and eligibility from the caller's
-- server-written roster seat, not client-writable onboarding_progress.

BEGIN;

-- The dead profiles branch is dropped: it wrote role from client-controlled role_intent.
CREATE OR REPLACE FUNCTION public.finalize_onboarding_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_seat_guilds bigint;
  v_guild_code text;
BEGIN
  -- The trigger's WHEN clause already tests new.profile_status. Keeping the
  -- transition guard inside the function too means a future CREATE TRIGGER
  -- cannot lose it and start re-firing this UPDATE on every unrelated write.
  IF new.profile_status IS DISTINCT FROM 'complete'
     OR old.profile_status IS NOT DISTINCT FROM 'complete'
  THEN
    RETURN new;
  END IF;

  -- The whole authority decision, from server-written state only.
  SELECT count(DISTINCT seat.guild_code), min(seat.guild_code)
  INTO v_seat_guilds, v_guild_code
  FROM public.player_mapping AS seat
  WHERE seat.user_id = new.user_id
    AND seat.is_current IS TRUE
    AND lower(coalesce(seat.role::text, '')) IN ('leader', 'officer');

  -- No qualifying seat, or an ambiguous one. Not a failure the claim should be
  -- rolled back for: the profile is legitimately complete, the caller has
  -- simply not earned the owner stamp. Return quietly.
  IF v_seat_guilds <> 1 OR v_guild_code IS NULL THEN
    RETURN new;
  END IF;

  UPDATE public.guild_config
  SET "API_Owner" = coalesce(
    (SELECT email FROM auth.users WHERE id = new.user_id),
    "API_Owner"
  )
  WHERE guild_code = v_guild_code;

  RETURN new;
END
$function$;

-- Free to revoke: triggers do not re-check EXECUTE and the owner keeps it.
REVOKE ALL ON FUNCTION public.create_onboarding_progress()
  FROM PUBLIC, anon, authenticated;

COMMIT;

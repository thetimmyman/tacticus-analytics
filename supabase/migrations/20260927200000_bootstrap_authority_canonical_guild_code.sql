-- Resolve the bootstrap-authority guild by its canonical stored code. Legacy
-- guilds store a lower-case UUID as guild_code while tag guilds store upper
-- case, so matching is exact-trimmed first, then upper-, then lower-cased.

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
  v_trimmed_code text := btrim(coalesce(p_guild_code, ''));
  v_guild_code text;
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'Bootstrap claim authority may only be recorded by the server'
      USING ERRCODE = '42501';
  END IF;
  IF p_subject IS NULL THEN
    RAISE EXCEPTION 'A registration subject is required'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_trimmed_code) < 1 OR length(v_trimmed_code) > 64 THEN
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

  -- Exact trimmed code first, then upper, then lower: a tag guild's code is
  -- upper-cased while a UUID guild's code is stored lower-cased. The resolved
  -- row's own guild_code is what the receipt records, so readers find it.
  SELECT gc.guild_code
    INTO v_guild_code
    FROM public.guild_config AS gc
   WHERE gc.enabled IS NOT FALSE
     AND gc.guild_code IN (v_trimmed_code, upper(v_trimmed_code), lower(v_trimmed_code))
   ORDER BY CASE gc.guild_code
              WHEN v_trimmed_code THEN 0
              WHEN upper(v_trimmed_code) THEN 1
              WHEN lower(v_trimmed_code) THEN 2
              ELSE 3
            END
   LIMIT 1
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

COMMIT;

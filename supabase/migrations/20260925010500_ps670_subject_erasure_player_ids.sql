-- Let account erasure reach departed players (departure NULLs player_mapping.user_id)
-- via a service_role-only reader over the attestation trail.
-- target-db: general
-- Anonymisation is irreversible, so ambiguity keeps history: a disputed attestation,
-- a mapping now bound to another user, or another live subject's claim excludes it.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'PS-670 (20260925010500) is general-database-only. Refusing to apply to %', current_database();
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.subject_erasure_player_ids(p_user_id uuid)
RETURNS TABLE (player_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH disputed AS (
    -- Revocations that say the binding itself was wrong or is in question.
    SELECT revocation.attestation_id
    FROM public.player_identity_attestation_revocations AS revocation
    WHERE revocation.reason IN (
            'admin_unlink', 'support_reverify', 'authority_recovery',
            'mapping_delete'
          )
       OR (
            revocation.reason = 'player_id_correction'
            AND revocation.source IS DISTINCT FROM 'profile/change-player-id'
          )
  ),
  attested AS (
    SELECT attestation.player_id
    FROM public.player_identity_attestations AS attestation
    WHERE attestation.subject_user_id = p_user_id
      -- (a) the subject's own binding is not disputed
      AND NOT EXISTS (
        SELECT 1 FROM disputed WHERE disputed.attestation_id = attestation.id
      )
      -- (b) no DIFFERENT live user owns the player now
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_mapping AS other
        WHERE other.player_id = attestation.player_id
          AND other.user_id IS NOT NULL
          AND other.user_id <> p_user_id
      )
      -- (c) no OTHER still-existing subject holds a non-disputed attestation
      --     for the same player (A->B handoff: ambiguous, don't touch)
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_attestations AS other_attestation
        JOIN auth.users AS other_user
          ON other_user.id = other_attestation.subject_user_id
        WHERE other_attestation.player_id = attestation.player_id
          AND other_attestation.subject_user_id <> p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM disputed
            WHERE disputed.attestation_id = other_attestation.id
          )
      )
  ),
  candidates AS (
    SELECT mapping.player_id
    FROM public.player_mapping AS mapping
    WHERE mapping.user_id = p_user_id
    UNION
    SELECT attested.player_id FROM attested
  )
  SELECT candidates.player_id
  FROM candidates
  WHERE p_user_id IS NOT NULL
    AND candidates.player_id IS NOT NULL
    AND btrim(candidates.player_id) <> ''
  ORDER BY candidates.player_id
$function$;

ALTER FUNCTION public.subject_erasure_player_ids(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.subject_erasure_player_ids(uuid) IS
  'PS-670: the subject''s player ids for account erasure -- user_id-bound '
  'mappings plus attested players (incl. departed), minus ownership-disputed '
  'attestations, players now owned by another user, and players another '
  'existing subject also holds a non-disputed attestation for. '
  'service_role only.';

-- analytics_ro is absent in throwaway lanes, so its REVOKE is conditional.
REVOKE ALL ON FUNCTION public.subject_erasure_player_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subject_erasure_player_ids(uuid)
  FROM anon, authenticated;
DO $revoke$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    REVOKE ALL ON FUNCTION public.subject_erasure_player_ids(uuid) FROM analytics_ro;
  END IF;
END
$revoke$;
GRANT EXECUTE ON FUNCTION public.subject_erasure_player_ids(uuid)
  TO service_role;

-- Reachability via has_function_privilege (which sees PUBLIC); correctness by calling it.
DO $verify$
DECLARE
  v_fn   oid := to_regprocedure('public.subject_erasure_player_ids(uuid)');
  v_role text;
  v_rows integer;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'PS-670 verify: subject_erasure_player_ids(uuid) missing on %', current_database();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_fn AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'PS-670 verify: subject_erasure_player_ids must be SECURITY DEFINER with a pinned search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.proacl IS NULL) THEN
    RAISE EXCEPTION 'PS-670 verify: no ACL -- PUBLIC still holds default EXECUTE';
  END IF;
  FOR v_role IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'analytics_ro')
  LOOP
    IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-670 verify: % holds EXECUTE on subject_erasure_player_ids', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-670 verify: service_role lacks EXECUTE on subject_erasure_player_ids';
  END IF;
  SELECT count(*) INTO v_rows
  FROM public.subject_erasure_player_ids('00000000-0000-0000-0000-000000000000'::uuid);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'PS-670 verify: a subject with no mappings returned % ids', v_rows;
  END IF;
  RAISE NOTICE 'PS-670 verify: OK -- subject_erasure_player_ids installed on %, service_role only', current_database();
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Adopt record_player_api_key_auth_failure. The General database already has
-- it, but no migration here defines it, so a database built from this history
-- lacks the counter that roster-backfill now calls. Body, defaults and the
-- service_role-only EXECUTE match the live function, so applying this to the
-- live database changes nothing.

-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.record_player_api_key_auth_failure(p_player_id text, p_cooldown_seconds integer DEFAULT 600, p_decay_seconds integer DEFAULT 86400, p_threshold integer DEFAULT 3)
 RETURNS TABLE(strikes integer, flagged boolean, counted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_strikes integer;
  v_flagged boolean := false;
BEGIN
  -- Atomic: cooldown gate in WHERE, decay restart in CASE. A rejection inside
  -- the cooldown matches no row and leaves v_strikes NULL.
  UPDATE public.player_mapping pm
  SET consecutive_api_key_failures =
        CASE
          WHEN pm.last_api_key_failure_at IS NULL
            OR pm.last_api_key_failure_at < now() - make_interval(secs => p_decay_seconds)
          THEN 1
          ELSE pm.consecutive_api_key_failures + 1
        END,
      last_api_key_failure_at = now(),
      updated_at = now()
  WHERE pm.player_id = p_player_id
    AND pm.is_current
    AND (pm.last_api_key_failure_at IS NULL
         OR pm.last_api_key_failure_at <= now() - make_interval(secs => p_cooldown_seconds))
  RETURNING pm.consecutive_api_key_failures INTO v_strikes;

  IF v_strikes IS NULL THEN
    -- Suppressed by the cooldown (or no such current row). Report the standing
    -- count without touching it, and explicitly report counted=false so the
    -- caller can tell "throttled burst" from "strike recorded".
    SELECT pm.consecutive_api_key_failures INTO v_strikes
    FROM public.player_mapping pm
    WHERE pm.player_id = p_player_id AND pm.is_current;
    RETURN QUERY SELECT coalesce(v_strikes, 0), false, false;
    RETURN;
  END IF;

  IF v_strikes >= p_threshold THEN
    UPDATE public.player_mapping
    SET api_key_is_valid = false,
        updated_at = now()
    WHERE player_id = p_player_id AND is_current;
    v_flagged := true;
  END IF;

  RETURN QUERY SELECT v_strikes, v_flagged, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_player_api_key_auth_failure(text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_player_api_key_auth_failure(text, integer, integer, integer)
  TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261008030000', 'adopt_player_api_key_strike_counter')
ON CONFLICT (version) DO NOTHING;

COMMIT;

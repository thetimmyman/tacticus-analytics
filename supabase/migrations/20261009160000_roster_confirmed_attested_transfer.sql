-- Moves claimed player mappings into the guild whose live Tacticus roster lists them.
-- A player is in one guild at a time, so that roster (read with the guild's own key)
-- is enough; callers never pass LOKI-only ids. The move goes through the attested-move
-- guard's owner-only escapes: a single-use permit (the live guard; its table exists only
-- there) and the transaction-local reconciliation subject (the guard in this history).

-- Rollback: DROP FUNCTION public.transfer_roster_confirmed_players(text, text[]) and
-- delete this version from supabase_migrations.schema_migrations. Moved rows stay put.

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

CREATE OR REPLACE FUNCTION public.transfer_roster_confirmed_players(
  p_target_guild_code text,
  p_player_ids text[]
)
RETURNS TABLE (player_id text, from_guild_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row record;
  v_permits_present boolean :=
    to_regclass('public.guild_membership_move_permits') IS NOT NULL;
BEGIN
  IF p_player_ids IS NULL OR cardinality(p_player_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_player_ids) > 200 THEN
    RAISE EXCEPTION 'transfer_roster_confirmed_players: at most 200 players per call'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guild_config AS gc
    WHERE gc.guild_code = p_target_guild_code AND gc.enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'transfer_roster_confirmed_players: target guild % is not an enabled guild',
      p_target_guild_code
      USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT pm.id, pm.player_id, pm.guild_code, pm.user_id
    FROM public.player_mapping AS pm
    WHERE pm.player_id = ANY (p_player_ids)
      AND pm.guild_code IS DISTINCT FROM p_target_guild_code
      AND pm.protected IS NOT TRUE
    ORDER BY pm.id
    FOR UPDATE
  LOOP
    IF v_permits_present THEN
      EXECUTE
        'INSERT INTO public.guild_membership_move_permits
           (txid, player_id, from_guild_code, to_guild_code)
         VALUES (txid_current(), $1, $2, $3)'
        USING v_row.player_id, v_row.guild_code, p_target_guild_code;
    END IF;
    PERFORM set_config(
      'app.guild_membership_reconciliation_subject',
      coalesce(v_row.user_id::text, ''),
      true
    );

    UPDATE public.player_mapping AS pm
    SET guild_code = p_target_guild_code,
        role = 'member',
        updated_at = now()
    WHERE pm.id = v_row.id;

    PERFORM set_config('app.guild_membership_reconciliation_subject', '', true);

    -- A permit for a row the guard did not check (not current, or not
    -- attested) is never consumed; it must not outlive this call.
    IF v_permits_present THEN
      EXECUTE
        'DELETE FROM public.guild_membership_move_permits
         WHERE txid = txid_current() AND player_id = $1'
        USING v_row.player_id;
    END IF;

    RAISE LOG 'transfer_roster_confirmed_players: moved player_mapping id=% from % to %',
      v_row.id, v_row.guild_code, p_target_guild_code;

    player_id := v_row.player_id;
    from_guild_code := v_row.guild_code;
    RETURN NEXT;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.transfer_roster_confirmed_players(text, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_roster_confirmed_players(text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_roster_confirmed_players(text, text[])
  TO service_role;

COMMENT ON FUNCTION public.transfer_roster_confirmed_players(text, text[]) IS
  'Moves claimed player mappings into p_target_guild_code. Callers pass only '
  'player ids the target guild''s live Tacticus roster lists exactly once. '
  'service_role only.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261009160000', 'roster_confirmed_attested_transfer')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

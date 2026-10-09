-- A roster-confirmed move now also takes the target guild's cluster, so the player loses the
-- source cluster's read access in the same transaction, and writes a player_claim_audit
-- receipt. The cluster-preserving sync trigger keeps a cluster a sync write blanks; it now
-- lets this move clear it when the target guild has none (it was a guild change, not a blank).

-- Rollback: re-apply 20261009160000 after DROP FUNCTION public.transfer_roster_confirmed_players(text, text[]),
-- restore preserve_player_cluster_on_sync from the baseline, and delete this ledger version.

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

CREATE OR REPLACE FUNCTION public.preserve_player_cluster_on_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.guild_code IS DISTINCT FROM NEW.guild_code
    AND current_setting('app.roster_transfer_cluster_reset', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.cluster_code IS NOT NULL AND NEW.cluster_code IS NULL THEN
    NEW.cluster_code := OLD.cluster_code;
  END IF;
  IF OLD.cluster_id IS NOT NULL AND NEW.cluster_id IS NULL THEN
    NEW.cluster_id := OLD.cluster_id;
  END IF;
  RETURN NEW;
END
$function$;

DROP FUNCTION IF EXISTS public.transfer_roster_confirmed_players(text, text[]);

CREATE FUNCTION public.transfer_roster_confirmed_players(
  p_target_guild_code text,
  p_player_ids text[]
)
RETURNS TABLE (
  player_id text,
  from_guild_code text,
  cluster_code text,
  cluster_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row record;
  v_cluster_code text;
  v_cluster_id uuid;
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

  SELECT gc.cluster_code, gc.cluster_id
  INTO v_cluster_code, v_cluster_id
  FROM public.guild_config AS gc
  WHERE gc.guild_code = p_target_guild_code AND gc.enabled IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_roster_confirmed_players: target guild % is not an enabled guild',
      p_target_guild_code
      USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT pm.id, pm.player_id, pm.guild_code, pm.user_id,
      pm.cluster_code AS old_cluster_code, pm.cluster_id AS old_cluster_id
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
    PERFORM set_config('app.roster_transfer_cluster_reset', 'on', true);

    UPDATE public.player_mapping AS pm
    SET guild_code = p_target_guild_code,
        role = 'member',
        cluster_code = v_cluster_code,
        cluster_id = v_cluster_id,
        updated_at = now()
    WHERE pm.id = v_row.id;

    PERFORM set_config('app.roster_transfer_cluster_reset', '', true);
    PERFORM set_config('app.guild_membership_reconciliation_subject', '', true);

    -- A permit for a row the guard did not check (not current, or not
    -- attested) is never consumed; it must not outlive this call.
    IF v_permits_present THEN
      EXECUTE
        'DELETE FROM public.guild_membership_move_permits
         WHERE txid = txid_current() AND player_id = $1'
        USING v_row.player_id;
    END IF;

    INSERT INTO public.player_claim_audit (
      user_id, player_id, guild_code, source_path, outcome, details
    ) VALUES (
      v_row.user_id,
      v_row.player_id,
      p_target_guild_code,
      'sync/roster-confirmed-transfer',
      'success',
      jsonb_build_object(
        'action', 'roster_confirmed_membership_transfer',
        'mapping_id', v_row.id,
        'source_guild_code', v_row.guild_code,
        'target_guild_code', p_target_guild_code,
        'target_evidence', 'exactly_once_in_live_tacticus_roster',
        'target_role', 'member',
        'source_cluster_code', v_row.old_cluster_code,
        'source_cluster_id', v_row.old_cluster_id,
        'target_cluster_code', v_cluster_code,
        'target_cluster_id', v_cluster_id
      )
    );

    player_id := v_row.player_id;
    from_guild_code := v_row.guild_code;
    cluster_code := v_cluster_code;
    cluster_id := v_cluster_id;
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
  'Moves claimed player mappings into p_target_guild_code and its cluster, with a '
  'player_claim_audit receipt. Callers pass only player ids the target guild''s live '
  'Tacticus roster lists exactly once. service_role only.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261009170000', 'roster_transfer_cluster_and_audit')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

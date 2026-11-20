-- target-db: general
-- A guild leader takes their guild out of its cluster: one owner-only call clears the
-- guild's cluster and its mappings' clusters in one transaction, with an audit receipt.
-- The sync trigger still blocks blanking a mapping's cluster, except for this call's guild.
-- Leadership is rechecked under the guild row lock. The cluster creator is refused, since
-- they would keep creator authority over a cluster they had left. Raid rows follow through
-- trg_guild_config_restamp_raid_cluster, as on any cluster change.

-- Rollback: DROP FUNCTION public.leave_guild_cluster(text, uuid, uuid), re-apply the
-- preserve_player_cluster_on_sync body from 20261009170000, and delete this ledger version.
-- A guild that left keeps its NULL cluster; rejoin it through the invite or claim flow.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

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
  IF OLD.guild_code IS NOT DISTINCT FROM NEW.guild_code
    AND NEW.guild_code IS NOT NULL
    AND current_setting('app.guild_cluster_leave_reset', true) = NEW.guild_code THEN
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

CREATE FUNCTION public.leave_guild_cluster(
  p_guild_code text,
  p_expected_cluster_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (
  guild_code text,
  previous_cluster_id uuid,
  previous_cluster_code text,
  cleared_mappings integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_guild record;
  v_cleared integer;
BEGIN
  IF p_guild_code IS NULL OR p_expected_cluster_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'leave_guild_cluster: guild, expected cluster and actor are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT gc.id, gc.guild_code, gc.cluster_id, gc.cluster_code::text AS cluster_code
  INTO v_guild
  FROM public.guild_config AS gc
  WHERE gc.guild_code = p_guild_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave_guild_cluster: guild % does not exist', p_guild_code
      USING ERRCODE = 'P0002';
  END IF;

  IF v_guild.cluster_id IS DISTINCT FROM p_expected_cluster_id THEN
    RAISE EXCEPTION 'leave_guild_cluster: guild % is not in the expected cluster', p_guild_code
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.player_mapping AS pm
    WHERE pm.user_id = p_actor_user_id
      AND pm.is_current IS TRUE
      AND pm.guild_code = v_guild.guild_code
      AND lower(pm.role::text) = 'leader'
  ) THEN
    RAISE EXCEPTION 'leave_guild_cluster: only a current leader of % can take it out of its cluster',
      p_guild_code
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.clusters AS c
    WHERE c.id = v_guild.cluster_id
      AND c.created_by = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'leave_guild_cluster: the cluster creator cannot leave their own cluster'
      USING ERRCODE = '42501', HINT = 'cluster_creator';
  END IF;

  -- _sync_guild_cluster_id clears cluster_id with cluster_code; both are set for clarity.
  UPDATE public.guild_config AS gc
  SET cluster_code = NULL,
      cluster_id = NULL,
      is_cluster = false,
      updated_at = now()
  WHERE gc.id = v_guild.id;

  PERFORM set_config('app.guild_cluster_leave_reset', v_guild.guild_code, true);

  UPDATE public.player_mapping AS pm
  SET cluster_code = NULL,
      cluster_id = NULL,
      updated_at = now()
  WHERE pm.guild_code = v_guild.guild_code
    AND (pm.cluster_code IS NOT NULL OR pm.cluster_id IS NOT NULL);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  PERFORM set_config('app.guild_cluster_leave_reset', '', true);

  INSERT INTO public.audit_logs (user_id, action, details)
  VALUES (
    p_actor_user_id,
    'guild_left_cluster',
    jsonb_build_object(
      'guild_code', v_guild.guild_code,
      'previous_cluster_id', v_guild.cluster_id,
      'previous_cluster_code', v_guild.cluster_code,
      'cleared_mappings', v_cleared
    )
  );

  guild_code := v_guild.guild_code;
  previous_cluster_id := v_guild.cluster_id;
  previous_cluster_code := v_guild.cluster_code;
  cleared_mappings := v_cleared;
  RETURN NEXT;
END;
$function$;

ALTER FUNCTION public.leave_guild_cluster(text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.leave_guild_cluster(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_guild_cluster(text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.leave_guild_cluster(text, uuid, uuid) IS
  'Takes p_guild_code out of its cluster when it is still in p_expected_cluster_id and '
  'p_actor_user_id is a current leader of it who did not create the cluster. Clears the '
  'cluster on the guild and on every mapping of the guild, and writes an audit_logs row. '
  'service_role only.';

DO $verify$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
      AND has_function_privilege(
        role_name, 'public.leave_guild_cluster(text, uuid, uuid)', 'EXECUTE')
    THEN
      RAISE EXCEPTION '% can execute leave_guild_cluster', role_name;
    END IF;
  END LOOP;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261120170000', 'guild_leave_cluster')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

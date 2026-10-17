-- target-db: general
-- Re-tag each guild's raid rows with its current cluster and keep them in step.
-- The sync tags rows at write time and only rewrites recent seasons, so older
-- seasons kept a stale cluster and cluster-scoped reads hid them.
-- Rollback: drop trg_guild_config_restamp_raid_cluster and its function, then
-- restore (id, cluster_code, cluster_id) from the pre-apply backup.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- SECURITY DEFINER because EOT_GR_data is writable only by service_role, and a
-- cluster change can come from a definer RPC or a service-role route alike.
CREATE OR REPLACE FUNCTION public.guild_config_restamp_raid_cluster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public."EOT_GR_data" d
     SET cluster_code = NEW.cluster_code,
         cluster_id = NEW.cluster_id
   WHERE d."Guild" = NEW.guild_code
     AND (d.cluster_code IS DISTINCT FROM NEW.cluster_code
          OR d.cluster_id IS DISTINCT FROM NEW.cluster_id);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.guild_config_restamp_raid_cluster() IS
  'AFTER UPDATE on guild_config: when a guild''s cluster changes, every EOT_GR_data row of that guild takes the new cluster_code and cluster_id, so older seasons stay visible to the guild''s current cluster.';

REVOKE ALL ON FUNCTION public.guild_config_restamp_raid_cluster() FROM PUBLIC;

CREATE OR REPLACE TRIGGER trg_guild_config_restamp_raid_cluster
  AFTER UPDATE OF cluster_code, cluster_id ON public.guild_config
  FOR EACH ROW
  WHEN (OLD.cluster_code IS DISTINCT FROM NEW.cluster_code
        OR OLD.cluster_id IS DISTINCT FROM NEW.cluster_id)
  EXECUTE FUNCTION public.guild_config_restamp_raid_cluster();

UPDATE public."EOT_GR_data" d
   SET cluster_code = g.cluster_code,
       cluster_id = g.cluster_id
  FROM public.guild_config g
 WHERE g.guild_code = d."Guild"
   AND (d.cluster_code IS DISTINCT FROM g.cluster_code
        OR d.cluster_id IS DISTINCT FROM g.cluster_id);

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."EOT_GR_data" d
      JOIN public.guild_config g ON g.guild_code = d."Guild"
     WHERE d.cluster_code IS DISTINCT FROM g.cluster_code
        OR d.cluster_id IS DISTINCT FROM g.cluster_id
  ) THEN
    RAISE EXCEPTION 'raid rows still disagree with their guild''s cluster';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

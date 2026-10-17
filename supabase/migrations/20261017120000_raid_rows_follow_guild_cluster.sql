-- target-db: general
-- Raid rows carry the cluster of their guild. The sync stamps the guild's
-- cluster when it writes a row and only rewrites recent seasons, so a guild
-- that joins, leaves or changes cluster keeps its older seasons under the old
-- value. Cluster-scoped reads (the season list among them) then hide those
-- seasons from the guild, and a cluster the guild left can still read them.
--
-- This migration re-tags the existing rows from guild_config, then keeps them
-- in step: a change to a guild's cluster re-tags all of that guild's raid rows.
--
-- Rollback: DROP TRIGGER trg_guild_config_restamp_raid_cluster ON
-- public.guild_config; DROP FUNCTION public.guild_config_restamp_raid_cluster().
-- The re-tagged values were backed up as (id, cluster_code, cluster_id) before
-- apply and can be restored from that copy.
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

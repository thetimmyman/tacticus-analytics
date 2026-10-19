-- target-db: general
-- Every raid row write takes its cluster from guild_config at write time. The
-- sync caches a guild's cluster before calling the game API, so a sync that
-- spans a cluster change would otherwise write the departed cluster back.
-- Rollback: drop trg_eot_gr_data_cluster_from_guild and its function.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- SECURITY DEFINER so the guild_config read does not depend on the writer's grants.
CREATE OR REPLACE FUNCTION public.eot_gr_data_cluster_from_guild()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_cluster_code character varying;
  v_cluster_id uuid;
BEGIN
  SELECT g.cluster_code, g.cluster_id
    INTO v_cluster_code, v_cluster_id
    FROM public.guild_config g
   WHERE g.guild_code = NEW."Guild";
  -- A row for a guild with no config keeps the cluster it was written with.
  IF FOUND THEN
    NEW.cluster_code := v_cluster_code;
    NEW.cluster_id := v_cluster_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.eot_gr_data_cluster_from_guild() IS
  'BEFORE INSERT OR UPDATE on EOT_GR_data: cluster_code and cluster_id always come from the guild''s current guild_config row, so a sync holding a stale cluster cannot write it.';

REVOKE ALL ON FUNCTION public.eot_gr_data_cluster_from_guild() FROM PUBLIC;

CREATE OR REPLACE TRIGGER trg_eot_gr_data_cluster_from_guild
  BEFORE INSERT OR UPDATE ON public."EOT_GR_data"
  FOR EACH ROW
  EXECUTE FUNCTION public.eot_gr_data_cluster_from_guild();

NOTIFY pgrst, 'reload schema';

COMMIT;

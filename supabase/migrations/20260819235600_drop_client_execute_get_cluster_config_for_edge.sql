-- get_cluster_config_for_edge returns every guild credential in a cluster and has no
-- callers: revoke client roles; service_role keeps EXECUTE.

BEGIN;

-- Created out of band, so guard on to_regprocedure (NULL for an unknown signature).
DO $$
BEGIN
  IF to_regprocedure('public.get_cluster_config_for_edge(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_cluster_config_for_edge(text)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_cluster_config_for_edge(text)
      TO service_role;
  ELSE
    RAISE NOTICE
      'get_cluster_config_for_edge(text) absent; skipping ACL tightening';
  END IF;
END
$$;

COMMIT;

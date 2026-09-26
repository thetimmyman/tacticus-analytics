-- anon could read every active cluster, including invite codes and creator auth UUIDs.

BEGIN;

-- Load-bearing: a policy cannot admit a role without a grant, even a later TO PUBLIC one.
REVOKE ALL ON TABLE public.clusters FROM PUBLIC;
REVOKE ALL ON TABLE public.clusters FROM anon;

GRANT ALL ON TABLE public.clusters TO service_role;

-- analytics_ro is production-only; an unguarded GRANT would abort a clean replay.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    GRANT SELECT ON TABLE public.clusters TO analytics_ro;
  END IF;
END
$$;

-- analytics_ro lacks BYPASSRLS and only read via the TO PUBLIC policy, so it is named
-- explicitly; `TO authenticated` alone would silently show it zero rows.
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for active clusters" ON public.clusters;
DROP POLICY IF EXISTS public_view_active_clusters ON public.clusters;
DROP POLICY IF EXISTS clusters_client_read_active ON public.clusters;

DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY clusters_client_read_active ON public.clusters '
    'FOR SELECT TO %s USING (is_active = true)',
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro')
        THEN 'authenticated, analytics_ro'
      ELSE 'authenticated'
    END
  );
END
$$;

COMMIT;

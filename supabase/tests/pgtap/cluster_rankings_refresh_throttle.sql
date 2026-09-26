BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(15);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260730200000'
  ),
  'cluster rankings throttle migration is recorded'
);

SELECT has_table(
  'public',
  'cluster_rankings_refresh_state',
  'durable cluster rankings refresh state exists'
);

SELECT is(
  (
    SELECT array_agg(attname::text ORDER BY attnum)
    FROM pg_attribute
    WHERE attrelid = 'public.cluster_rankings_refresh_state'::regclass
      AND attnum > 0
      AND NOT attisdropped
  ),
  ARRAY['singleton', 'last_refreshed_at']::text[],
  'refresh state exposes only the singleton key and success timestamp'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS idx
    JOIN pg_attribute AS attr
      ON attr.attrelid = idx.indrelid
     AND attr.attnum = ANY(idx.indkey)
    WHERE idx.indrelid = 'public.cluster_rankings_refresh_state'::regclass
      AND idx.indisprimary
      AND attr.attname = 'singleton'
  ),
  'refresh state singleton is the primary key'
);

SELECT is(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.cluster_rankings_refresh_state'::regclass
  ),
  true,
  'refresh state has RLS enabled'
);

SELECT ok(
  NOT has_table_privilege(
    'anon',
    'public.cluster_rankings_refresh_state',
    'SELECT'
  ),
  'anon has no direct refresh-state privileges'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.cluster_rankings_refresh_state',
    'SELECT'
  ),
  'authenticated has no direct refresh-state privileges'
);

SELECT ok(
  NOT has_table_privilege(
    'service_role',
    'public.cluster_rankings_refresh_state',
    'SELECT'
  ),
  'service role cannot bypass the RPC through direct table access'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.refresh_cluster_rankings()',
    'EXECUTE'
  ),
  'service role retains the existing refresh RPC access'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.refresh_cluster_rankings()',
    'EXECUTE'
  ),
  'anon cannot invoke the refresh RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.refresh_cluster_rankings()',
    'EXECUTE'
  ),
  'authenticated cannot invoke the refresh RPC'
);

SELECT is(
  (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = 'public.refresh_cluster_rankings()'::regprocedure
  ),
  true,
  'refresh RPC remains SECURITY DEFINER'
);

SELECT is(
  (
    SELECT proconfig
    FROM pg_proc
    WHERE oid = 'public.refresh_cluster_rankings()'::regprocedure
  ),
  ARRAY['search_path=pg_catalog, public']::text[],
  'refresh RPC has a pinned safe search path'
);

INSERT INTO public.cluster_rankings_refresh_state (
  singleton,
  last_refreshed_at
) VALUES (
  true,
  clock_timestamp()
)
ON CONFLICT (singleton) DO UPDATE
SET last_refreshed_at = EXCLUDED.last_refreshed_at;

CREATE TEMP TABLE captured_recent_refresh_state AS
SELECT last_refreshed_at
FROM public.cluster_rankings_refresh_state
WHERE singleton;

SELECT public.refresh_cluster_rankings();

SELECT is(
  (
    SELECT last_refreshed_at
    FROM public.cluster_rankings_refresh_state
    WHERE singleton
  ),
  (
    SELECT last_refreshed_at
    FROM captured_recent_refresh_state
  ),
  'a recent successful refresh watermark makes the RPC a no-op'
);

UPDATE public.cluster_rankings_refresh_state
SET last_refreshed_at = clock_timestamp() - interval '30 minutes'
WHERE singleton;

SELECT public.refresh_cluster_rankings();

SELECT ok(
  (
    SELECT last_refreshed_at > clock_timestamp() - interval '1 minute'
    FROM public.cluster_rankings_refresh_state
    WHERE singleton
  ),
  'a stale watermark performs the refresh and records a new success time'
);

SELECT * FROM finish();
ROLLBACK;

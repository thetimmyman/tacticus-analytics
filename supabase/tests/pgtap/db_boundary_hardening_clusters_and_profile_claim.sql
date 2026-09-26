-- public.clusters is not anon-readable (invite codes, creator UUIDs), and
-- finalize_onboarding_profile() trusts no client-authored onboarding columns.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(18);

SELECT ok(
  NOT has_table_privilege('anon', 'public.clusters', 'SELECT'),
  'anon cannot SELECT public.clusters'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.clusters'::regclass
     AND polname IN ('Public read access for active clusters',
                     'public_view_active_clusters')),
  0,
  'both redundant permissive SELECT policies are gone'
);

-- A revoke does not cover a TO PUBLIC policy (polroles OID 0); none may exist.
SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.clusters'::regclass
     AND polcmd = 'r' AND 0 = ANY(polroles)),
  0,
  'no SELECT policy on clusters is granted TO PUBLIC'
);

SELECT ok(
  NOT has_column_privilege('anon', 'public.clusters', 'invite_code', 'SELECT'),
  'anon cannot read clusters.invite_code'
);

SELECT ok(
  NOT has_column_privilege('anon', 'public.clusters', 'created_by', 'SELECT'),
  'anon cannot read clusters.created_by'
);

-- No-lockout witnesses, gated on a baseline existing (replay never grants app roles).
SELECT ok(
  CASE WHEN NOT has_table_privilege('service_role', 'public.clusters', 'SELECT')
       THEN true  -- environment never granted the app roles; nothing to regress
       ELSE has_table_privilege('authenticated', 'public.clusters', 'SELECT')
  END,
  'authenticated retains SELECT on clusters (closing anon is not a lockout)'
);

-- analytics_ro does not bypass RLS, so it needs the grant AND a policy naming it.
SELECT ok(
  CASE WHEN to_regrole('analytics_ro') IS NULL
       THEN true  -- role absent in this environment
       ELSE has_table_privilege('analytics_ro', 'public.clusters', 'SELECT')
  END,
  'analytics_ro retains the SELECT grant on clusters'
);

SELECT ok(
  CASE WHEN to_regrole('analytics_ro') IS NULL
       THEN true
       ELSE EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy
         WHERE polrelid = 'public.clusters'::regclass
           AND polcmd = 'r'
           AND to_regrole('analytics_ro')::oid = ANY(polroles))
  END,
  'a SELECT policy on clusters names analytics_ro (RLS does not mask the ops role)'
);

-- If this owner-rights view became security_invoker, the anon revoke would break the homepage.
SELECT ok(
  CASE WHEN NOT has_table_privilege('service_role', 'public.clusters', 'SELECT')
       THEN true
       ELSE has_table_privilege('anon', 'public.cluster_config', 'SELECT')
  END,
  'anon keeps the six-column cluster_config view'
);

SELECT ok(
  NOT coalesce(
    (SELECT array_to_string(reloptions, ',') FROM pg_catalog.pg_class
     WHERE oid = 'public.cluster_config'::regclass), ''
  ) ILIKE '%security_invoker=%on%',
  'cluster_config is still an owner-rights view, so it survives the anon revoke'
);

SELECT ok(
  CASE WHEN NOT has_table_privilege('service_role', 'public.clusters', 'SELECT')
       THEN true
       ELSE has_table_privilege('service_role', 'public.clusters', 'UPDATE')
        AND has_table_privilege('service_role', 'public.clusters', 'INSERT')
        AND has_table_privilege('service_role', 'public.clusters', 'DELETE')
  END,
  'service_role retains full write access to clusters'
);

-- get_cluster_config_for_edge returns credentials, so no client role may EXECUTE
-- it; production-only, hence to_regprocedure.
SELECT ok(
  CASE WHEN to_regprocedure('public.get_cluster_config_for_edge(text)') IS NULL
       THEN true
       ELSE NOT has_function_privilege(
              'anon', 'public.get_cluster_config_for_edge(text)', 'EXECUTE')
  END,
  'anon cannot call get_cluster_config_for_edge'
);

SELECT ok(
  CASE WHEN to_regprocedure('public.get_cluster_config_for_edge(text)') IS NULL
       THEN true
       ELSE NOT has_function_privilege(
              'authenticated', 'public.get_cluster_config_for_edge(text)', 'EXECUTE')
  END,
  'authenticated cannot call get_cluster_config_for_edge'
);

SELECT ok(
  CASE WHEN to_regprocedure('public.get_cluster_config_for_edge(text)') IS NULL
       THEN true
       ELSE has_function_privilege(
              'service_role', 'public.get_cluster_config_for_edge(text)', 'EXECUTE')
  END,
  'service_role keeps get_cluster_config_for_edge'
);

-- Source assertions: a behavioural test would pass a body trusting new.guild_code
-- for a caller who holds the matching seat.
SELECT ok(
  (SELECT prosrc FROM pg_catalog.pg_proc
   WHERE oid = 'public.finalize_onboarding_profile()'::regprocedure)
  NOT LIKE '%new.guild_code%',
  'finalize_onboarding_profile no longer reads the client-written new.guild_code'
);

SELECT ok(
  (SELECT prosrc FROM pg_catalog.pg_proc
   WHERE oid = 'public.finalize_onboarding_profile()'::regprocedure)
  NOT LIKE '%role_intent%',
  'finalize_onboarding_profile no longer reads the client-written new.role_intent'
);

SELECT ok(
  (SELECT prosrc FROM pg_catalog.pg_proc
   WHERE oid = 'public.finalize_onboarding_profile()'::regprocedure)
  LIKE '%player_mapping%',
  'finalize_onboarding_profile derives the guild from the player_mapping seat'
);

-- If the trigger were lost, every assertion above would pass vacuously.
SELECT is(
  (SELECT tgenabled::text FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.onboarding_progress'::regclass
     AND tgname = 'on_profile_claim_complete'),
  'O',
  'on_profile_claim_complete still exists and is still enabled'
);

SELECT * FROM finish();
ROLLBACK;

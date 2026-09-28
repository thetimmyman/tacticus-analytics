-- The migration does not refresh snapshots, so this pins the definition and COALESCE contract.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Skip only when the migration is absent; if its ledger row exists, fail.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260824180000'
    AND name = 'wi7920_public_snapshot_meta_team'
) AS tw7920_not_applied \gset

\if :tw7920_not_applied
SELECT plan(18);
SELECT * FROM skip(
  18,
  'this database predates the public snapshot meta-team migration; the replay lane applies it and executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(18);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260824180000'
      AND name = 'wi7920_public_snapshot_meta_team'
  ),
  1,
  'the public snapshot meta-team migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'refresh_public_guild_snapshots'
      AND function.pronargs = 0
  ),
  1,
  'the refresh function retains exactly one zero-argument signature'
);

SELECT is(
  (
    SELECT pg_catalog.pg_get_userbyid(function.proowner)
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
  ),
  'postgres',
  'the refresh function stays owned by postgres'
);

SELECT ok(
  (
    SELECT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
  ),
  'the refresh function stays SECURITY DEFINER'
);

SELECT is(
  (
    SELECT function.provolatile
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
  ),
  'v'::"char",
  'the refresh function stays VOLATILE'
);

SELECT is(
  (
    SELECT function.proparallel
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
  ),
  'u'::"char",
  'the refresh function stays parallel-unsafe'
);

SELECT is(
  (
    SELECT function.proconfig
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
  ),
  ARRAY['search_path=public']::text[],
  'the refresh function keeps its exact search_path pin'
);

SELECT ok(
  (
    SELECT language.lanname = 'plpgsql'
      AND function.prorettype = 'void'::regtype
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_language AS language
      ON language.oid = function.prolang
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
  ),
  'the refresh function stays LANGUAGE plpgsql and returns void'
);

SELECT is(
  (
    SELECT
      (char_length(definition) - char_length(replace(
        definition,
        '''metaTeam'', ''Other''',
        ''
      ))) / char_length('''metaTeam'', ''Other''')
    FROM (
      SELECT pg_get_functiondef(
        'public.refresh_public_guild_snapshots()'::regprocedure
      ) AS definition
    ) AS source
  ),
  0,
  'the stale literal classifier is absent'
);

SELECT is(
  (
    SELECT
      (char_length(definition) - char_length(replace(
        definition,
        '''metaTeam'', COALESCE(public.get_meta_team(d."heroDetails"), ''Other'')',
        ''
      ))) / char_length(
        '''metaTeam'', COALESCE(public.get_meta_team(d."heroDetails"), ''Other'')'
      )
    FROM (
      SELECT pg_get_functiondef(
        'public.refresh_public_guild_snapshots()'::regprocedure
      ) AS definition
    ) AS source
  ),
  1,
  'the refresh body contains exactly one canonical classifier expression'
);

-- 20260824210000 narrows the ACL to service role; this migration keeps it.
SELECT is(
  (
    SELECT ARRAY(
      SELECT COALESCE(grantee.rolname, 'PUBLIC'::name)::text
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE function.oid =
        'public.refresh_public_guild_snapshots()'::regprocedure
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> function.proowner
      ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
    )
  ),
  CASE WHEN EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations
      WHERE version = '20260824210000'
        AND name = 'harden_progression_and_meta_config'
    ) OR (
      SELECT count(*) = 2
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'public_guild_snapshots'
        AND column_name IN ('showcase_enabled', 'recruitment_status')
    ) THEN ARRAY['service_role']::text[]
    ELSE ARRAY['anon', 'authenticated', 'service_role']::text[]
  END,
  'the refresh function exposes EXECUTE only to the expected migration-stage roles'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) AS acl
    WHERE function.oid =
      'public.refresh_public_guild_snapshots()'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  0,
  'PUBLIC has no execute path to the refresh function'
);

INSERT INTO public.hero_mappings (unit_id, display_name)
VALUES
  ('TW7920-H1', 'Test Hero One'),
  ('TW7920-H2', 'Test Hero Two');

INSERT INTO public.meta_teams (
  team_name,
  is_meta,
  sort_order,
  trigger_heroes,
  match_type
)
VALUES (
  'Test Exact Pair',
  true,
  -7920,
  '["Test Hero One", "Test Hero Two"]'::jsonb,
  'all'
);

SELECT is(
  COALESCE(
    public.get_meta_team(
      '[{"unitId":"TW7920-H1"},{"unitId":"TW7920-H2"}]'
    ),
    'Other'
  ),
  'Test Exact Pair',
  'known compositions publish their canonical meta-team label'
);

SELECT is(
  COALESCE(
    public.get_meta_team('[{"unitId":"TW7920-NOT-MAPPED"}]'),
    'Other'
  ),
  'Other',
  'unknown compositions publish Other'
);

SELECT is(
  COALESCE(public.get_meta_team('[]'), 'Other'),
  'Other',
  'an empty hero array publishes Other'
);

SELECT is(
  COALESCE(public.get_meta_team(''), 'Other'),
  'Other',
  'an empty hero string publishes Other'
);

SELECT is(
  COALESCE(public.get_meta_team(NULL::text), 'Other'),
  'Other',
  'NULL hero details publish Other'
);

SELECT is(
  COALESCE(public.get_meta_team('{malformed'), 'Other'),
  'Other',
  'malformed hero JSON publishes Other through the classifier fallback'
);

SELECT * FROM finish();
ROLLBACK;
\endif

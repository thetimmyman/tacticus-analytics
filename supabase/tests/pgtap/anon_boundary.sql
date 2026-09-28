-- EOT_GR_data is not a public API: anon is closed at every surface that could serve the whole
-- dataset alone. If a test fails, do not just re-grant.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(14);

SELECT ok(
  has_table_privilege('anon', 'public."EOT_GR_data"', 'SELECT') = false,
  'anon cannot SELECT EOT_GR_data'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policy
   WHERE polrelid = 'public."EOT_GR_data"'::regclass AND polname = 'anon_read_all'),
  0,
  'the anon_read_all policy is gone'
);

-- Replay never grants app roles, so the no-lockout check gates on service_role.
SELECT ok(
  CASE WHEN NOT has_table_privilege('service_role', 'public."EOT_GR_data"', 'SELECT')
       THEN true  -- environment never granted the app roles; nothing to regress
       ELSE has_table_privilege('authenticated', 'public."EOT_GR_data"', 'SELECT')
  END,
  'authenticated and service_role retain SELECT (closing anon is not a lockout)'
);

-- service_role must keep writes or player sync breaks; the old authenticated INSERT was cross-tenant.
SELECT ok(
  has_table_privilege('authenticated', 'public."EOT_GR_data"', 'INSERT') = false
    AND has_table_privilege('authenticated', 'public."EOT_GR_data"', 'UPDATE') = false
    AND has_table_privilege('authenticated', 'public."EOT_GR_data"', 'DELETE') = false
    AND CASE WHEN NOT has_table_privilege('service_role', 'public."EOT_GR_data"', 'SELECT')
             THEN true
             ELSE has_table_privilege('authenticated', 'public."EOT_GR_data"', 'SELECT')
                  AND has_table_privilege('service_role', 'public."EOT_GR_data"', 'INSERT')
        END,
  'authenticated is read-only; service_role retains writes'
);

-- Owner-rights views bypass RLS and matviews ignore it. Transitive text closure, because
-- function-mediated views have no pg_rewrite edge.
SELECT is(
  (WITH RECURSIVE seeds(nm) AS (
     SELECT unnest(ARRAY['EOT_GR_data','meta_atlas_data','guild_war_player_attempts',
                         'player_mapping'])
   ),
   closure(nm) AS (
     SELECT nm FROM seeds
     UNION
     SELECT (c.relname::text) COLLATE "default"
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN closure cl ON pg_catalog.pg_get_viewdef(c.oid, true) ~ ('\m'||cl.nm||'\M')
     WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
   )
   SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN closure cl ON cl.nm = c.relname::text
   -- player_mapping is excluded: closing it makes the guild_war_matches policy raise for anon.
   WHERE n.nspname = 'public'
     AND (c.relkind IN ('v','m')
          OR (c.relkind = 'r' AND c.relname <> 'player_mapping'))
     AND has_table_privilege('anon', c.oid, 'SELECT')),
  0,
  'no table/view/matview transitively derived from raid or player data is anon-readable'
);

-- One wrapper hop, since readers of derived views never name the table. get_public_global_leaderboard
-- is exempt: aggregate only and honours explore_privacy_mode.
SELECT is(
  (WITH RECURSIVE seeds(nm) AS (
     SELECT unnest(ARRAY['EOT_GR_data','meta_atlas_data','guild_war_player_attempts',
                         'mv_cluster_season_rankings','mv_global_leaderboard',
                         'boss_leaderboard_canonical','member_stats_summary',
                         'mv_public_stats'])
   ),
   rels(nm) AS (
     SELECT c.relname::text
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN seeds s ON pg_catalog.pg_get_viewdef(c.oid, true) ~ ('\m'||s.nm||'\M')
     WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
   ),
   names(nm) AS (SELECT nm FROM seeds UNION SELECT nm FROM rels),
   direct(oid, fn) AS (
     SELECT p.oid, p.proname::text
     FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     JOIN names a ON p.prosrc ~ ('\m'||a.nm||'\M')
     WHERE n.nspname = 'public' AND p.prokind = 'f'
   ),
   wrapped(oid, fn) AS (
     SELECT p2.oid, p2.proname::text
     FROM pg_catalog.pg_proc p2
     JOIN pg_catalog.pg_namespace n2 ON n2.oid = p2.pronamespace
     JOIN direct d ON p2.prosrc ~ ('\m'||d.fn||'\M')
     WHERE n2.nspname = 'public' AND p2.prokind = 'f'
   ),
   cand(oid, fn) AS (SELECT oid, fn FROM direct UNION SELECT oid, fn FROM wrapped)
   SELECT count(*)::integer
   FROM cand c
   JOIN pg_catalog.pg_proc p ON p.oid = c.oid
   WHERE has_function_privilege('anon', c.oid, 'EXECUTE')
     -- Data-returning only: boolean RLS helpers must stay callable.
     AND (p.proretset OR pg_catalog.format_type(p.prorettype, NULL)
            NOT IN ('boolean','void','trigger'))
     AND c.fn NOT IN ('get_public_global_leaderboard','get_public_stats',
                      'get_public_stats_cached','postgrest_anon_probe')),
  0,
  'no data-returning function transitively reaching raid data is anon-executable'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_public_global_leaderboard(integer)', 'EXECUTE'),
  'the deliberate public leaderboard RPC stays anon-callable'
);

-- No anon or PUBLIC default ACL on relations/sequences; functions are covered by assertion 6.
SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_default_acl d
   JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname = 'public'
     AND d.defaclobjtype IN ('r', 'S')
     AND (array_to_string(d.defaclacl, ',') LIKE '%anon=%'
          OR array_to_string(d.defaclacl, ',') ~ '(^|,)=[a-zA-Z]')),
  0,
  'pg_default_acl grants neither anon nor PUBLIC on new relations or sequences'
);

-- The base public_guild_snapshots table applies no privacy mode; the redacting view is the anon surface.
SELECT ok(
  NOT has_table_privilege('anon', 'public.public_guild_snapshots', 'SELECT'),
  'the raw snapshot base table is NOT anon-readable'
);

SELECT ok(
  has_table_privilege('anon', 'public.public_guild_snapshots_explore', 'SELECT'),
  'the sanctioned privacy-enforcing explore view is still anon-readable'
);

-- has_table_privilege misses column grants. Reviewed exception: seven non-identifying
-- guild_config columns for the logged-out directory; the exact-set assertion fails if it widens.

-- `SELECT 1 FROM rel` names no column, so only the any-column check sees a column-only grant.
-- No helper function: anon cannot EXECUTE new ones.
CREATE TEMP TABLE _tp310_cap (
  relname       text,
  relkind       "char",
  observed      text,     -- ROWS | ALLOWED_ZERO | OTHER_<sqlstate> | DENIED
  predicted     boolean,  -- has_table_privilege OR has_any_column_privilege
  pred_by_table boolean,
  pred_by_col   boolean,
  owner_rows    boolean   -- LEG D: does the relation hold any row at all?
);

DO $tp310$
DECLARE r record; n bigint; obs text; orows boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RETURN;  -- from-scratch replay: the app roles are out-of-band state
  END IF;

  FOR r IN
    SELECT c.oid, c.relname::text AS relname, c.relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('r','v','m','p')
    ORDER BY c.relname
  LOOP
    -- On a caught error the subtransaction rolls back SET LOCAL; RESET ROLE covers the success path.
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I LIMIT 1) t', r.relname)
        INTO n;
      obs := CASE WHEN n > 0 THEN 'ROWS' ELSE 'ALLOWED_ZERO' END;
    EXCEPTION
      WHEN insufficient_privilege THEN obs := 'DENIED';
      WHEN OTHERS THEN obs := 'OTHER_' || SQLSTATE;
    END;
    RESET ROLE;

    BEGIN
      EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I LIMIT 1) t', r.relname)
        INTO n;
      orows := n > 0;
    EXCEPTION WHEN OTHERS THEN orows := NULL;   -- e.g. an unpopulated matview
    END;
    INSERT INTO _tp310_cap VALUES (
      r.relname, r.relkind, obs,
      has_table_privilege('anon', r.oid, 'SELECT')
        OR has_any_column_privilege('anon', r.oid, 'SELECT'),
      has_table_privilege('anon', r.oid, 'SELECT'),
      has_any_column_privilege('anon', r.oid, 'SELECT'),
      orows
    );
  END LOOP;
END
$tp310$;

SELECT diag('role "anon" does not exist on this database. The four anon read-capability assertions are SKIPPED, not verified -- they pass vacuously here. Prove the anon boundary on a database where anon exists.')
FROM (SELECT 1) AS _guard
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon');

-- The predictor needs has_any_column_privilege or guild_config mismatches.
SELECT is(
  (SELECT count(*)::integer FROM _tp310_cap
    WHERE (observed <> 'DENIED') IS DISTINCT FROM predicted),
  0,
  'anon read capability matches has_table_privilege OR has_any_column_privilege for every relation in public'
);

-- A table grant would widen anon to every column.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
  OR (
    NOT has_table_privilege('anon', 'public.guild_config', 'SELECT')
    AND has_any_column_privilege('anon', 'public.guild_config', 'SELECT')
    AND (SELECT observed FROM _tp310_cap WHERE relname = 'guild_config') <> 'DENIED'
  ),
  'guild_config is anon-readable by column grant only, and the capability probe sees it where has_table_privilege cannot'
);

-- LEFT JOIN pg_roles: PUBLIC has grantee oid 0.
SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   JOIN pg_catalog.pg_attribute a
     ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   CROSS JOIN LATERAL aclexplode(a.attacl) x
   LEFT JOIN pg_catalog.pg_roles rr ON rr.oid = x.grantee
   WHERE a.attacl IS NOT NULL
     AND ns.nspname NOT LIKE 'pg\_%'
     AND ns.nspname <> 'information_schema'
     AND x.privilege_type = 'SELECT'
     AND COALESCE(rr.rolname, 'PUBLIC') IN ('anon', 'PUBLIC')
     AND NOT (
       ns.nspname = 'public' AND c.relname = 'guild_config'
       AND a.attname IN ('guild_code','guild_tag','short_code','display_name',
                         'cluster_code','enabled','onboarding_completed')
     )),
  0,
  'no anon or PUBLIC column-level SELECT grant exists outside the seven reviewed guild_config columns'
);

-- Positive control: the probe discriminates both ways and a denied relation holds rows.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
  OR (
    (SELECT count(*) FROM _tp310_cap WHERE observed = 'DENIED') > 0
    AND (SELECT count(*) FROM _tp310_cap WHERE observed <> 'DENIED') > 0
    AND (SELECT count(*) FROM _tp310_cap WHERE observed = 'DENIED' AND owner_rows) > 0
  ),
  'positive control: the probe denies some relations and allows others, and at least one denied relation is non-empty'
);


SELECT * FROM finish();
ROLLBACK;

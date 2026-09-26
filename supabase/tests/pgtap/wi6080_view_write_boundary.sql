-- No auto-updatable view is writable by anon or authenticated: an owner-rights view writes its base
-- table without RLS. On failure do not re-grant: use the base table, security_invoker or a DEFINER.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(5);

-- Generic: a per-object list would miss the next blanket GRANT ALL.
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND pg_relation_is_updatable(c.oid, true) <> 0
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
      )),
  0,
  'no auto-updatable view is writable by anon or authenticated'
);

SELECT ok(
  to_regclass('public.boss_leaderboard_canonical') IS NULL,
  'boss_leaderboard_canonical no longer exists (dropped 2026-09-01 with the 2026-06-24 audit dead set; the WI-6080/WI-6790 write and read leaks it carried cannot recur)'
);

SELECT ok(
  has_table_privilege('authenticated', 'public."EOT_GR_data"', 'UPDATE') = false,
  'authenticated cannot UPDATE EOT_GR_data directly'
);


-- Service-only keeps the owner-rights projection from becoming a cross-guild read path.
SELECT ok(
  has_table_privilege('authenticated', 'public."EOT_GR_data"', 'DELETE') = false,
  'authenticated cannot DELETE from EOT_GR_data directly'
);

-- A fresh replay can grant anon writes production denies. MAINTAIN is included because it
-- authorizes VACUUM FULL / CLUSTER / REINDEX / REFRESH MATERIALIZED VIEW.
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r','v','p','m','f')
      AND (
        has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
        OR has_table_privilege('anon', c.oid, 'TRUNCATE')
        OR has_table_privilege('anon', c.oid, 'REFERENCES')
        OR has_table_privilege('anon', c.oid, 'TRIGGER')
        OR has_table_privilege('anon', c.oid, 'MAINTAIN')
      )),
  0,
  'no relation in public grants anon any write privilege'
);

SELECT * FROM finish();
ROLLBACK;

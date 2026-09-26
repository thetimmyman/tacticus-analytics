BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- internal.cron_secrets has no client privileges, the readers use it instead of
-- the GUC, and wrapper ACLs are unchanged. Skips only when the migration is absent.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260902010000'
    AND name = 'cron_secret_delivery_table_general'
) AS b3_not_applied \gset

\if :b3_not_applied
SELECT plan(25);
SELECT * FROM skip(
  25,
  'this database predates the B3 secret-delivery migration; apply 20260902010000 and re-run — production teeth are the post-apply verification queries in the migration header'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(25);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_namespace
           WHERE nspname = 'internal'
             AND pg_get_userbyid(nspowner) = 'postgres'),
  'A1: schema internal exists and is owned by postgres'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'internal' AND c.relname = 'cron_secrets'
             AND c.relkind = 'r'
             AND pg_get_userbyid(c.relowner) = 'postgres'),
  'A2: internal.cron_secrets exists and is owned by postgres'
);
SELECT ok(
  (SELECT relrowsecurity AND NOT relforcerowsecurity
     FROM pg_class WHERE oid = 'internal.cron_secrets'::regclass),
  'A3: row security is enabled (fail-closed, no policy) and not forced onto the owner path'
);

SELECT is(
  (SELECT count(*)::integer FROM (
     SELECT 1 WHERE has_schema_privilege('anon', 'internal', 'USAGE')
     UNION ALL
     SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv
      WHERE has_table_privilege('anon', 'internal.cron_secrets', priv)
     UNION ALL
     SELECT 1 WHERE has_function_privilege('anon', 'internal.get_secret(text)', 'EXECUTE')
   ) held),
  0,
  'B1: anon holds no privilege anywhere on the delivery surface'
);
SELECT is(
  (SELECT count(*)::integer FROM (
     SELECT 1 WHERE has_schema_privilege('authenticated', 'internal', 'USAGE')
     UNION ALL
     SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv
      WHERE has_table_privilege('authenticated', 'internal.cron_secrets', priv)
     UNION ALL
     SELECT 1 WHERE has_function_privilege('authenticated', 'internal.get_secret(text)', 'EXECUTE')
   ) held),
  0,
  'B2: authenticated holds no privilege anywhere on the delivery surface'
);
SELECT is(
  (SELECT count(*)::integer FROM (
     SELECT 1 WHERE has_schema_privilege('service_role', 'internal', 'USAGE')
     UNION ALL
     SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv
      WHERE has_table_privilege('service_role', 'internal.cron_secrets', priv)
     UNION ALL
     SELECT 1 WHERE has_function_privilege('service_role', 'internal.get_secret(text)', 'EXECUTE')
   ) held),
  0,
  'B3: service_role holds no privilege anywhere on the delivery surface — it gets values only through the definer wrappers'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) acl
    WHERE c.oid = 'internal.cron_secrets'::regclass AND acl.grantee = 0
    UNION ALL
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) acl
    WHERE p.oid = 'internal.get_secret(text)'::regprocedure AND acl.grantee = 0
  ),
  'B4: PUBLIC (grantee 0) appears nowhere in the table or accessor ACL'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  'SELECT value FROM internal.cron_secrets',
  '42501', NULL,
  'C1: anon SELECT on internal.cron_secrets is refused'
);
SELECT throws_ok(
  $probe$SELECT internal.get_secret('cron_secret')$probe$,
  '42501', NULL,
  'C2: anon cannot call internal.get_secret'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  'SELECT value FROM internal.cron_secrets',
  '42501', NULL,
  'C3: authenticated SELECT on internal.cron_secrets is refused'
);
SELECT throws_ok(
  $probe$SELECT internal.get_secret('cron_secret')$probe$,
  '42501', NULL,
  'C4: authenticated cannot call internal.get_secret'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT throws_ok(
  'SELECT value FROM internal.cron_secrets',
  '42501', NULL,
  'C5: service_role SELECT on internal.cron_secrets is refused'
);
SELECT throws_ok(
  $probe$SELECT internal.get_secret('cron_secret')$probe$,
  '42501', NULL,
  'C6: service_role cannot call internal.get_secret directly'
);
RESET ROLE;

INSERT INTO internal.cron_secrets (name, value)
VALUES ('cron_secret', 'pgtap-sentinel-cron-b3'),
       ('service_role_key', 'pgtap-sentinel-srk-b3')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

SELECT is(
  public.get_cron_secret(),
  'pgtap-sentinel-cron-b3',
  'D1: get_cron_secret() returns the internal.cron_secrets value'
);
SELECT is(
  public.get_service_role_key(),
  'pgtap-sentinel-srk-b3',
  'D2: get_service_role_key() returns the internal.cron_secrets value'
);

-- An absent row behaves like missing_ok.
DELETE FROM internal.cron_secrets WHERE name = 'cron_secret';
SELECT is(
  public.get_cron_secret(),
  NULL,
  'D3: get_cron_secret() degrades to NULL (with a WARNING) when the row is absent'
);

DELETE FROM internal.cron_secrets WHERE name = 'monitoring_webhook_url';
SELECT is(
  monitoring.notify('pgtap_b3_probe_key', 'firing', 'pgtap probe'),
  false,
  'D4: monitoring.notify() with no webhook row is a tolerant no-op (returns false, will retry)'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM monitoring.alert_state
               WHERE alert_key = 'pgtap_b3_probe_key'),
  'D5: the swallowed transition wrote NO state — the retry contract is intact'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (VALUES
            ('public','get_cron_secret'), ('public','get_service_role_key'),
            ('public','call_edge_function'), ('monitoring','notify'))
      AND (p.prosrc ~ 'app\.settings' OR p.prosrc ~ 'current_setting')),
  0,
  'E1: no rewritten reader references app.settings or current_setting'
);
SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (VALUES
            ('public','get_cron_secret'), ('public','get_service_role_key'),
            ('public','call_edge_function'), ('monitoring','notify'))
      AND p.prosrc ~ 'internal\.get_secret'),
  4,
  'E2: all four readers fetch through internal.get_secret'
);
SELECT ok(
  (SELECT prosrc ~ 'guild-war-sync' AND prosrc ~ 'supabase-kong\.tacticus\.svc\.cluster\.local'
     FROM pg_proc WHERE oid = 'public.call_edge_function(text, jsonb)'::regprocedure),
  'E3: call_edge_function keeps the LIVE body basis — WI-2530 guild-war-sync route and the in-cluster gateway FQDN fallback (the drifted 20260813 baseline had neither)'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (VALUES
            ('public','get_cron_secret'), ('public','get_service_role_key'),
            ('public','call_edge_function'), ('monitoring','notify'))
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig @> ARRAY['search_path=public']),
  4,
  'F1: all four readers are SECURITY DEFINER, postgres-owned, with a pinned search_path'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES ('anon'), ('authenticated')) r(rolname)
     CROSS JOIN (VALUES
       ('public.get_cron_secret()'),
       ('public.get_service_role_key()'),
       ('public.call_edge_function(text, jsonb)'),
       ('monitoring.notify(text, text, text, text, boolean)')) f(sig)
    WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE')),
  0,
  'G1: anon/authenticated cannot execute any secret-reading wrapper'
);
SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES
       ('public.get_cron_secret()'),
       ('public.get_service_role_key()'),
       ('public.call_edge_function(text, jsonb)')) f(sig)
    WHERE has_function_privilege('service_role', f.sig, 'EXECUTE')),
  3,
  'G2: service_role keeps EXECUTE on the three public wrappers'
);
SELECT ok(
  NOT has_function_privilege('service_role',
        'monitoring.notify(text, text, text, text, boolean)', 'EXECUTE'),
  'G3: monitoring.notify stays owner-only, as before'
);

SELECT * FROM finish();
ROLLBACK;
\endif

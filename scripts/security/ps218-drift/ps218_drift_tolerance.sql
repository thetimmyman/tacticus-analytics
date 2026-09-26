-- Drift tolerance for 20260925080000 against a production-shaped ACL. Not rostered: needs
-- prod-drift-prestate.sql and is driven by scripts/security/ps218-drift-tolerance.test.sh.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(6);

-- 1. The migration applied: it did not refuse on the drifted tables.
SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260925080000'
      AND name = 'ps218_revoke_authenticated_write_grants'),
  1,
  'PS-218 applied on a replay where 2 swept tables grant neither authenticated nor service_role a write'
);

-- 2. service_role still has no write on the drifted tables: the migration skipped, not repaired, them.
SELECT is(
  (SELECT coalesce(string_agg(t || '.' || p, ', ' ORDER BY t, p), '')
     FROM unnest(ARRAY['guild_war_visibility_audit', 'player_invite_codes']) AS t
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
    WHERE has_table_privilege('service_role', 'public.' || t, p)),
  '',
  'drift fixture present: service_role holds no INSERT/UPDATE/DELETE on the drifted swept tables'
);

-- 3. The end state the migration promises holds on the drifted tables too.
SELECT is(
  (SELECT coalesce(string_agg(t || '.' || p, ', ' ORDER BY t, p), '')
     FROM unnest(ARRAY['guild_war_visibility_audit', 'player_invite_codes']) AS t
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p)),
  '',
  'authenticated holds no INSERT/UPDATE/DELETE on the drifted (skipped) swept tables'
);

-- 4. SELECT on the drifted tables is as the pre-state left it.
SELECT is(
  (SELECT count(*)::integer
     FROM unnest(ARRAY['guild_war_visibility_audit', 'player_invite_codes']) AS t
    WHERE has_table_privilege('authenticated', 'public.' || t, 'SELECT')),
  2,
  'authenticated SELECT on the drifted swept tables is untouched'
);

-- 5. An undrifted swept table was still revoked: the skip is not a no-op.
SELECT is(
  (SELECT coalesce(string_agg(p, ', ' ORDER BY p), '')
     FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
    WHERE has_table_privilege('authenticated', 'public.maps', p)),
  '',
  'authenticated lost INSERT/UPDATE/DELETE on an undrifted swept table (maps)'
);

-- 6. ...and kept its writer there.
SELECT ok(
  has_table_privilege('service_role', 'public.maps', 'INSERT')
    AND has_table_privilege('service_role', 'public.maps', 'UPDATE')
    AND has_table_privilege('service_role', 'public.maps', 'DELETE'),
  'service_role still writes the undrifted swept table (maps)'
);

SELECT * FROM finish();
ROLLBACK;

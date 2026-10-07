-- Revoke authenticated writes on six tables whose writers all trace to
-- service-role: RLS on, no arming policy, INSERT already RLS-denied and
-- UPDATE/DELETE matching zero rows for authenticated, so nothing observable
-- changes except that a user-session write now fails loudly. The census
-- check re-derives each writer's provenance on every run.

-- target-db: general
-- Rollback re-grants exactly the revoke NOTICE's table:PRIVS entries.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- The census's tables for this migration verbatim; the census check fails if they disagree.
CREATE TEMP TABLE service_traced_swept (relname text PRIMARY KEY) ON COMMIT DROP;

INSERT INTO service_traced_swept (relname)
SELECT unnest(ARRAY[
      'discord_webhook_logs',
      'execution_locks',
      'guild_themes',
      'guild_war_battles',
      'guild_war_participation',
      'sync_health'
  ]::text[]);

CREATE TEMP TABLE service_traced_before (
  relname text PRIMARY KEY,
  auth_insert boolean NOT NULL,
  auth_update boolean NOT NULL,
  auth_delete boolean NOT NULL,
  auth_writes boolean GENERATED ALWAYS AS
    (auth_insert OR auth_update OR auth_delete) STORED,
  auth_select boolean NOT NULL,
  svc_insert boolean NOT NULL,
  svc_update boolean NOT NULL,
  svc_delete boolean NOT NULL
) ON COMMIT DROP;

-- Refuse if the database disagrees with any census claim.
DO $precondition$
DECLARE
  v_missing text[];
  v_no_rls text[];
  v_armed text[];
  v_no_service text[];
BEGIN
  SELECT coalesce(array_agg(s.relname ORDER BY s.relname), ARRAY[]::text[])
    INTO v_missing
    FROM service_traced_swept s
   WHERE to_regclass('public.' || quote_ident(s.relname)) IS NULL;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'service-traced revoke: table(s) do not exist: %',
      array_to_string(v_missing, ', ');
  END IF;

  INSERT INTO service_traced_before
    (relname, auth_insert, auth_update, auth_delete, auth_select,
     svc_insert, svc_update, svc_delete)
  SELECT s.relname,
         has_table_privilege('authenticated', t.oid, 'INSERT'),
         has_table_privilege('authenticated', t.oid, 'UPDATE'),
         has_table_privilege('authenticated', t.oid, 'DELETE'),
         has_table_privilege('authenticated', t.oid, 'SELECT'),
         has_table_privilege('service_role', t.oid, 'INSERT'),
         has_table_privilege('service_role', t.oid, 'UPDATE'),
         has_table_privilege('service_role', t.oid, 'DELETE')
    FROM service_traced_swept s
    CROSS JOIN LATERAL (
      SELECT to_regclass('public.' || quote_ident(s.relname))::oid AS oid
    ) t;

  -- Without RLS the grant is live, and revoking it would change behaviour.
  SELECT coalesce(array_agg(s.relname ORDER BY s.relname), ARRAY[]::text[])
    INTO v_no_rls
    FROM service_traced_swept s
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(s.relname))
   WHERE NOT c.relrowsecurity;
  IF array_length(v_no_rls, 1) > 0 THEN
    RAISE EXCEPTION
      'service-traced revoke: RLS is off, so the authenticated write grant is live; refusing: %',
      array_to_string(v_no_rls, ', ');
  END IF;

  -- A write policy reaching authenticated (directly, via PUBLIC or an
  -- inherited role) means somebody intends these writes; re-judge first.
  SELECT coalesce(array_agg(DISTINCT s.relname ORDER BY s.relname), ARRAY[]::text[])
    INTO v_armed
    FROM service_traced_swept s
    JOIN pg_policy p ON p.polrelid = to_regclass('public.' || quote_ident(s.relname))
   WHERE p.polcmd IN ('a', 'w', 'd', '*')
     AND EXISTS (
       SELECT 1
       FROM unnest(p.polroles) AS policy_role(role_oid)
       WHERE CASE
         WHEN policy_role.role_oid = 0 THEN true  -- PUBLIC
         ELSE pg_has_role('authenticated'::regrole, policy_role.role_oid, 'USAGE')
       END
     );
  IF array_length(v_armed, 1) > 0 THEN
    RAISE EXCEPTION
      'service-traced revoke: a policy grants authenticated a write command; refusing: %',
      array_to_string(v_armed, ', ');
  END IF;

  SELECT coalesce(array_agg(b.relname ORDER BY b.relname), ARRAY[]::text[])
    INTO v_no_service
    FROM service_traced_before b
   WHERE b.auth_writes
     AND NOT (b.svc_insert AND b.svc_update AND b.svc_delete);
  IF array_length(v_no_service, 1) > 0 THEN
    RAISE EXCEPTION
      'service-traced revoke: service_role cannot write %; revoking would leave no writer',
      array_to_string(v_no_service, ', ');
  END IF;
END;
$precondition$;

DO $revoke$
DECLARE
  r record;
  v_revoked text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT * FROM service_traced_before WHERE auth_writes ORDER BY relname LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', r.relname);
    v_revoked := v_revoked || (r.relname || ':' || concat_ws(',',
      CASE WHEN r.auth_insert THEN 'INSERT' END,
      CASE WHEN r.auth_update THEN 'UPDATE' END,
      CASE WHEN r.auth_delete THEN 'DELETE' END));
  END LOOP;
  RAISE NOTICE 'service-traced revoke: revoked authenticated writes on % table(s): %',
    coalesce(array_length(v_revoked, 1), 0), array_to_string(v_revoked, ', ');
END;
$revoke$;

-- authenticated keeps no write; its SELECT and service_role's writes are as found.
DO $verify$
DECLARE
  v_remaining text[];
  v_changed text[];
BEGIN
  IF (SELECT count(*) FROM service_traced_before) <> 6 THEN
    RAISE EXCEPTION 'service-traced revoke verify: expected 6 tables in the before-state';
  END IF;

  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[])
    INTO v_remaining
    FROM (
      SELECT s.relname || '.' || p AS x
        FROM service_traced_swept s
        CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
       WHERE has_table_privilege('authenticated', 'public.' || quote_ident(s.relname), p)
    ) q;
  IF array_length(v_remaining, 1) > 0 THEN
    RAISE EXCEPTION 'service-traced revoke verify: authenticated still holds %',
      array_to_string(v_remaining, ', ');
  END IF;

  SELECT coalesce(array_agg(b.relname ORDER BY b.relname), ARRAY[]::text[])
    INTO v_changed
    FROM service_traced_before b
   WHERE has_table_privilege('authenticated', 'public.' || quote_ident(b.relname), 'SELECT') IS DISTINCT FROM b.auth_select
      OR has_table_privilege('service_role', 'public.' || quote_ident(b.relname), 'INSERT') IS DISTINCT FROM b.svc_insert
      OR has_table_privilege('service_role', 'public.' || quote_ident(b.relname), 'UPDATE') IS DISTINCT FROM b.svc_update
      OR has_table_privilege('service_role', 'public.' || quote_ident(b.relname), 'DELETE') IS DISTINCT FROM b.svc_delete;
  IF array_length(v_changed, 1) > 0 THEN
    RAISE EXCEPTION
      'service-traced revoke verify: authenticated SELECT or service_role writes changed on %',
      array_to_string(v_changed, ', ');
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261007230000', 'revoke_service_traced_write_grants')
ON CONFLICT (version) DO NOTHING;

COMMIT;

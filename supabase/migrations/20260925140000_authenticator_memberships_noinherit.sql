-- INHERIT FALSE on authenticator's memberships: since PG16 each membership decides
-- inheritance, so the login role held service_role's privileges without a JWT.
-- target-db: general
-- PostgREST needs only SET ROLE. Grants are re-issued GRANTED BY the recorded
-- grantor so rows update in place. Cluster-wide; no-op without authenticator.

BEGIN;

DO $apply$
DECLARE
  v_row record;
  v_n   integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
    RAISE NOTICE 'authenticator does not exist here; nothing to do';
    RETURN;
  END IF;

  FOR v_row IN
    SELECT r.rolname AS granted_role, g.rolname AS grantor
      FROM pg_catalog.pg_auth_members am
      JOIN pg_catalog.pg_roles r ON r.oid = am.roleid
      JOIN pg_catalog.pg_roles g ON g.oid = am.grantor
     WHERE am.member = 'authenticator'::regrole
       AND am.inherit_option
     ORDER BY r.rolname, g.rolname
  LOOP
    EXECUTE format('GRANT %I TO authenticator WITH INHERIT FALSE GRANTED BY %I',
                   v_row.granted_role, v_row.grantor);
    RAISE NOTICE 'authenticator membership in % (grantor %) now INHERIT FALSE',
                 v_row.granted_role, v_row.grantor;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'authenticator: % membership(s) changed to INHERIT FALSE', v_n;
END;
$apply$;

-- Nothing inherits, every membership stays SET-able, and service_role-only access
-- is lost (service_role itself is the positive control).
DO $verify$
DECLARE
  v_bad  text;
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
    RETURN;
  END IF;

  SELECT string_agg(r.rolname, ', ') INTO v_bad
    FROM pg_catalog.pg_auth_members am
    JOIN pg_catalog.pg_roles r ON r.oid = am.roleid
   WHERE am.member = 'authenticator'::regrole
     AND am.inherit_option;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'verify: authenticator still inherits from: %', v_bad;
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
       AND NOT pg_catalog.pg_has_role('authenticator', v_role, 'SET') THEN
      RAISE EXCEPTION 'verify: authenticator can no longer SET ROLE %; PostgREST would fail', v_role;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('public.anonymize_subject_battle_rows(uuid)') IS NOT NULL THEN
    IF NOT pg_catalog.has_function_privilege('service_role',
             'public.anonymize_subject_battle_rows(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'verify: positive control failed -- service_role cannot EXECUTE public.anonymize_subject_battle_rows(uuid), so the probe below proves nothing';
    END IF;
    IF pg_catalog.has_function_privilege('authenticator',
             'public.anonymize_subject_battle_rows(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'verify: authenticator still holds EXECUTE on public.anonymize_subject_battle_rows(uuid) directly';
    END IF;
  END IF;
END;
$verify$;

COMMIT;

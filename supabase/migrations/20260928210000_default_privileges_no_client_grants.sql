-- target-db: general
-- New objects in API-exposed schemas grant client roles nothing: a table, sequence or function
-- is reachable by anon, authenticated or analytics_ro only through an explicit GRANT in the
-- migration that creates it. service_role keeps its defaults. Existing objects keep their ACLs.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

DO $revoke_defaults$
DECLARE
  v_creator text;
  v_schema text;
  v_clients text;
BEGIN
  -- analytics_ro exists only where it was provisioned by hand, so it is named only if present.
  v_clients := 'PUBLIC, anon, authenticated'
    || CASE WHEN to_regrole('analytics_ro') IS NOT NULL THEN ', analytics_ro' ELSE '' END;

  FOREACH v_creator IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    CONTINUE WHEN to_regrole(v_creator) IS NULL;
    -- A lane where the migrator cannot act for this creator cannot change its defaults.
    IF NOT pg_has_role(current_user, v_creator, 'MEMBER') THEN
      IF v_creator = 'postgres' THEN
        RAISE EXCEPTION 'current_user % cannot alter default privileges for postgres', current_user;
      END IF;
      RAISE NOTICE 'skipping default privileges for %: current_user % is not a member', v_creator, current_user;
      CONTINUE;
    END IF;

    -- Built-in function defaults grant EXECUTE to PUBLIC; per-schema rules cannot subtract that.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
      v_creator);

    FOREACH v_schema IN ARRAY ARRAY['public', 'graphql_public'] LOOP
      CONTINUE WHEN to_regnamespace(v_schema) IS NULL;
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %s',
        v_creator, v_schema, v_clients);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %s',
        v_creator, v_schema, v_clients);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %s',
        v_creator, v_schema, v_clients);
    END LOOP;
  END LOOP;
END;
$revoke_defaults$;

DO $verify$
DECLARE
  v_leaks text;
BEGIN
  SELECT string_agg(
           format('%s/%s/%s -> %s',
             pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '<all schemas>'),
             d.defaclobjtype, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END),
           ', ')
    INTO v_leaks
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE pg_get_userbyid(d.defaclrole) IN ('postgres', 'supabase_admin')
     AND (n.nspname IN ('public', 'graphql_public') OR d.defaclnamespace = 0)
     AND (a.grantee = 0
          OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'analytics_ro'));

  IF v_leaks IS NOT NULL THEN
    RAISE EXCEPTION 'default privileges still grant client roles: %', v_leaks;
  END IF;

  -- No global function rule for postgres means the built-in PUBLIC EXECUTE default still applies.
  IF NOT EXISTS (
    SELECT 1 FROM pg_default_acl
     WHERE defaclrole = 'postgres'::regrole AND defaclnamespace = 0 AND defaclobjtype = 'f'
  ) THEN
    RAISE EXCEPTION 'postgres still has the built-in PUBLIC EXECUTE default on new functions';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

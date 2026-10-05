-- Close PUBLIC reads of pg_db_role_setting; its ACL is per database.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'WI-8360 General migration requires database postgres, got %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE SELECT ON pg_catalog.pg_db_role_setting FROM PUBLIC;
REVOKE SELECT (setdatabase, setrole, setconfig)
  ON pg_catalog.pg_db_role_setting FROM PUBLIC;

DO $verify$
DECLARE
  relation_count integer;
  relation_shared boolean;
  relation_owner text;
  relation_owner_super boolean;
  public_select boolean;
BEGIN
  SELECT count(c.oid)::integer,
         bool_and(c.relisshared),
         min(owner_role.rolname),
         bool_and(owner_role.rolsuper)
    INTO relation_count, relation_shared, relation_owner, relation_owner_super
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = c.relowner
   WHERE n.nspname = 'pg_catalog'
     AND c.relname = 'pg_db_role_setting';

  IF relation_count IS DISTINCT FROM 1
     OR relation_shared IS DISTINCT FROM true
     OR (
       relation_owner IS DISTINCT FROM 'postgres'
       AND NOT (
         relation_owner IS NOT DISTINCT FROM 'supabase_admin'
         AND relation_owner_super IS TRUE
       )
     ) THEN
    RAISE EXCEPTION
      'WI-8360 unexpected pg_db_role_setting identity (count %, shared %, owner %, owner superuser %)',
      relation_count,
      relation_shared,
      relation_owner,
      relation_owner_super;
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_class AS c
             CROSS JOIN LATERAL pg_catalog.aclexplode(
               coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
             ) AS acl
            WHERE c.oid = 'pg_catalog.pg_db_role_setting'::regclass
              AND acl.grantee = 0
              AND acl.privilege_type = 'SELECT'
           UNION ALL
           SELECT 1
             FROM pg_catalog.pg_attribute AS a
             CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
            WHERE a.attrelid = 'pg_catalog.pg_db_role_setting'::regclass
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND acl.grantee = 0
              AND acl.privilege_type = 'SELECT'
         )
    INTO public_select;

  IF public_select THEN
    RAISE EXCEPTION 'WI-8360 PUBLIC SELECT remains on pg_db_role_setting';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'postgres',
    'pg_catalog.pg_db_role_setting',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'WI-8360 postgres owner lost pg_db_role_setting SELECT';
  END IF;
END;
$verify$;

COMMIT;

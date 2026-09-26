-- target-db: general
-- get_meta_team catches only malformed caller JSON, so config errors abort. No inner
-- BEGIN/COMMIT: the apply runner supplies the transaction.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $progression_acl$
DECLARE
  v_signature regprocedure :=
    pg_catalog.to_regprocedure(
      'public.set_active_progression_config(uuid,boolean)'
    );
  v_function record;
  v_definition_hash text;
  v_non_owner_grantees text[];
  v_public_execute_count integer;
  v_non_owner_grant_option_count integer;
  v_expected_hash constant text :=
    'ef328af8208048e8e6ff310025b53063d190d63afbbe9484cdb56188a92d5047';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION
      'progression hardening: set_active_progression_config(uuid,boolean) is absent';
  END IF;

  SELECT
    function.oid,
    function.proowner,
    function.prosecdef,
    function.provolatile,
    function.proparallel,
    function.proconfig,
    function.prolang,
    function.prorettype,
    function.proacl,
    pg_catalog.obj_description(function.oid, 'pg_proc') AS object_comment
  INTO STRICT v_function
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = v_signature::oid;

  v_definition_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(v_function.oid),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT ARRAY(
    SELECT COALESCE(grantee.rolname, 'PUBLIC'::name)::text
    FROM pg_catalog.aclexplode(
      COALESCE(
        v_function.proacl,
        pg_catalog.acldefault('f', v_function.proowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> v_function.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_non_owner_grantees;

  SELECT
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee = 0
    ),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> v_function.proowner
        AND acl.is_grantable
    )
  INTO v_public_execute_count, v_non_owner_grant_option_count
  FROM pg_catalog.aclexplode(
    COALESCE(
      v_function.proacl,
      pg_catalog.acldefault('f', v_function.proowner)
    )
  ) AS acl;

  IF pg_catalog.pg_get_userbyid(v_function.proowner)
       IS DISTINCT FROM 'postgres'
     OR v_function.prosecdef IS DISTINCT FROM true
     OR v_function.provolatile IS DISTINCT FROM 'v'::"char"
     OR v_function.proparallel IS DISTINCT FROM 'u'::"char"
     OR v_function.proconfig IS DISTINCT FROM
       ARRAY['search_path=public, pg_temp']::text[]
     OR v_function.prolang IS DISTINCT FROM
       (SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql')
     OR v_function.prorettype IS DISTINCT FROM 'void'::regtype::oid
     OR v_definition_hash IS DISTINCT FROM v_expected_hash
     OR (
       v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
       AND v_non_owner_grantees IS DISTINCT FROM
         ARRAY['anon', 'authenticated', 'service_role']::text[]
     )
     OR v_public_execute_count IS DISTINCT FROM 0
     OR v_non_owner_grant_option_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'progression hardening: unexpected function posture (hash=%, grantees=%, PUBLIC=%, grant_options=%)',
      v_definition_hash,
      v_non_owner_grantees,
      v_public_execute_count,
      v_non_owner_grant_option_count;
  END IF;

  EXECUTE
    'REVOKE ALL ON FUNCTION public.set_active_progression_config(uuid, boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE
    'GRANT EXECUTE ON FUNCTION public.set_active_progression_config(uuid, boolean) TO service_role';

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
    WHERE function.oid = v_signature::oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_non_owner_grantees;

  IF v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
     OR pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(
           pg_catalog.pg_get_functiondef(v_signature::oid),
           'UTF8'
         ),
         'sha256'
       ),
       'hex'
     ) IS DISTINCT FROM v_expected_hash
     OR pg_catalog.has_function_privilege(
       'anon', v_signature::oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', v_signature::oid, 'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'progression hardening: service-role-only postcondition failed (grantees=%)',
      v_non_owner_grantees;
  END IF;
END;
$progression_acl$;

DO $manual_refresh_acl$
DECLARE
  v_signature regprocedure :=
    pg_catalog.to_regprocedure('public.manual_refresh_guild_snapshots()');
  v_function record;
  v_definition_hash text;
  v_non_owner_grantees text[];
  v_public_execute_count integer;
  v_non_owner_grant_option_count integer;
  v_baseline_hash constant text :=
    '87090e500314fe773988069ffc3d0f8f61b0f282a0a7d8a62b552fc100527d48';
  v_live_hash constant text :=
    '535df5e892dd12b3736ed3cef40ac13861ca816e1fb1b5b0e84e95e73abedca2';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION
      'snapshot ACL hardening: manual_refresh_guild_snapshots() is absent';
  END IF;

  SELECT
    function.oid,
    function.proowner,
    function.prosecdef,
    function.provolatile,
    function.proparallel,
    function.proconfig,
    function.prolang,
    function.prorettype
  INTO STRICT v_function
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = v_signature::oid;

  v_definition_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(v_function.oid),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

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
    WHERE function.oid = v_signature::oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_non_owner_grantees;

  SELECT
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee = 0
    ),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> function.proowner
        AND acl.is_grantable
    )
  INTO v_public_execute_count, v_non_owner_grant_option_count
  FROM pg_catalog.pg_proc AS function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      function.proacl,
      pg_catalog.acldefault('f', function.proowner)
    )
  ) AS acl
  WHERE function.oid = v_signature::oid;

  IF pg_catalog.pg_get_userbyid(v_function.proowner)
       IS DISTINCT FROM 'postgres'
     OR v_function.prosecdef IS DISTINCT FROM false
     OR v_function.provolatile IS DISTINCT FROM 'v'::"char"
     OR v_function.proparallel IS DISTINCT FROM 'u'::"char"
     OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR v_function.prolang IS DISTINCT FROM
       (SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql')
     OR v_function.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid
     OR v_definition_hash NOT IN (v_baseline_hash, v_live_hash)
     OR (
       v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
       AND v_non_owner_grantees IS DISTINCT FROM
         ARRAY['anon', 'authenticated', 'service_role']::text[]
     )
     OR v_public_execute_count IS DISTINCT FROM 0
     OR v_non_owner_grant_option_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'snapshot ACL hardening: unexpected manual refresh posture (hash=%, grantees=%, PUBLIC=%, grant_options=%)',
      v_definition_hash,
      v_non_owner_grantees,
      v_public_execute_count,
      v_non_owner_grant_option_count;
  END IF;

  REVOKE ALL ON FUNCTION public.manual_refresh_guild_snapshots()
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.manual_refresh_guild_snapshots()
    TO service_role;

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
    WHERE function.oid = v_signature::oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_non_owner_grantees;

  IF v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
     OR pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(
           pg_catalog.pg_get_functiondef(v_signature::oid),
           'UTF8'
         ),
         'sha256'
       ),
       'hex'
     ) IS DISTINCT FROM v_definition_hash
     OR pg_catalog.has_function_privilege(
       'anon', v_signature::oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', v_signature::oid, 'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'snapshot ACL hardening: manual refresh service-role-only postcondition failed';
  END IF;
END;
$manual_refresh_acl$;

DO $public_refresh_acl$
DECLARE
  v_signature regprocedure :=
    pg_catalog.to_regprocedure('public.refresh_public_guild_snapshots()');
  v_function record;
  v_definition_hash text;
  v_non_owner_grantees text[];
  v_public_execute_count integer;
  v_non_owner_grant_option_count integer;
  v_baseline_post_hash constant text :=
    'b17e8ad481534b596ab69689416ce639b2b5cd728f1ebc4d24a15645d7890636';
  v_live_post_hash constant text :=
    '9827d3e0ff8f96d1855072e5cd21dbe3c6f6295349714acfaccacd0cdeb8fbf3';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION
      'snapshot ACL hardening: refresh_public_guild_snapshots() is absent';
  END IF;

  SELECT
    function.oid,
    function.proowner,
    function.prosecdef,
    function.provolatile,
    function.proparallel,
    function.proconfig,
    function.prolang,
    function.prorettype
  INTO STRICT v_function
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = v_signature::oid;

  v_definition_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(v_function.oid),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

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
    WHERE function.oid = v_signature::oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_non_owner_grantees;

  SELECT
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee = 0
    ),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> function.proowner
        AND acl.is_grantable
    )
  INTO v_public_execute_count, v_non_owner_grant_option_count
  FROM pg_catalog.pg_proc AS function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      function.proacl,
      pg_catalog.acldefault('f', function.proowner)
    )
  ) AS acl
  WHERE function.oid = v_signature::oid;

  IF pg_catalog.pg_get_userbyid(v_function.proowner)
       IS DISTINCT FROM 'postgres'
     OR v_function.prosecdef IS DISTINCT FROM true
     OR v_function.provolatile IS DISTINCT FROM 'v'::"char"
     OR v_function.proparallel IS DISTINCT FROM 'u'::"char"
     OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR v_function.prolang IS DISTINCT FROM
       (SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql')
     OR v_function.prorettype IS DISTINCT FROM 'void'::regtype::oid
     OR v_definition_hash NOT IN (v_baseline_post_hash, v_live_post_hash)
     OR (
       v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
       AND v_non_owner_grantees IS DISTINCT FROM
         ARRAY['anon', 'authenticated', 'service_role']::text[]
     )
     OR v_public_execute_count IS DISTINCT FROM 0
     OR v_non_owner_grant_option_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'snapshot ACL hardening: unexpected public refresh posture (hash=%, grantees=%, PUBLIC=%, grant_options=%)',
      v_definition_hash,
      v_non_owner_grantees,
      v_public_execute_count,
      v_non_owner_grant_option_count;
  END IF;

  REVOKE ALL ON FUNCTION public.refresh_public_guild_snapshots()
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.refresh_public_guild_snapshots()
    TO service_role;

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
    WHERE function.oid = v_signature::oid
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_non_owner_grantees;

  IF v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
     OR pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(
           pg_catalog.pg_get_functiondef(v_signature::oid),
           'UTF8'
         ),
         'sha256'
       ),
       'hex'
     ) IS DISTINCT FROM v_definition_hash
     OR pg_catalog.has_function_privilege(
       'anon', v_signature::oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', v_signature::oid, 'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'snapshot ACL hardening: public refresh service-role-only postcondition failed';
  END IF;
END;
$public_refresh_acl$;

DO $meta_teams_acl$
DECLARE
  v_relation regclass := pg_catalog.to_regclass('public.meta_teams');
  v_relation_row record;
  v_anon_privileges text[];
  v_authenticated_privileges text[];
  v_service_privileges text[];
  v_other_table_acl_before text[];
  v_other_table_acl_after text[];
  v_column_acl_before text[];
  v_column_acl_after text[];
  v_public_privilege_count integer;
  v_non_owner_grant_option_count integer;
  v_clients_have_select boolean;
  v_clients_have_table_write boolean;
  v_clients_have_column_write boolean;
  v_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
    'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ]::text[];
  v_read_privileges constant text[] := ARRAY['SELECT']::text[];
  v_live_other_table_acl constant text[] :=
    ARRAY['analytics_ro:SELECT:false']::text[];
  v_expected_column_acl constant text[] := ARRAY[
    'is_meta:command_center_rpc_owner:SELECT:false',
    'match_type:command_center_rpc_owner:SELECT:false',
    'sort_order:command_center_rpc_owner:SELECT:false',
    'team_name:command_center_rpc_owner:SELECT:false',
    'trigger_heroes:command_center_rpc_owner:SELECT:false'
  ]::text[];
BEGIN
  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'meta ACL hardening: public.meta_teams is absent';
  END IF;

  SELECT
    relation.relowner,
    relation.relkind,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  INTO STRICT v_relation_row
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = v_relation::oid;

  SELECT ARRAY(
    SELECT acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    WHERE relation.oid = v_relation::oid
      AND acl.grantee = 'anon'::regrole::oid
    ORDER BY acl.privilege_type
  )
  INTO v_anon_privileges;

  SELECT ARRAY(
    SELECT acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    WHERE relation.oid = v_relation::oid
      AND acl.grantee = 'authenticated'::regrole::oid
    ORDER BY acl.privilege_type
  )
  INTO v_authenticated_privileges;

  SELECT ARRAY(
    SELECT acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    WHERE relation.oid = v_relation::oid
      AND acl.grantee = 'service_role'::regrole::oid
    ORDER BY acl.privilege_type
  )
  INTO v_service_privileges;

  SELECT ARRAY(
    SELECT COALESCE(grantee.rolname, 'OID:' || acl.grantee::text)
      || ':' || acl.privilege_type
      || ':' || acl.is_grantable::text
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE relation.oid = v_relation::oid
      AND acl.grantee NOT IN (
        0,
        relation.relowner,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid,
        'service_role'::regrole::oid
      )
    ORDER BY 1
  )
  INTO v_other_table_acl_before;

  SELECT ARRAY(
    SELECT attribute.attname
      || ':' || CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE COALESCE(grantee.rolname, 'OID:' || acl.grantee::text)
      END
      || ':' || acl.privilege_type
      || ':' || acl.is_grantable::text
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE attribute.attrelid = v_relation::oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
    ORDER BY 1
  )
  INTO v_column_acl_before;

  SELECT
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE acl.grantee <> relation.relowner AND acl.is_grantable
    )
  INTO v_public_privilege_count, v_non_owner_grant_option_count
  FROM pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      relation.relacl,
      pg_catalog.acldefault('r', relation.relowner)
    )
  ) AS acl
  WHERE relation.oid = v_relation::oid
  GROUP BY relation.oid;

  IF pg_catalog.pg_get_userbyid(v_relation_row.relowner)
       IS DISTINCT FROM 'postgres'
     OR v_relation_row.relkind IS DISTINCT FROM 'r'::"char"
     OR v_relation_row.relrowsecurity IS DISTINCT FROM true
     OR v_relation_row.relforcerowsecurity IS DISTINCT FROM true
     OR NOT (
       (
         v_anon_privileges IS NOT DISTINCT FROM v_all_privileges
         AND v_authenticated_privileges IS NOT DISTINCT FROM v_all_privileges
       )
       OR (
         v_anon_privileges IS NOT DISTINCT FROM v_read_privileges
         AND v_authenticated_privileges IS NOT DISTINCT FROM v_read_privileges
       )
     )
     OR v_service_privileges IS DISTINCT FROM v_all_privileges
     OR (
       v_other_table_acl_before IS DISTINCT FROM ARRAY[]::text[]
       AND v_other_table_acl_before IS DISTINCT FROM v_live_other_table_acl
     )
     OR v_column_acl_before IS DISTINCT FROM v_expected_column_acl
     OR v_public_privilege_count IS DISTINCT FROM 0
     OR v_non_owner_grant_option_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'meta ACL hardening: unexpected direct ACL posture (anon=%, authenticated=%, service=%, other_table=%, column_acl=%, PUBLIC=%, grant_options=%)',
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_other_table_acl_before,
      v_column_acl_before,
      v_public_privilege_count,
      v_non_owner_grant_option_count;
  END IF;

  REVOKE ALL ON TABLE public.meta_teams FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.meta_teams TO anon, authenticated;
  GRANT ALL ON TABLE public.meta_teams TO service_role;

  SELECT ARRAY(
    SELECT acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    WHERE relation.oid = v_relation::oid
      AND acl.grantee = 'anon'::regrole::oid
    ORDER BY acl.privilege_type
  )
  INTO v_anon_privileges;

  SELECT ARRAY(
    SELECT acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    WHERE relation.oid = v_relation::oid
      AND acl.grantee = 'authenticated'::regrole::oid
    ORDER BY acl.privilege_type
  )
  INTO v_authenticated_privileges;

  SELECT ARRAY(
    SELECT acl.privilege_type
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    WHERE relation.oid = v_relation::oid
      AND acl.grantee = 'service_role'::regrole::oid
    ORDER BY acl.privilege_type
  )
  INTO v_service_privileges;

  SELECT ARRAY(
    SELECT COALESCE(grantee.rolname, 'OID:' || acl.grantee::text)
      || ':' || acl.privilege_type
      || ':' || acl.is_grantable::text
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE relation.oid = v_relation::oid
      AND acl.grantee NOT IN (
        0,
        relation.relowner,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid,
        'service_role'::regrole::oid
      )
    ORDER BY 1
  )
  INTO v_other_table_acl_after;

  SELECT ARRAY(
    SELECT attribute.attname
      || ':' || CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE COALESCE(grantee.rolname, 'OID:' || acl.grantee::text)
      END
      || ':' || acl.privilege_type
      || ':' || acl.is_grantable::text
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE attribute.attrelid = v_relation::oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
    ORDER BY 1
  )
  INTO v_column_acl_after;

  SELECT
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE acl.grantee <> relation.relowner AND acl.is_grantable
    )
  INTO v_public_privilege_count, v_non_owner_grant_option_count
  FROM pg_catalog.pg_class AS relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      relation.relacl,
      pg_catalog.acldefault('r', relation.relowner)
    )
  ) AS acl
  WHERE relation.oid = v_relation::oid
  GROUP BY relation.oid;

  SELECT pg_catalog.bool_and(
    pg_catalog.has_table_privilege(
      role_name,
      v_relation::oid,
      'SELECT'
    )
  )
  INTO v_clients_have_select
  FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name);

  SELECT COALESCE(pg_catalog.bool_or(
    pg_catalog.has_table_privilege(
      role_name,
      v_relation::oid,
      privilege_name
    )
  ), false)
  INTO v_clients_have_table_write
  FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
  CROSS JOIN (
    VALUES
      ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
      ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
  ) AS privileges(privilege_name);

  SELECT COALESCE(pg_catalog.bool_or(
    pg_catalog.has_column_privilege(
      role_name,
      v_relation::oid,
      attribute.attnum,
      privilege_name
    )
  ), false)
  INTO v_clients_have_column_write
  FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
  CROSS JOIN pg_catalog.pg_attribute AS attribute
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES'))
    AS privileges(privilege_name)
  WHERE attribute.attrelid = v_relation::oid
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_anon_privileges IS DISTINCT FROM v_read_privileges
     OR v_authenticated_privileges IS DISTINCT FROM v_read_privileges
     OR v_service_privileges IS DISTINCT FROM v_all_privileges
     OR v_other_table_acl_after IS DISTINCT FROM v_other_table_acl_before
     OR v_column_acl_after IS DISTINCT FROM v_expected_column_acl
     OR v_column_acl_after IS DISTINCT FROM v_column_acl_before
     OR v_public_privilege_count IS DISTINCT FROM 0
     OR v_non_owner_grant_option_count IS DISTINCT FROM 0
     OR v_clients_have_select IS DISTINCT FROM true
     OR v_clients_have_table_write IS DISTINCT FROM false
     OR v_clients_have_column_write IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION
      'meta ACL hardening: SELECT-only postcondition failed (anon=%, authenticated=%, service=%, other_before=%, other_after=%, column_before=%, column_after=%, PUBLIC=%, grant_options=%, effective_select=%, effective_table_write=%, effective_column_write=%)',
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_other_table_acl_before,
      v_other_table_acl_after,
      v_column_acl_before,
      v_column_acl_after,
      v_public_privilege_count,
      v_non_owner_grant_option_count,
      v_clients_have_select,
      v_clients_have_table_write,
      v_clients_have_column_write;
  END IF;
END;
$meta_teams_acl$;

DO $meta_classifier$
DECLARE
  v_signature regprocedure :=
    pg_catalog.to_regprocedure('public.get_meta_team(text)');
  v_before record;
  v_after record;
  v_definition text;
  v_definition_hash text;
  v_before_hash constant text :=
    '432a1b53c182be62669de066b01c229cf585323ebc9203400af51648cb0fa2e0';
  v_rewritten_definition constant text := $classifier_definition$CREATE OR REPLACE FUNCTION public.get_meta_team(hero_details text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  team_hero_names text[];
  meta_record RECORD;
  trigger_hero text;
  match_count int;
  required_count int;
  parsed_hero_details jsonb;
BEGIN
  -- Return NULL for invalid/empty hero details supplied by callers.
  IF hero_details IS NULL OR hero_details = '' OR hero_details = '[]' THEN
    RETURN NULL;
  END IF;

  BEGIN
    parsed_hero_details := hero_details::jsonb;
  EXCEPTION
    -- PostgreSQL can report invalid caller JSON as multiple data exceptions
    -- (for example 22P02, 22P05, or 22003). Keep the catch-all confined to
    -- this one cast; every catalog/config operation below remains fail-loud.
    WHEN OTHERS THEN
      RETURN NULL;
  END;

  IF jsonb_typeof(parsed_hero_details) IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;

  -- Get display names for all heroes in the team.
  SELECT array_agg(COALESCE(hm.display_name, heroes.unit_id))
  INTO team_hero_names
  FROM (
    SELECT jsonb_array_elements(parsed_hero_details) ->> 'unitId' as unit_id
  ) heroes
  LEFT JOIN hero_mappings hm ON hm.unit_id = heroes.unit_id
  WHERE heroes.unit_id IS NOT NULL;

  IF team_hero_names IS NULL THEN
    RETURN NULL;
  END IF;

  -- Active config is constrained to a non-empty JSON array. Do not catch
  -- failures here: config/catalog defects must abort the snapshot refresh.
  FOR meta_record IN
    SELECT team_name, trigger_heroes, match_type
    FROM meta_teams
    WHERE is_meta = true
      AND trigger_heroes IS NOT NULL
      AND jsonb_array_length(trigger_heroes) > 0
    ORDER BY sort_order ASC
  LOOP
    required_count := jsonb_array_length(meta_record.trigger_heroes);
    match_count := 0;

    -- Count how many trigger heroes are in the team.
    FOR trigger_hero IN
      SELECT jsonb_array_elements_text(meta_record.trigger_heroes)
    LOOP
      IF trigger_hero = ANY(team_hero_names) THEN
        match_count := match_count + 1;
      END IF;
    END LOOP;

    -- Check match based on match_type.
    IF meta_record.match_type = 'any' AND match_count > 0 THEN
      RETURN meta_record.team_name;
    ELSIF meta_record.match_type = 'all' AND match_count = required_count THEN
      RETURN meta_record.team_name;
    ELSIF meta_record.match_type = 'exact' AND match_count = required_count AND array_length(team_hero_names, 1) = required_count THEN
      RETURN meta_record.team_name;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$
$classifier_definition$;
  v_after_hash constant text :=
    '8d637fcdcf07a4c38fca2ccf66d92dcb8df38a1597fa33789fba9c1dae213d08';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'meta config hardening: get_meta_team(text) is absent';
  END IF;

  SELECT
    function.oid,
    function.proowner,
    function.proacl,
    function.prosecdef,
    function.provolatile,
    function.proparallel,
    function.proconfig,
    function.prolang,
    function.prorettype,
    pg_catalog.obj_description(function.oid, 'pg_proc') AS object_comment
  INTO STRICT v_before
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = v_signature::oid;

  v_definition := pg_catalog.pg_get_functiondef(v_before.oid);
  v_definition_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_definition, 'UTF8'), 'sha256'),
    'hex'
  );

  IF pg_catalog.pg_get_userbyid(v_before.proowner) IS DISTINCT FROM 'postgres'
     OR v_before.prosecdef IS DISTINCT FROM false
     OR v_before.provolatile IS DISTINCT FROM 's'::"char"
     OR v_before.proparallel IS DISTINCT FROM 'u'::"char"
     OR v_before.proconfig IS NOT NULL
     OR v_before.prolang IS DISTINCT FROM
       (SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql')
     OR v_before.prorettype IS DISTINCT FROM 'text'::regtype::oid
     OR pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(v_rewritten_definition, 'UTF8'),
         'sha256'
       ),
       'hex'
     ) IS DISTINCT FROM v_after_hash
  THEN
    RAISE EXCEPTION 'meta config hardening: unexpected classifier posture';
  END IF;

  IF v_definition_hash = v_before_hash THEN
    EXECUTE v_rewritten_definition;
  ELSIF v_definition_hash = v_after_hash THEN
    NULL;
  ELSE
    RAISE EXCEPTION
      'meta config hardening: classifier does not match a captured before/after definition (hash=%)',
      v_definition_hash;
  END IF;

  SELECT
    function.oid,
    function.proowner,
    function.proacl,
    function.prosecdef,
    function.provolatile,
    function.proparallel,
    function.proconfig,
    function.prolang,
    function.prorettype,
    pg_catalog.obj_description(function.oid, 'pg_proc') AS object_comment
  INTO STRICT v_after
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid = v_signature::oid;

  IF v_after.oid IS DISTINCT FROM v_before.oid
     OR v_after.proowner IS DISTINCT FROM v_before.proowner
     OR v_after.proacl IS DISTINCT FROM v_before.proacl
     OR v_after.prosecdef IS DISTINCT FROM v_before.prosecdef
     OR v_after.provolatile IS DISTINCT FROM v_before.provolatile
     OR v_after.proparallel IS DISTINCT FROM v_before.proparallel
     OR v_after.proconfig IS DISTINCT FROM v_before.proconfig
     OR v_after.prolang IS DISTINCT FROM v_before.prolang
     OR v_after.prorettype IS DISTINCT FROM v_before.prorettype
     OR v_after.object_comment IS DISTINCT FROM v_before.object_comment
     OR pg_catalog.pg_get_functiondef(v_after.oid)
       IS DISTINCT FROM v_rewritten_definition
     OR pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(
           pg_catalog.pg_get_functiondef(v_after.oid),
           'UTF8'
         ),
         'sha256'
       ),
       'hex'
     ) IS DISTINCT FROM v_after_hash
  THEN
    RAISE EXCEPTION
      'meta config hardening: classifier replacement postcondition failed';
  END IF;
END;
$meta_classifier$;

DO $meta_constraint$
DECLARE
  v_definition text;
  v_validated boolean;
  v_expected_definition constant text := $constraint_definition$CHECK (
CASE
    WHEN is_meta IS TRUE THEN
    CASE
        WHEN jsonb_typeof(trigger_heroes) = 'array'::text THEN jsonb_array_length(trigger_heroes) > 0
        ELSE false
    END
    ELSE true
END)$constraint_definition$;
BEGIN
  IF pg_catalog.to_regclass('public.meta_teams') IS NULL THEN
    RAISE EXCEPTION 'meta config hardening: public.meta_teams is absent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_teams
    WHERE CASE
      WHEN is_meta IS TRUE THEN
        CASE
          WHEN pg_catalog.jsonb_typeof(trigger_heroes) = 'array'
            THEN pg_catalog.jsonb_array_length(trigger_heroes) > 0
          ELSE false
        END
      ELSE true
    END IS NOT TRUE
  ) THEN
    RAISE EXCEPTION
      'meta config hardening: active meta_teams.trigger_heroes values must be non-null, non-empty JSON arrays';
  END IF;

  SELECT
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
    constraint_row.convalidated
  INTO v_definition, v_validated
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.meta_teams'::regclass
    AND constraint_row.conname = 'meta_teams_trigger_heroes_array_check';

  IF NOT FOUND THEN
    ALTER TABLE public.meta_teams
      ADD CONSTRAINT meta_teams_trigger_heroes_array_check
      CHECK (
        CASE
          WHEN is_meta IS TRUE THEN
            CASE
              WHEN pg_catalog.jsonb_typeof(trigger_heroes) = 'array'
                THEN pg_catalog.jsonb_array_length(trigger_heroes) > 0
              ELSE false
            END
          ELSE true
        END
      ) NOT VALID;
  ELSIF v_definition IS DISTINCT FROM v_expected_definition
  THEN
    RAISE EXCEPTION
      'meta config hardening: existing trigger_heroes constraint has an unexpected definition: %',
      v_definition;
  END IF;

  ALTER TABLE public.meta_teams
    VALIDATE CONSTRAINT meta_teams_trigger_heroes_array_check;

  SELECT
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
    constraint_row.convalidated
  INTO STRICT v_definition, v_validated
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.meta_teams'::regclass
    AND constraint_row.conname = 'meta_teams_trigger_heroes_array_check';

  IF v_definition IS DISTINCT FROM v_expected_definition
     OR v_validated IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION
      'meta config hardening: validated trigger_heroes constraint postcondition failed (definition=%, validated=%)',
      v_definition,
      v_validated;
  END IF;
END;
$meta_constraint$;

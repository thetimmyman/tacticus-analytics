-- target-db: general
-- Patch production's installed snapshot body in place to publish meta-team labels;
-- fails closed unless its shape and security posture match.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_signature regprocedure :=
    pg_catalog.to_regprocedure('public.refresh_public_guild_snapshots()');
  v_classifier_signature regprocedure :=
    pg_catalog.to_regprocedure('public.get_meta_team(text)');
  v_before record;
  v_after record;
  v_definition text;
  v_rewritten_definition text;
  v_after_definition text;
  v_old_fragment constant text := '''metaTeam'', ''Other''';
  v_new_fragment constant text :=
    '''metaTeam'', COALESCE(public.get_meta_team(d."heroDetails"), ''Other'')';
  v_old_occurrences integer;
  v_new_occurrences integer;
  v_expected_non_owner_grantees text[];
  v_actual_non_owner_grantees text[];
  v_public_execute_count integer;
  v_non_owner_grant_option_count integer;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION
      'WI-7920: required function public.refresh_public_guild_snapshots() is absent';
  END IF;

  IF v_classifier_signature IS NULL THEN
    RAISE EXCEPTION
      'WI-7920: required classifier public.get_meta_team(text) is absent';
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

  -- The consolidated baseline and the enriched live function intentionally
  -- have different pre-existing ACLs. Accept only those two known postures,
  -- keyed to the body shape that distinguishes the environments. Merely
  -- preserving an already-drifted ACL would make the rewrite fail open.
  IF pg_catalog.strpos(v_definition, 'showcase_enabled') > 0
     AND pg_catalog.strpos(v_definition, 'recruitment_status') > 0
  THEN
    v_expected_non_owner_grantees := ARRAY['service_role']::text[];
  ELSIF pg_catalog.strpos(v_definition, 'showcase_enabled') = 0
        AND pg_catalog.strpos(v_definition, 'recruitment_status') = 0
  THEN
    v_expected_non_owner_grantees :=
      ARRAY['anon', 'authenticated', 'service_role']::text[];
  ELSE
    RAISE EXCEPTION
      'WI-7920: refresh function has an unexpected projection shape';
  END IF;

  SELECT ARRAY(
    SELECT COALESCE(grantee.rolname, 'PUBLIC'::name)::text
    FROM pg_catalog.aclexplode(
      COALESCE(
        v_before.proacl,
        pg_catalog.acldefault('f', v_before.proowner)
      )
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> v_before.proowner
    ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
  )
  INTO v_actual_non_owner_grantees;

  SELECT
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee = 0
    ),
    count(*) FILTER (
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> v_before.proowner
        AND acl.is_grantable
    )
  INTO v_public_execute_count, v_non_owner_grant_option_count
  FROM pg_catalog.aclexplode(
    COALESCE(
      v_before.proacl,
      pg_catalog.acldefault('f', v_before.proowner)
    )
  ) AS acl;

  IF pg_catalog.pg_get_userbyid(v_before.proowner) IS DISTINCT FROM 'postgres'
     OR v_before.prosecdef IS DISTINCT FROM true
     OR v_before.provolatile IS DISTINCT FROM 'v'::"char"
     OR v_before.proparallel IS DISTINCT FROM 'u'::"char"
     OR v_before.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR v_before.prolang IS DISTINCT FROM
       (SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql')
     OR v_before.prorettype IS DISTINCT FROM 'void'::regtype::oid
     OR v_actual_non_owner_grantees IS DISTINCT FROM
       v_expected_non_owner_grantees
     OR v_public_execute_count IS DISTINCT FROM 0
     OR v_non_owner_grant_option_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'WI-7920: refresh_public_guild_snapshots() has an unexpected catalog posture or ACL (actual non-owner grantees=%, expected=%, PUBLIC execute=%, non-owner grant options=%)',
      v_actual_non_owner_grantees,
      v_expected_non_owner_grantees,
      v_public_execute_count,
      v_non_owner_grant_option_count;
  END IF;

  v_old_occurrences :=
    (pg_catalog.length(v_definition)
      - pg_catalog.length(
          pg_catalog.replace(v_definition, v_old_fragment, '')
        ))
    / pg_catalog.length(v_old_fragment);
  v_new_occurrences :=
    (pg_catalog.length(v_definition)
      - pg_catalog.length(
          pg_catalog.replace(v_definition, v_new_fragment, '')
        ))
    / pg_catalog.length(v_new_fragment);

  IF v_old_occurrences IS DISTINCT FROM 1
     OR v_new_occurrences IS DISTINCT FROM 0
     OR pg_catalog.strpos(v_definition, 'public.get_meta_team(') > 0
  THEN
    RAISE EXCEPTION
      'WI-7920: expected exactly one stale metaTeam literal and no existing canonical classifier call (old=%, new=%)',
      v_old_occurrences,
      v_new_occurrences;
  END IF;

  v_rewritten_definition :=
    pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
  EXECUTE v_rewritten_definition;

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
  WHERE function.oid =
    pg_catalog.to_regprocedure('public.refresh_public_guild_snapshots()')::oid;

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
  THEN
    RAISE EXCEPTION
      'WI-7920: catalog posture changed while replacing the snapshot classifier';
  END IF;

  v_after_definition := pg_catalog.pg_get_functiondef(v_after.oid);
  v_old_occurrences :=
    (pg_catalog.length(v_after_definition)
      - pg_catalog.length(
          pg_catalog.replace(v_after_definition, v_old_fragment, '')
        ))
    / pg_catalog.length(v_old_fragment);
  v_new_occurrences :=
    (pg_catalog.length(v_after_definition)
      - pg_catalog.length(
          pg_catalog.replace(v_after_definition, v_new_fragment, '')
        ))
    / pg_catalog.length(v_new_fragment);

  IF v_after_definition IS DISTINCT FROM v_rewritten_definition
     OR v_old_occurrences IS DISTINCT FROM 0
     OR v_new_occurrences IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION
      'WI-7920: classifier replacement postcondition failed (old=%, new=%)',
      v_old_occurrences,
      v_new_occurrences;
  END IF;
END;
$migration$;

COMMIT;

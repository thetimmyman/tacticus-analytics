-- Progression mutations are service-only; malformed meta-team config cannot
-- collapse snapshot classification.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260824210000'
    AND name = 'harden_progression_and_meta_config'
) AS hardening_not_applied \gset

\if :hardening_not_applied
SELECT plan(29);
SELECT * FROM skip(
  29,
  'this database predates the adversarial progression/meta hardening migration'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(29);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260824210000'
      AND name = 'harden_progression_and_meta_config'
  ),
  1,
  'the adversarial hardening migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc
    WHERE oid =
      'public.set_active_progression_config(uuid,boolean)'::regprocedure
  ),
  1,
  'the exact progression toggle signature exists'
);

SELECT is(
  (
    SELECT pg_catalog.pg_get_userbyid(function.proowner)
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.set_active_progression_config(uuid,boolean)'::regprocedure
  ),
  'postgres',
  'the progression toggle remains postgres-owned'
);

SELECT ok(
  (
    SELECT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.set_active_progression_config(uuid,boolean)'::regprocedure
  ),
  'the progression toggle remains SECURITY DEFINER'
);

SELECT is(
  (
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
      WHERE function.oid =
        'public.set_active_progression_config(uuid,boolean)'::regprocedure
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> function.proowner
      ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
    )
  ),
  ARRAY['service_role']::text[],
  'only service_role has non-owner EXECUTE on the progression toggle'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'anon',
    'public.set_active_progression_config(uuid,boolean)',
    'EXECUTE'
  ),
  'anon cannot call the progression toggle directly'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_active_progression_config(uuid,boolean)',
    'EXECUTE'
  ),
  'authenticated cannot bypass the app-admin route through the RPC'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.set_active_progression_config(uuid,boolean)',
    'EXECUTE'
  ),
  'the server-side admin route retains progression-toggle access'
);

SELECT is(
  (
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
      WHERE function.oid =
        'public.manual_refresh_guild_snapshots()'::regprocedure
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> function.proowner
      ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
    )
  ),
  ARRAY['service_role']::text[],
  'clean replay keeps the manual snapshot refresh service-role-only'
);

SELECT is(
  (
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
      WHERE function.oid =
        'public.refresh_public_guild_snapshots()'::regprocedure
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> function.proowner
      ORDER BY COALESCE(grantee.rolname, 'PUBLIC'::name)::text
    )
  ),
  ARRAY['service_role']::text[],
  'the forward hardening makes the public snapshot refresh service-role-only'
);

SELECT set_eq(
  $actual$
    SELECT grantee || '|' || privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'meta_teams'
      AND grantee IN ('anon', 'authenticated', 'service_role')
  $actual$,
  $expected$
    VALUES
      ('anon|SELECT'),
      ('authenticated|SELECT'),
      ('service_role|DELETE'),
      ('service_role|INSERT'),
      ('service_role|REFERENCES'),
      ('service_role|SELECT'),
      ('service_role|TRIGGER'),
      ('service_role|TRUNCATE'),
      ('service_role|UPDATE')
  $expected$,
  'clean replay matches the live meta_teams table grants'
);

SELECT ok(
  (
    SELECT other_acl = ARRAY[]::text[]
      OR other_acl = ARRAY['analytics_ro:SELECT:false']::text[]
    FROM (
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
        WHERE relation.oid = 'public.meta_teams'::regclass
          AND acl.grantee NOT IN (
            0,
            relation.relowner,
            'anon'::regrole::oid,
            'authenticated'::regrole::oid,
            'service_role'::regrole::oid
          )
        ORDER BY 1
      ) AS other_acl
    ) AS captured
  ),
  'meta_teams has no other table ACL beyond the captured analytics read role'
);

SELECT is(
  (
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
      WHERE attribute.attrelid = 'public.meta_teams'::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND attribute.attacl IS NOT NULL
        -- rest_reader's column-level SELECTs (read-only tooling) are set aside;
        -- any other privilege it held would still break the exact match.
        AND NOT (acl.grantee = 'rest_reader'::regrole
                 AND acl.privilege_type = 'SELECT' AND NOT acl.is_grantable)
      ORDER BY 1
    )
  ),
  ARRAY[
    'is_meta:command_center_rpc_owner:SELECT:false',
    'match_type:command_center_rpc_owner:SELECT:false',
    'sort_order:command_center_rpc_owner:SELECT:false',
    'team_name:command_center_rpc_owner:SELECT:false',
    'trigger_heroes:command_center_rpc_owner:SELECT:false'
  ]::text[],
  'meta_teams retains exactly the five captured command-center column grants beside the reader''s SELECTs'
);

SELECT ok(
  (
    SELECT pg_catalog.bool_and(
      CASE
        WHEN privilege_name = 'SELECT' THEN
          pg_catalog.has_table_privilege(
            role_name,
            'public.meta_teams',
            privilege_name
          )
        ELSE NOT pg_catalog.has_table_privilege(
          role_name,
          'public.meta_teams',
          privilege_name
        )
      END
    )
    FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
    CROSS JOIN (
      VALUES
        ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
        ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    ) AS privileges(privilege_name)
  ),
  'anon and authenticated effectively retain SELECT and no table write privilege'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
    CROSS JOIN pg_catalog.pg_attribute AS attribute
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES'))
      AS privileges(privilege_name)
    WHERE attribute.attrelid = 'public.meta_teams'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND pg_catalog.has_column_privilege(
        role_name,
        'public.meta_teams',
        attribute.attnum,
        privilege_name
      )
  ),
  'anon and authenticated have no effective write privilege on any meta_teams column'
);

SELECT ok(
  (
    SELECT (
        pg_catalog.length(definition)
          - pg_catalog.length(
            pg_catalog.replace(definition, 'WHEN OTHERS', '')
          )
      ) / pg_catalog.length('WHEN OTHERS') = 1
      AND pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(definition, 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = '8d637fcdcf07a4c38fca2ccf66d92dcb8df38a1597fa33789fba9c1dae213d08'
    FROM (
      SELECT pg_catalog.pg_get_functiondef(
        'public.get_meta_team(text)'::regprocedure
      ) AS definition
    ) AS source
  ),
  'the classifier confines its only catch-all to the caller JSON cast'
);

SELECT ok(
  (
    SELECT constraint_row.convalidated
      AND pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        'WHEN is_meta IS TRUE THEN'
      ) > 0
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.meta_teams'::regclass
      AND constraint_row.conname = 'meta_teams_trigger_heroes_array_check'
  ),
  'trigger_heroes has the exact validated JSON-array constraint'
);

SELECT is(
  (
    SELECT count(*)::integer
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
  ),
  0,
  'no existing active meta-team configuration violates the non-empty array contract'
);

INSERT INTO public.hero_mappings (unit_id, display_name)
VALUES ('ADVERSARIAL-META-H1', 'Adversarial Meta Hero');

INSERT INTO public.meta_teams (
  team_name,
  is_meta,
  sort_order,
  trigger_heroes,
  match_type
)
VALUES (
  'Adversarial Meta Team',
  true,
  -2421,
  '["Adversarial Meta Hero"]'::jsonb,
  'all'
);

SELECT is(
  public.get_meta_team('[{"unitId":"ADVERSARIAL-META-H1"}]'),
  'Adversarial Meta Team',
  'valid classifier configuration continues to resolve canonically'
);

SELECT is(
  public.get_meta_team('{malformed'),
  NULL::text,
  'malformed caller JSON still degrades to NULL'
);

SELECT is(
  public.get_meta_team($json$"\u0000"$json$),
  NULL::text,
  'an untranslatable JSON null escape degrades to NULL at the caller boundary'
);

SELECT is(
  public.get_meta_team($json${"x":1e1000000}$json$),
  NULL::text,
  'an out-of-range JSON number degrades to NULL at the caller boundary'
);

SELECT is(
  public.get_meta_team('{}'),
  NULL::text,
  'a caller JSON object is rejected locally as a non-team input'
);

SELECT is(
  public.get_meta_team('1'),
  NULL::text,
  'a caller JSON scalar is rejected locally as a non-team input'
);

SELECT throws_ok(
  $$INSERT INTO public.meta_teams (
      team_name, is_meta, sort_order, trigger_heroes, match_type
    ) VALUES (
      'Adversarial Active Null', true, -2422, NULL, 'all'
    )$$,
  '23514',
  NULL,
  'an active meta-team cannot have NULL trigger configuration'
);

SELECT throws_ok(
  $$INSERT INTO public.meta_teams (
      team_name, is_meta, sort_order, trigger_heroes, match_type
    ) VALUES (
      'Adversarial Active Empty', true, -2423, '[]'::jsonb, 'all'
    )$$,
  '23514',
  NULL,
  'an active meta-team cannot have an empty trigger array'
);

SELECT throws_ok(
  $$INSERT INTO public.meta_teams (
      team_name, is_meta, sort_order, trigger_heroes, match_type
    ) VALUES (
      'Adversarial Active Object', true, -2424, '{}'::jsonb, 'all'
    )$$,
  '23514',
  NULL,
  'an active meta-team cannot have non-array trigger configuration'
);

SELECT lives_ok(
  $$INSERT INTO public.meta_teams (
      team_name, is_meta, sort_order, trigger_heroes, match_type
    ) VALUES (
      'Adversarial Inactive Object', false, -2425, '{}'::jsonb, 'all'
    )$$,
  'inactive configuration remains outside the active classifier contract'
);

-- The function must not hide a catalog/config defect (removal is rolled back).
ALTER TABLE public.meta_teams
  DROP CONSTRAINT meta_teams_trigger_heroes_array_check;

INSERT INTO public.meta_teams (
  team_name,
  is_meta,
  sort_order,
  trigger_heroes,
  match_type
)
VALUES (
  'Adversarial Malformed Active Config',
  true,
  -999999,
  '{}'::jsonb,
  'all'
);

SELECT throws_ok(
  $$SELECT public.get_meta_team('[{"unitId":"ADVERSARIAL-META-H1"}]')$$,
  '22023',
  'cannot get array length of a non-array',
  'malformed active configuration propagates instead of collapsing to NULL'
);

SELECT * FROM finish();
ROLLBACK;
\endif

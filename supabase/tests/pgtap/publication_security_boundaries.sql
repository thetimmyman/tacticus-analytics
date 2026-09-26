BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(6);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260814000000'
      AND name = 'publication_security_boundaries'
  ),
  1,
  'publication security migration is recorded exactly once'
);

SELECT set_eq(
  $actual$
    SELECT function.oid::regprocedure::text || '|' || COALESCE(grantee.rolname, 'PUBLIC')
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE function.oid IN (
      'public.get_cron_secret()'::regprocedure,
      'public.get_service_role_key()'::regprocedure,
      'public.get_tacticus_api_key()'::regprocedure,
      'public.call_edge_function(text,jsonb)'::regprocedure,
      'public.admin_add_alpha_tester(text,text,timestamptz)'::regprocedure,
      'public.admin_remove_alpha_tester(text)'::regprocedure,
      'public.analyze_inactive_guilds()'::regprocedure,
      'public.get_core_compositions(text,text,integer,integer,integer,integer,integer)'::regprocedure,
      'public.get_war_stats(text,text)'::regprocedure,
      'public.consume_discord_bot_invite(text,text,text)'::regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> function.proowner
  $actual$,
  $expected$
    VALUES
      ('get_cron_secret()|service_role'),
      ('get_service_role_key()|service_role'),
      ('get_tacticus_api_key()|service_role'),
      ('call_edge_function(text,jsonb)|service_role'),
      ('admin_add_alpha_tester(text,text,timestamp with time zone)|service_role'),
      ('admin_remove_alpha_tester(text)|service_role'),
      ('analyze_inactive_guilds()|service_role'),
      ('get_core_compositions(text,text,integer,integer,integer,integer,integer)|service_role'),
      ('get_war_stats(text,text)|service_role'),
      ('consume_discord_bot_invite(text,text,text)|service_role')
  $expected$,
  'sensitive functions expose exactly service_role execution'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (VALUES
      ('public.get_cron_secret()'),
      ('public.get_service_role_key()'),
      ('public.get_tacticus_api_key()'),
      ('public.call_edge_function(text,jsonb)'),
      ('public.admin_add_alpha_tester(text,text,timestamptz)'),
      ('public.admin_remove_alpha_tester(text)'),
      ('public.analyze_inactive_guilds()'),
      ('public.get_core_compositions(text,text,integer,integer,integer,integer,integer)'),
      ('public.get_war_stats(text,text)'),
      ('public.consume_discord_bot_invite(text,text,text)')
    ) AS signature(value)
    WHERE has_function_privilege('anon', signature.value, 'EXECUTE')
       OR has_function_privilege('authenticated', signature.value, 'EXECUTE')
  ),
  0,
  'anon and authenticated cannot execute sensitive functions'
);

SELECT is(
  to_regprocedure('public.process_raw_api_to_structured()'),
  NULL::regprocedure,
  'retired raw API processor is absent after forward migrations'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (VALUES
      ('public.auth_user_emails'),
      ('public.api_key_coverage')
    ) AS relation(value)
    WHERE has_table_privilege('anon', relation.value, 'SELECT')
       OR has_table_privilege('authenticated', relation.value, 'SELECT')
  ),
  0,
  'anon and authenticated cannot read privileged views'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (VALUES
      ('public.auth_user_emails'),
      ('public.api_key_coverage')
    ) AS relation(value)
    WHERE has_table_privilege('service_role', relation.value, 'SELECT')
  ),
  2,
  'service_role retains access to privileged views'
);

SELECT * FROM finish();
ROLLBACK;

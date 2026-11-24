BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(17);

-- A guild leader takes their guild out of its cluster through the owner-only
-- function, and the guild's members lose the cluster with it.

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20261120170000'
      AND name = 'guild_leave_cluster'
  ),
  1,
  'guild leave cluster migration is recorded exactly once'
);

SELECT set_eq(
  $actual$
    SELECT COALESCE(grantee.rolname, 'PUBLIC')
    FROM pg_catalog.pg_proc AS function
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function.proacl, pg_catalog.acldefault('f', function.proowner))
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE function.oid =
      'public.leave_guild_cluster(text,uuid,uuid)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $actual$,
  $expected$ VALUES ('postgres'), ('service_role') $expected$,
  'only postgres and service_role may execute the cluster leave'
);

SELECT is(
  (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.leave_guild_cluster(text,uuid,uuid)'::regprocedure
  ),
  true,
  'the cluster leave is SECURITY DEFINER (only the owner can open the reset)'
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('11200000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leader@t1120.test'),
  ('11200000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'officer@t1120.test'),
  ('11200000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'creator@t1120.test');

INSERT INTO public.clusters (id, cluster_code, display_name, created_by)
VALUES (
  '11200000-0000-0000-0000-0000000000c1', 'T1120C', 'Leave Test Cluster',
  '11200000-0000-0000-0000-000000000003'
);

INSERT INTO public.guild_config (
  id, guild_code, display_name, guild_id, cluster_code, cluster_id, is_cluster, enabled
) VALUES
  (1120170001, 'T1120LV', 'Leaving Guild', 't1120-leaving', 'T1120C',
   '11200000-0000-0000-0000-0000000000c1', true, true),
  (1120170002, 'T1120CR', 'Creator Guild', 't1120-creator', 'T1120C',
   '11200000-0000-0000-0000-0000000000c1', true, true);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role, is_current, is_active
) VALUES
  (1120170001, 't1120-leader', 'Leaving Leader', 'T1120LV',
   'leader'::public.app_role, true, true),
  (1120170002, 't1120-officer', 'Leaving Officer', 'T1120LV',
   'officer'::public.app_role, true, true),
  (1120170003, 't1120-member', 'Leaving Member', 'T1120LV',
   'member'::public.app_role, true, true),
  (1120170004, 't1120-creator', 'Cluster Creator', 'T1120CR',
   'leader'::public.app_role, true, true),
  (1120170005, 't1120-staying', 'Staying Member', 'T1120CR',
   'member'::public.app_role, true, true);

UPDATE public.player_mapping
SET cluster_code = 'T1120C', cluster_id = '11200000-0000-0000-0000-0000000000c1'
WHERE id BETWEEN 1120170001 AND 1120170005;

INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
) VALUES
  ('11200000-0000-0000-0000-0000000000a1', 1120170001, 't1120-leader',
   '11200000-0000-0000-0000-000000000001', clock_timestamp(), clock_timestamp(),
   'operator_quarantine_restore', 'T1120LV'),
  ('11200000-0000-0000-0000-0000000000a2', 1120170002, 't1120-officer',
   '11200000-0000-0000-0000-000000000002', clock_timestamp(), clock_timestamp(),
   'operator_quarantine_restore', 'T1120LV'),
  ('11200000-0000-0000-0000-0000000000a3', 1120170004, 't1120-creator',
   '11200000-0000-0000-0000-000000000003', clock_timestamp(), clock_timestamp(),
   'operator_quarantine_restore', 'T1120CR');

UPDATE public.player_mapping
SET user_id = '11200000-0000-0000-0000-000000000001',
    ownership_attestation_id = '11200000-0000-0000-0000-0000000000a1'
WHERE id = 1120170001;
UPDATE public.player_mapping
SET user_id = '11200000-0000-0000-0000-000000000002',
    ownership_attestation_id = '11200000-0000-0000-0000-0000000000a2'
WHERE id = 1120170002;
UPDATE public.player_mapping
SET user_id = '11200000-0000-0000-0000-000000000003',
    ownership_attestation_id = '11200000-0000-0000-0000-0000000000a3'
WHERE id = 1120170004;

SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120LV', '11200000-0000-0000-0000-0000000000c1',
       '11200000-0000-0000-0000-000000000002') $$,
  '42501',
  NULL,
  'an officer cannot take the guild out of its cluster'
);

SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120LV', '11200000-0000-0000-0000-0000000000c1',
       '11200000-0000-0000-0000-000000000003') $$,
  '42501',
  NULL,
  'a leader of another guild cannot take this guild out'
);

SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120CR', '11200000-0000-0000-0000-0000000000c1',
       '11200000-0000-0000-0000-000000000003') $$,
  '42501',
  NULL,
  'the cluster creator cannot leave their own cluster'
);

SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120LV', '11200000-0000-0000-0000-0000000000ff',
       '11200000-0000-0000-0000-000000000001') $$,
  '55000',
  NULL,
  'a stale expected cluster is refused'
);

SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120NONE', '11200000-0000-0000-0000-0000000000c1',
       '11200000-0000-0000-0000-000000000001') $$,
  'P0002',
  NULL,
  'an unknown guild is refused'
);

SELECT is(
  (
    SELECT guild_code || ':' || previous_cluster_code || ':' || cleared_mappings::text
    FROM public.leave_guild_cluster(
      'T1120LV', '11200000-0000-0000-0000-0000000000c1',
      '11200000-0000-0000-0000-000000000001')
  ),
  'T1120LV:T1120C:3',
  'the leader takes the guild out and every mapping of the guild is cleared'
);

SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120LV', '11200000-0000-0000-0000-0000000000c1',
       '11200000-0000-0000-0000-000000000001') $$,
  '55000',
  NULL,
  'a repeated leave is refused because the guild is no longer in the cluster'
);

-- Outside the call, a sync write that blanks a cluster is still undone.
UPDATE public.player_mapping
SET cluster_code = NULL, cluster_id = NULL
WHERE id = 1120170005;

-- The reset names one guild: it never clears a mapping of another guild.
SELECT set_config('app.guild_cluster_leave_reset', 'T1120LV', true);
UPDATE public.player_mapping
SET cluster_code = NULL, cluster_id = NULL
WHERE id = 1120170004;
SELECT set_config('app.guild_cluster_leave_reset', '', true);

RESET ROLE;

SELECT is(
  (
    SELECT coalesce(cluster_code, 'NULL') || ':' || coalesce(cluster_id::text, 'NULL')
      || ':' || is_cluster::text || ':' || enabled::text
    FROM public.guild_config WHERE id = 1120170001
  ),
  'NULL:NULL:false:true',
  'the guild has no cluster and keeps syncing'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.player_mapping
    WHERE guild_code = 'T1120LV'
      AND (cluster_code IS NOT NULL OR cluster_id IS NOT NULL)
  ),
  0,
  'no mapping of the departed guild keeps the cluster'
);

SELECT is(
  (
    SELECT string_agg(role::text || ':' || coalesce(user_id::text, 'NULL'), ',' ORDER BY id)
    FROM public.player_mapping
    WHERE guild_code = 'T1120LV'
  ),
  'leader:11200000-0000-0000-0000-000000000001,'
    || 'officer:11200000-0000-0000-0000-000000000002,member:NULL',
  'the departed guild keeps its members, roles and logins'
);

SELECT is(
  (
    SELECT string_agg(coalesce(cluster_code, 'NULL'), ',' ORDER BY id)
    FROM public.player_mapping
    WHERE guild_code = 'T1120CR'
  ),
  'T1120C,T1120C',
  'the staying guild keeps its cluster, including against a blanking write'
);

SELECT is(
  (
    SELECT coalesce(cluster_code, 'NULL')
    FROM public.guild_config WHERE id = 1120170002
  ),
  'T1120C',
  'the staying guild is still in the cluster'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.audit_logs
    WHERE action = 'guild_left_cluster'
      AND user_id = '11200000-0000-0000-0000-000000000001'
      AND details->>'guild_code' = 'T1120LV'
      AND details->>'previous_cluster_code' = 'T1120C'
      AND details->>'previous_cluster_id' = '11200000-0000-0000-0000-0000000000c1'
      AND (details->>'cleared_mappings')::integer = 3
  ),
  1,
  'one audit row records who took which guild out of which cluster'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.leave_guild_cluster(
       'T1120CR', '11200000-0000-0000-0000-0000000000c1',
       '11200000-0000-0000-0000-000000000003') $$,
  '42501',
  NULL,
  'an authenticated caller cannot run the cluster leave'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

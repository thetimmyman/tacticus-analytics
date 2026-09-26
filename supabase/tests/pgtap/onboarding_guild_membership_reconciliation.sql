BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(14);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260820180000'
      AND name = 'reconcile_onboarding_guild_membership'
  ),
  1,
  'guild membership reconciliation migration is recorded exactly once'
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
      'public.reconcile_own_guild_membership(uuid,text,text,text,text,text,text,text,bigint)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $actual$,
  $expected$ VALUES ('postgres'), ('service_role') $expected$,
  'only postgres and service_role may execute guild reconciliation'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.reconcile_own_guild_membership(uuid,text,text,text,text,text,text,text,bigint)',
    'EXECUTE'
  ),
  'anon cannot reconcile guild membership'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.reconcile_own_guild_membership(uuid,text,text,text,text,text,text,text,bigint)',
    'EXECUTE'
  ),
  'authenticated cannot call the server reconciliation RPC directly'
);

SELECT is(
  (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid =
      'public.reconcile_own_guild_membership(uuid,text,text,text,text,text,text,text,bigint)'::regprocedure
  ),
  true,
  'guild reconciliation is SECURITY DEFINER'
);

SELECT throws_ok(
  $$ SELECT public.reconcile_own_guild_membership(
       '00000000-0000-0000-0000-000000000001'::uuid,
       'player-1', 'OLD1', 'old-id', 'NEW1', 'new-id',
       'officer', repeat('a', 64), 1
     ) $$,
  '42501',
  NULL,
  'a non-service caller is rejected even if EXECUTE is granted later'
);

INSERT INTO public.guild_config (
  id, guild_code, display_name, guild_id, enabled, cluster_id, cluster_code
) VALUES
  (820180001, 'T820OLD', 'Reconcile Source', 't820-source', true,
   '82018000-0000-0000-0000-000000000001', 'T820CL'),
  (820180002, 'T820NEW', 'Reconcile Target', 't820-target', true,
   '82018000-0000-0000-0000-000000000002', 'T820CL2');

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '82018000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'reconcile@t820.test'
);

INSERT INTO public.onboarding_progress (
  user_id, guild_attempt_generation
) VALUES (
  '82018000-0000-0000-0000-000000000003', 1
);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role, is_current, is_active
) VALUES (
  820180001, 't820-player', 'Reconcile Player', 'T820OLD',
  'member'::public.app_role, true, true
);

INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
) VALUES (
  '82018000-0000-0000-0000-000000000004',
  820180001, 't820-player',
  '82018000-0000-0000-0000-000000000003',
  clock_timestamp(), clock_timestamp(),
  'operator_quarantine_restore', 'T820OLD'
);

UPDATE public.player_mapping
SET user_id = '82018000-0000-0000-0000-000000000003',
    ownership_attestation_id = '82018000-0000-0000-0000-000000000004'
WHERE id = 820180001;

UPDATE public.onboarding_progress
SET guild_attempt_generation = 2
WHERE user_id = '82018000-0000-0000-0000-000000000003';

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.reconcile_own_guild_membership(
      '82018000-0000-0000-0000-000000000003',
      't820-player', 'T820OLD', 't820-source',
      'T820NEW', 't820-target', 'leader', repeat('b', 64), 1
    ) ->> 'error_code'
  ),
  'ATTEMPT_SUPERSEDED',
  'a superseded onboarding attempt cannot mutate guild membership'
);
RESET ROLE;

SELECT is(
  (
    SELECT mapping.guild_code
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 820180001
  ),
  'T820OLD',
  'the superseded mutation leaves the source mapping unchanged'
);

UPDATE public.onboarding_progress
SET guild_attempt_generation = 1
WHERE user_id = '82018000-0000-0000-0000-000000000003';

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.reconcile_own_guild_membership(
      '82018000-0000-0000-0000-000000000003',
      't820-player', 'T820OLD', 't820-source',
      'T820NEW', 'wrong-target-id', 'leader', repeat('b', 64), 1
    ) ->> 'error_code'
  ),
  'TARGET_GUILD_ID_CHANGED',
  'a changed target identity is rejected under the guild row locks'
);

SELECT is(
  (
    public.reconcile_own_guild_membership(
      '82018000-0000-0000-0000-000000000003',
      't820-player', 'T820OLD', 't820-source',
      'T820NEW', 't820-target', 'leader', repeat('b', 64), 1
    ) ->> 'success'
  ),
  'true',
  'service reconciliation succeeds for one exact attested source mapping'
);
RESET ROLE;

SELECT set_config('app.guild_membership_reconciliation_subject', '', true);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$ UPDATE public.player_mapping
     SET guild_code = 'T820OLD'
     WHERE id = 820180001 $$,
  '42501',
  'Attested guild membership requires reconciliation',
  'a stale generic sync cannot move the reconciled attested row back'
);
RESET ROLE;

SELECT is(
  (
    SELECT coalesce(mapping.guild_code, 'NULL') || ':'
      || coalesce(mapping.role::text, 'NULL') || ':'
      || coalesce(mapping.user_id::text, 'NULL') || ':'
      || coalesce(mapping.ownership_attestation_id::text, 'NULL')
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 820180001
  ),
  'T820NEW:leader:82018000-0000-0000-0000-000000000003:'
    || '82018000-0000-0000-0000-000000000004',
  'the same mapping moves while its subject and attestation are preserved'
);

SELECT is(
  (
    SELECT audit.details ->> 'upstream_digest'
    FROM public.player_claim_audit AS audit
    WHERE audit.source_path = 'onboarding/guild-membership-reconciliation'
      AND audit.player_id = 't820-player'
    ORDER BY audit.id DESC
    LIMIT 1
  ),
  repeat('b', 64),
  'the transition records only the non-secret upstream evidence digest'
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.reconcile_own_guild_membership(
      '82018000-0000-0000-0000-000000000003',
      't820-player', 'T820OLD', 't820-source',
      'T820NEW', 't820-target', 'leader', repeat('b', 64), 1
    ) ->> 'idempotent'
  ),
  'true',
  'a retry after the move is idempotent'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

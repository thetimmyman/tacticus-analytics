BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(12);

-- A roster sync moves a claimed player into the guild whose live Tacticus
-- roster lists them, through the owner-only function and nothing else.

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20261009160000'
      AND name = 'roster_confirmed_attested_transfer'
  ),
  1,
  'roster-confirmed transfer migration is recorded exactly once'
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
      'public.transfer_roster_confirmed_players(text,text[])'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
  $actual$,
  $expected$ VALUES ('postgres'), ('service_role') $expected$,
  'only postgres and service_role may execute the roster transfer'
);

SELECT is(
  (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.transfer_roster_confirmed_players(text,text[])'::regprocedure
  ),
  true,
  'the roster transfer is SECURITY DEFINER (only the owner can open the move guard)'
);

INSERT INTO public.guild_config (
  id, guild_code, display_name, guild_id, enabled
) VALUES
  (1009160001, 'T1009OLD', 'Transfer Source', 't1009-source', true),
  (1009160002, 'T1009NEW', 'Transfer Target', 't1009-target', true),
  (1009160003, 'T1009OFF', 'Transfer Disabled', 't1009-disabled', false);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '10091600-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'transfer@t1009.test'
);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role, is_current, is_active
) VALUES
  (1009160001, 't1009-claimed', 'Claimed Player', 'T1009OLD',
   'officer'::public.app_role, true, true),
  (1009160002, 't1009-protected', 'Protected Player', 'T1009OLD',
   'member'::public.app_role, true, true);

UPDATE public.player_mapping SET protected = true WHERE id = 1009160002;

INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
) VALUES (
  '10091600-0000-0000-0000-000000000002',
  1009160001, 't1009-claimed',
  '10091600-0000-0000-0000-000000000001',
  clock_timestamp(), clock_timestamp(),
  'operator_quarantine_restore', 'T1009OLD'
);

UPDATE public.player_mapping
SET user_id = '10091600-0000-0000-0000-000000000001',
    ownership_attestation_id = '10091600-0000-0000-0000-000000000002'
WHERE id = 1009160001;

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$ UPDATE public.player_mapping
     SET guild_code = 'T1009NEW'
     WHERE id = 1009160001 $$,
  '42501',
  'Attested guild membership requires reconciliation',
  'a plain sync write still cannot move the attested player'
);

SELECT throws_ok(
  $$ SELECT * FROM public.transfer_roster_confirmed_players(
       'T1009OFF', ARRAY['t1009-claimed']) $$,
  '22023',
  NULL,
  'a disabled target guild is refused'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.transfer_roster_confirmed_players(
      'T1009NEW', ARRAY['t1009-claimed', 't1009-protected', 't1009-missing'])
  ),
  1,
  'only the unprotected existing player is moved'
);
RESET ROLE;

SELECT is(
  (
    SELECT mapping.guild_code || ':' || mapping.role::text || ':'
      || mapping.is_current::text || ':'
      || coalesce(mapping.user_id::text, 'NULL') || ':'
      || coalesce(mapping.ownership_attestation_id::text, 'NULL')
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 1009160001
  ),
  'T1009NEW:member:true:10091600-0000-0000-0000-000000000001:'
    || '10091600-0000-0000-0000-000000000002',
  'the moved mapping keeps its login and attestation, and its role is reset to member'
);

SELECT is(
  (SELECT guild_code FROM public.player_mapping WHERE id = 1009160002),
  'T1009OLD',
  'a protected mapping is never moved'
);

SELECT is(
  current_setting('app.guild_membership_reconciliation_subject', true),
  '',
  'the reconciliation subject does not outlive the move'
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.transfer_roster_confirmed_players(
      'T1009NEW', ARRAY['t1009-claimed'])
  ),
  0,
  'a player already in the target guild is not moved again'
);

SELECT throws_ok(
  $$ SELECT * FROM public.transfer_roster_confirmed_players(
       'T1009NEW', array_fill('x'::text, ARRAY[201])) $$,
  '22023',
  NULL,
  'more than 200 players in one call is refused'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.transfer_roster_confirmed_players(
       'T1009NEW', ARRAY['t1009-claimed']) $$,
  '42501',
  NULL,
  'an authenticated caller cannot run the transfer'
);
RESET ROLE;

SELECT finish();
ROLLBACK;

-- Anon-executable definer oracles over player_mapping are gated or revoked. can_view_playbook keeps
-- anon EXECUTE: two TO public policies call it with auth.uid() (NULL for anon).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(19);

-- grantee = 0 is PUBLIC (has_function_privilege() cannot ask about it).
SELECT is(
  (SELECT count(*)::integer
     FROM unnest(ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.can_view_playbook(character varying, text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.can_view_assigned_playbook(text, uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]) AS fn,
     LATERAL (SELECT p.proacl FROM pg_proc p WHERE p.oid = fn::regprocedure) AS s,
     LATERAL aclexplode(s.proacl) AS a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC holds no EXECUTE on any of the seven, so a new role cannot inherit one'
);

SELECT is(
  (SELECT count(*)::integer
     FROM unnest(ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.can_view_assigned_playbook(text, uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]) AS fn
    WHERE has_function_privilege('anon', fn::regprocedure, 'EXECUTE')),
  0,
  'anon holds no EXECUTE on the six oracles that no anon path needs'
);

SELECT is(
  (SELECT count(*)::integer
     FROM unnest(ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]) AS fn
    WHERE has_function_privilege('authenticated', fn::regprocedure, 'EXECUTE')),
  0,
  'authenticated holds no EXECUTE on the five that have no reader anywhere'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_proc p
    WHERE p.oid = ANY (ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.can_view_playbook(character varying, text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.can_view_assigned_playbook(text, uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]::regprocedure[])
      AND p.prosecdef),
  7,
  'all seven still exist with their original signatures and are still SECURITY DEFINER'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_proc p
    WHERE p.oid = ANY (ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.can_view_playbook(character varying, text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.can_view_assigned_playbook(text, uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]::regprocedure[])
      AND p.proconfig IS NOT NULL),
  7,
  'all seven keep a pinned search_path (none is additionally an unpinned definer)'
);

-- anon keeps EXECUTE, or the unauthenticated RLS read path fails.
SELECT ok(
  has_function_privilege('anon', 'public.can_view_playbook(character varying, text, uuid)'::regprocedure, 'EXECUTE'),
  'anon KEEPS EXECUTE on can_view_playbook -- its TO public RLS policies need it'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.can_view_playbook(character varying, text, uuid)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.can_view_assigned_playbook(text, uuid)'::regprocedure, 'EXECUTE'),
  'authenticated keeps EXECUTE on both guarded functions (their policies need it)'
);

SELECT is(
  (SELECT count(*)::integer
     FROM unnest(ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.can_view_playbook(character varying, text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.can_view_assigned_playbook(text, uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]) AS fn
    WHERE has_function_privilege('service_role', fn::regprocedure, 'EXECUTE')),
  7,
  'service_role retains EXECUTE on all seven (the fix is a gate, not a removal)'
);

-- Barrier 2: body guards. Subject B has no mapping, so a refusal cannot be "no such user".
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, anon;

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT public.can_view_playbook('ZZZ'::varchar, 'ZZZZZ', '22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501', NULL,
  'can_view_playbook: authenticated A asking about a DIFFERENT user B raises 42501'
);

SELECT lives_ok(
  $$ SELECT public.can_view_playbook('ZZZ'::varchar, 'ZZZZZ', '11111111-1111-4111-8111-111111111111'::uuid) $$,
  'can_view_playbook: authenticated A asking about ITSELF is allowed through the guard'
);

SELECT throws_ok(
  $$ SELECT public.can_view_playbook('ZZZ'::varchar, 'ZZZZZ', NULL::uuid) $$,
  '42501', NULL,
  'can_view_playbook: a NULL subject from a logged-IN caller raises 42501 (NULL does not skip the guard)'
);

SELECT throws_ok(
  $$ SELECT public.can_view_assigned_playbook('some-boss', '22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501', NULL,
  'can_view_assigned_playbook: authenticated A asking about a DIFFERENT user B raises 42501'
);

SELECT lives_ok(
  $$ SELECT public.can_view_assigned_playbook('some-boss', '11111111-1111-4111-8111-111111111111'::uuid) $$,
  'can_view_assigned_playbook: authenticated A asking about ITSELF is allowed through the guard'
);

SELECT throws_ok(
  $$ SELECT public.can_view_assigned_playbook('some-boss', NULL::uuid) $$,
  '42501', NULL,
  'can_view_assigned_playbook: a NULL subject from a logged-IN caller raises 42501'
);

SELECT set_config('request.jwt.claims', NULL, true);

SELECT throws_ok(
  $$ SELECT public.can_view_playbook('ZZZ'::varchar, 'ZZZZZ', '22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501', NULL,
  'can_view_playbook: authenticated with no auth.uid() (logged out) raises 42501 regardless of the ACL'
);

RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT lives_ok(
  $$ SELECT public.can_view_playbook('ZZZ'::varchar, 'ZZZZZ', NULL::uuid) $$,
  'can_view_playbook as anon with a NULL subject is ALLOWED -- exactly what the TO public policies pass'
);

SELECT throws_ok(
  $$ SELECT public.can_view_playbook('ZZZ'::varchar, 'ZZZZZ', '22222222-2222-4222-8222-222222222222'::uuid) $$,
  '42501', NULL,
  'can_view_playbook as anon NAMING a uuid raises 42501 -- the oracle is closed'
);

SELECT lives_ok(
  $$ SELECT count(*) FROM public.boss_playbook_team_requirements $$,
  'anon SELECT on boss_playbook_team_requirements still succeeds through the can_view_playbook policy'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM pg_proc p
    WHERE p.oid = ANY (ARRAY[
       'public.has_current_guild_membership(text, uuid)',
       'public.guild_restricts_playbook_access(uuid)',
       'public.user_guild_restricts_playbooks(uuid)',
       'public.is_user_assigned_to_boss(text, uuid)',
       'public.get_application_with_messages(uuid)'
     ]::regprocedure[])
      AND p.prosrc LIKE '%42501%'),
  0,
  'the five zero-reader bodies were not edited -- this migration only changed their ACL'
);

SELECT * FROM finish();
ROLLBACK;

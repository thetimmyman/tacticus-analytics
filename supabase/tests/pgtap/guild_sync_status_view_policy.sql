-- Policies run with the caller's privileges and authenticated cannot read player_mapping.user_id.
-- Probes park results in GUCs because pgtap is off the switched role's path.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(18);

SELECT is(
  current_database()::text,
  'postgres'::text,
  'A1: this suite runs against the general database'::text
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260921010000'
      AND name = 'ps721_guild_sync_status_view_policy'
  ),
  'A2: the ps721_guild_sync_status_view_policy migration is recorded in the ledger'
);

-- Premise: if either flips, re-read this suite, do not re-baseline it.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.player_mapping'::regclass,
                           'user_id', 'SELECT'),
  'B1: authenticated holds no SELECT on player_mapping.user_id -- the column the broken policy read'
);

SELECT ok(
  has_column_privilege('authenticated', 'public.player_mapping'::regclass,
                       'guild_code', 'SELECT'),
  'B2: authenticated DOES hold SELECT on player_mapping.guild_code -- the 2026-08-17 revoke is column-scoped, not a whole-table lockout, so B1 is a supported result and not a broken probe'
);

SELECT ok(
  (SELECT pg_get_expr(pol.polqual, pol.polrelid) ~ '_pm_caller_guild_codes'
     FROM pg_policy pol
    WHERE pol.polrelid = 'public.guild_sync_status'::regclass
      AND pol.polname = 'authenticated_users_can_view'),
  'C1: the policy resolves the caller''s guilds through _pm_caller_guild_codes()'
);

SELECT ok(
  (SELECT pg_get_expr(pol.polqual, pol.polrelid)
            !~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
     FROM pg_policy pol
    WHERE pol.polrelid = 'public.guild_sync_status'::regclass
      AND pol.polname = 'authenticated_users_can_view'),
  'C2: the policy does not read player_mapping as a base relation (the 42501 class)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policy pol
    WHERE pol.polrelid = 'public.guild_sync_status'::regclass
      AND pol.polname = 'authenticated_users_can_view'
      AND pol.polcmd = 'r'
      AND pol.polroles = ARRAY['authenticated'::regrole]::oid[]
  ),
  'C3: it is still a SELECT-only policy addressed to authenticated alone (not a widening)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policy pol
    WHERE pol.polrelid = 'public.guild_sync_status'::regclass
      AND pol.polname = 'service_role_all_access'
  ),
  'C4: service_role_all_access is untouched'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.guild_sync_status'::regclass),
  'C5: RLS is still enabled on guild_sync_status -- the repair is a policy edit, not a disable'
);

SELECT ok(
  (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig IS NOT NULL
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_pm_caller_guild_codes'),
  'C6: _pm_caller_guild_codes() is SECURITY DEFINER, STABLE and search_path-pinned'
);

SELECT ok(
  has_function_privilege('authenticated', 'public._pm_caller_guild_codes()'::regprocedure, 'EXECUTE'),
  'C7: authenticated may execute the helper the policy now depends on'
);

-- The provenance trigger requires the attestation before the binding.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000721'),   -- the member
  ('00000000-0000-0000-0000-000000000722');   -- the stranger

INSERT INTO public.guild_config (guild_code, display_name) VALUES
  ('TP721TAP', 'Test pgTAP guild'),
  ('TP721OTH', 'Test other guild');

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, is_current, is_active
)
SELECT GREATEST(
         coalesce((SELECT max(id) FROM public.player_mapping), 0),
         coalesce(pg_sequence_last_value('public.player_mapping_id_seq'::regclass), 0)
       ) + 721,
       'TP721P1', 'Test member', 'TP721TAP', true, true;

INSERT INTO public.player_identity_attestations (
  mapping_id, player_id, subject_user_id, consumed_at, source
)
SELECT pm.id, pm.player_id, '00000000-0000-0000-0000-000000000721'::uuid,
       now(), 'operator_quarantine_restore'
FROM public.player_mapping AS pm
WHERE pm.player_id = 'TP721P1';

UPDATE public.player_mapping AS pm
   SET user_id = a.subject_user_id, ownership_attestation_id = a.id
  FROM public.player_identity_attestations AS a
 WHERE a.mapping_id = pm.id AND pm.player_id = 'TP721P1';

INSERT INTO public.guild_sync_status (guild_code, status) VALUES
  ('TP721TAP', 'pending'),
  ('TP721OTH', 'pending');

SELECT is(
  (SELECT pm.user_id FROM public.player_mapping AS pm
    WHERE pm.player_id = 'TP721P1'),
  '00000000-0000-0000-0000-000000000721'::uuid,
  'D1: fixture -- the member''s mapping really is bound to the subject'
);

CREATE FUNCTION pg_temp._tp721_probe(p_subject uuid, p_key text)
RETURNS void LANGUAGE plpgsql AS $probe$
DECLARE
  v_rows  bigint;
  v_guild text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_subject::text, true);
  PERFORM set_config('tp721.' || p_key || '.sqlstate', 'none', true);
  PERFORM set_config('tp721.' || p_key || '.message', '', true);
  PERFORM set_config('tp721.' || p_key || '.rows', 'unset', true);
  PERFORM set_config('tp721.' || p_key || '.guild', 'unset', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    SELECT count(*) INTO v_rows FROM public.guild_sync_status;
    PERFORM set_config('tp721.' || p_key || '.rows', v_rows::text, true);
    SELECT string_agg(g.guild_code, ',' ORDER BY g.guild_code) INTO v_guild
    FROM public.guild_sync_status AS g;
    PERFORM set_config('tp721.' || p_key || '.guild',
                       coalesce(v_guild, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('tp721.' || p_key || '.sqlstate', SQLSTATE, true);
    PERFORM set_config('tp721.' || p_key || '.message', SQLERRM, true);
  END;
  EXECUTE 'RESET ROLE';
END;
$probe$;

SELECT lives_ok(
  $$SELECT pg_temp._tp721_probe('00000000-0000-0000-0000-000000000721'::uuid, 'member')$$,
  'E1: the member probe itself completes (the probe traps the statement''s own error, so this only proves the harness ran)'
);

SELECT is(
  current_setting('tp721.member.sqlstate', true),
  'none'::text,
  'E2: a current member SELECTing guild_sync_status raises no error -- observed sqlstate '
    || coalesce(current_setting('tp721.member.sqlstate', true), '?') || ' '
    || coalesce(current_setting('tp721.member.message', true), '')
);

SELECT is(
  current_setting('tp721.member.rows', true),
  '1'::text,
  'E3: the member sees exactly one guild_sync_status row -- completion did not become a leak of both guilds'
);

SELECT is(
  current_setting('tp721.member.guild', true),
  'TP721TAP'::text,
  'E4: and the row they see is their OWN guild''s, not the other guild''s'
);

SELECT lives_ok(
  $$SELECT pg_temp._tp721_probe('00000000-0000-0000-0000-000000000722'::uuid, 'stranger')$$,
  'E5: the stranger probe completes'
);

SELECT ok(
  current_setting('tp721.stranger.sqlstate', true) = 'none'
  AND current_setting('tp721.stranger.rows', true) = '0',
  'E6: an authenticated caller who belongs to no guild is not refused, and sees zero rows -- the repair is a gate, not an opening'
);

SELECT * FROM finish();
ROLLBACK;

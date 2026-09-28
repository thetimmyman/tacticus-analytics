-- get_invite_code_info is anon-reachable, so missing, used, revoked and expired codes return one
-- identical shape (only `valid`, `error`) and never confirm a guessed code is real.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(14);

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = 'public.get_invite_code_info(text)'::regprocedure),
  'get_invite_code_info is still SECURITY DEFINER'
);

SELECT ok(
  (SELECT p.proconfig FROM pg_proc p
    WHERE p.oid = 'public.get_invite_code_info(text)'::regprocedure) IS NOT NULL,
  'get_invite_code_info still pins search_path'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_invite_code_info(text)'::regprocedure, 'EXECUTE'),
  'anon KEEPS EXECUTE -- the pre-login onboarding claim page calls this before auth exists'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_invite_code_info(text)'::regprocedure, 'EXECUTE'),
  'authenticated keeps EXECUTE (unchanged)'
);

SELECT ok(
  has_function_privilege('service_role', 'public.get_invite_code_info(text)'::regprocedure, 'EXECUTE'),
  'service_role keeps EXECUTE (unchanged)'
);

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('TP377G', 'Test Guild');

INSERT INTO public.player_invite_codes
  (code, player_id, display_name, guild_code, expires_at, used_at, revoked_at)
VALUES
  ('AAAAAAAAAAAA', 'tp377-player-live',    'Live Player',    'TP377G', now() + interval '1 day', NULL,      NULL),
  ('BBBBBBBBBBBB', 'tp377-player-used',    'Used Player',    'TP377G', now() + interval '1 day', now(),     NULL),
  ('CCCCCCCCCCCC', 'tp377-player-revoked', 'Revoked Player', 'TP377G', now() + interval '1 day', NULL,      now()),
  ('DDDDDDDDDDDD', 'tp377-player-expired', 'Expired Player', 'TP377G', now() - interval '1 day', NULL,      NULL);

SELECT is(
  public.get_invite_code_info('ZZZZZZZZZZZZ'),
  '{"valid": false, "error": "Invalid or expired invite code."}'::jsonb,
  'missing code: generic invalid shape'
);

SELECT is(
  public.get_invite_code_info('BBBBBBBBBBBB'),
  public.get_invite_code_info('ZZZZZZZZZZZZ'),
  'used code answers IDENTICALLY to a code that never existed'
);

SELECT is(
  public.get_invite_code_info('CCCCCCCCCCCC'),
  public.get_invite_code_info('ZZZZZZZZZZZZ'),
  'revoked code answers IDENTICALLY to a code that never existed'
);

SELECT is(
  public.get_invite_code_info('DDDDDDDDDDDD'),
  public.get_invite_code_info('ZZZZZZZZZZZZ'),
  'expired code answers IDENTICALLY to a code that never existed'
);

SELECT is(
  (SELECT count(*)::integer FROM jsonb_object_keys(public.get_invite_code_info('BBBBBBBBBBBB'))),
  2,
  'the invalid shape carries ONLY valid+error -- no guild/expiry metadata leaks on a spent code'
);

-- The valid branch keeps the metadata ClientPage.tsx needs.
SELECT is(
  public.get_invite_code_info('AAAAAAAAAAAA') ->> 'valid',
  'true',
  'a live code still validates'
);

SELECT is(
  public.get_invite_code_info('AAAAAAAAAAAA') ->> 'display_name',
  'Live Player',
  'a live code still exposes display_name (the claim page needs it)'
);

SELECT is(
  public.get_invite_code_info('AAAAAAAAAAAA') ->> 'guild_name',
  'Test Guild',
  'a live code still exposes guild_name (the claim page needs it)'
);

SELECT is(
  (SELECT count(*)::integer FROM jsonb_object_keys(public.get_invite_code_info('AAAAAAAAAAAA'))),
  6,
  'the valid shape keeps all six keys (valid, player_id, display_name, guild_code, guild_name, expires_at)'
);

SELECT * FROM finish();
ROLLBACK;

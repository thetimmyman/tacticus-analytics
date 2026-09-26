BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- The production-baseline lane stays pre-cutover until the migration applies, so the final
-- compatibility assertions keep pre-cutover behaviour there.

SELECT plan(22);

INSERT INTO public.guild_config (
  id, guild_code, display_name, created_at, enabled
)
VALUES (313801, 'W318A', 'WI3138 Guild', now(), true);

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000313801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'claimant@example.test'),
  ('00000000-0000-0000-0000-000000313802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'victim@example.test'),
  ('00000000-0000-0000-0000-000000313803', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'service-target@example.test'),
  ('00000000-0000-0000-0000-000000313804', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'missing-target@example.test');

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, user_id, role, is_current,
  is_active, created_at, updated_at
)
VALUES
  (313801, 'wi3138-player-a', 'Invite A', 'W318A', NULL,
   'member'::public.app_role, true, true, now(), now()),
  (313802, 'wi3138-player-b', 'Invite B', 'W318A', NULL,
   'member'::public.app_role, true, true, now(), now());

INSERT INTO public.player_invite_codes (
  id, code, player_id, display_name, guild_code, created_by, created_at,
  expires_at
)
VALUES
  ('00000000-0000-0000-0000-0000003138a1', 'WI38A001',
   'wi3138-player-a', 'Invite A', 'W318A',
   '00000000-0000-0000-0000-000000313801', now(), now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000003138b1', 'WI38B001',
   'wi3138-player-b', 'Invite B', 'W318A',
   '00000000-0000-0000-0000-000000313801', now(), now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000003138c1', 'WI38C001',
   'wi3138-missing-player', 'Missing', 'W318A',
   '00000000-0000-0000-0000-000000313801', now(), now() + interval '1 day');

SELECT is(
  has_function_privilege('anon', 'public.validate_and_use_invite_code(text,uuid)', 'EXECUTE'),
  false,
  'anon cannot execute invite claims'
);
SELECT is(
  has_function_privilege('authenticated', 'public.validate_and_use_invite_code(text,uuid)', 'EXECUTE'),
  true,
  'authenticated retains invite-claim execution'
);
SELECT is(
  has_function_privilege('service_role', 'public.validate_and_use_invite_code(text,uuid)', 'EXECUTE'),
  to_regclass('public.player_identity_attestations') IS NULL,
  'service-role invite execution matches the measured cutover state'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT public.validate_and_use_invite_code('WI38A001', '00000000-0000-0000-0000-000000313801') $$,
  '42501',
  'permission denied for function validate_and_use_invite_code',
  'anonymous direct invocation is denied by ACL'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  $$ SELECT public.validate_and_use_invite_code('WI38A001', '00000000-0000-0000-0000-000000313801') $$,
  '42501',
  'Authentication required to claim an invite code',
  'authenticated database role without auth.uid cannot claim an invite'
);
RESET ROLE;

SELECT is(
  (SELECT used_at IS NULL FROM public.player_invite_codes WHERE code = 'WI38A001'),
  true,
  'missing-auth.uid rejection does not consume the invite'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313801', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  $$ SELECT public.validate_and_use_invite_code('WI38A001', '00000000-0000-0000-0000-000000313802') $$,
  '42501',
  'Invite claims may only target the authenticated user',
  'authenticated caller cannot substitute another user ID'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313801', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT throws_ok(
  $$ SELECT public.validate_and_use_invite_code('WI38A001', '00000000-0000-0000-0000-000000313802') $$,
  '42501',
  'Invite claims may only target the authenticated user',
  'spoofed service-role claim cannot elevate the authenticated database role'
);
RESET ROLE;

SELECT is(
  (SELECT used_at IS NULL FROM public.player_invite_codes WHERE code = 'WI38A001'),
  true,
  'spoofed service-role claim does not consume the invite'
);

SELECT is(
  (SELECT used_at IS NULL FROM public.player_invite_codes WHERE code = 'WI38A001'),
  true,
  'mismatched claim does not consume the invite'
);
SELECT is(
  (SELECT user_id IS NULL FROM public.player_mapping WHERE player_id = 'wi3138-player-a'),
  true,
  'mismatched claim does not bind the player mapping'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313801', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (public.validate_and_use_invite_code(
    'WI38A001',
    '00000000-0000-0000-0000-000000313801'
  ) ->> 'success'),
  'true',
  'matching authenticated caller claims the invite'
);
SELECT is(
  (SELECT user_id::text FROM public.player_mapping WHERE player_id = 'wi3138-player-a'),
  '00000000-0000-0000-0000-000000313801',
  'successful claim binds the mapping to auth.uid'
);
-- RESET ROLE: production RLS hides the stored row from a plain member, which a permissive
-- replay would not show. Assertion 13 stays in-role (users_manage_own_record exposes the own row).
RESET ROLE;
SELECT is(
  (SELECT used_by::text FROM public.player_invite_codes WHERE code = 'WI38A001'),
  '00000000-0000-0000-0000-000000313801',
  'successful claim records auth.uid as invite consumer'
);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.validate_and_use_invite_code(
    'WI38A001',
    '00000000-0000-0000-0000-000000313801'
  ) ->> 'error_code'),
  'INVALID_CODE',
  'consumed invite cannot be replayed'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT CASE
  WHEN to_regclass('public.player_identity_attestations') IS NULL THEN
    throws_ok(
      $$ SELECT public.validate_and_use_invite_code('WI38B001', NULL) $$,
      '22004',
      'Invite claim target user is required',
      'pre-cutover service claims still reject a null target'
    )
  ELSE
    throws_ok(
      $$ SELECT public.validate_and_use_invite_code('WI38B001', NULL) $$,
      '42501',
      'permission denied for function validate_and_use_invite_code',
      'post-cutover service role cannot invoke the invite claim function'
    )
END;
RESET ROLE;
SELECT is(
  (SELECT used_at IS NULL FROM public.player_invite_codes WHERE code = 'WI38B001'),
  true,
  'rejected service claim does not consume the invite'
);
SELECT is(
  (SELECT user_id IS NULL FROM public.player_mapping WHERE player_id = 'wi3138-player-b'),
  true,
  'rejected service claim leaves the mapping unclaimed'
);

SET LOCAL ROLE service_role;
SELECT CASE
  WHEN to_regclass('public.player_identity_attestations') IS NULL THEN
    lives_ok(
      $$ SELECT public.validate_and_use_invite_code(
           'WI38B001', '00000000-0000-0000-0000-000000313803'
         ) $$,
      'pre-cutover baseline retains the measured service on-behalf-of behavior'
    )
  ELSE
    throws_ok(
      $$ SELECT public.validate_and_use_invite_code('WI38B001', '00000000-0000-0000-0000-000000313803') $$,
      '42501',
      'permission denied for function validate_and_use_invite_code',
      'post-cutover service role cannot claim on behalf of another user'
    )
END;
RESET ROLE;

SELECT is(
  (SELECT used_at IS NULL FROM public.player_invite_codes WHERE code = 'WI38B001'),
  to_regclass('public.player_identity_attestations') IS NOT NULL,
  'invite consumption state matches the measured cutover behavior'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000313803', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(
  (public.validate_and_use_invite_code(
    'WI38B001',
    '00000000-0000-0000-0000-000000313803'
  ) ->> 'success'),
  CASE WHEN to_regclass('public.player_identity_attestations') IS NULL
    THEN 'false' ELSE 'true' END,
  'actual authenticated target behavior matches the cutover state'
);
RESET ROLE;

SELECT is(
  (SELECT user_id::text FROM public.player_mapping
   WHERE player_id = 'wi3138-player-b'),
  '00000000-0000-0000-0000-000000313803',
  'the successful claim binds the intended target in either cutover state'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT finish();
ROLLBACK;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(9);

SELECT has_function(
  'public', 'record_player_api_key_auth_failure',
  ARRAY['text', 'integer', 'integer', 'integer'],
  'the key strike counter exists on a database built from migrations'
);

SELECT ok(
  has_function_privilege('service_role',
    'public.record_player_api_key_auth_failure(text, integer, integer, integer)', 'EXECUTE'),
  'service_role may record strikes'
);
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.record_player_api_key_auth_failure(text, integer, integer, integer)', 'EXECUTE'),
  'authenticated may not record strikes'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'public.record_player_api_key_auth_failure(text, integer, integer, integer)', 'EXECUTE'),
  'anon may not record strikes'
);

INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES (930801, 'TWSTRK', 'Strike Guild', now(), true);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role, is_current, api_key_is_valid,
  created_at, updated_at
)
VALUES (930801, 'tw-strike-player', 'Strike Player', 'TWSTRK',
        'member'::public.app_role, true, true, now(), now());

-- Cooldown 0 so three calls in one transaction each count.
SELECT is(
  (SELECT strikes FROM public.record_player_api_key_auth_failure('tw-strike-player', 0, 86400, 3)),
  1, 'the first rejection is strike 1'
);
SELECT is(
  (SELECT row(strikes, flagged)::text FROM public.record_player_api_key_auth_failure('tw-strike-player', 0, 86400, 3)),
  '(2,f)', 'strike 2 does not flag the key'
);
SELECT is(
  (SELECT row(strikes, flagged)::text FROM public.record_player_api_key_auth_failure('tw-strike-player', 0, 86400, 3)),
  '(3,t)', 'strike 3 reaches the threshold and flags the key'
);
SELECT is(
  (SELECT api_key_is_valid FROM public.player_mapping WHERE id = 930801),
  false, 'a flagged key is marked invalid'
);
SELECT is(
  (SELECT row(strikes, counted)::text FROM public.record_player_api_key_auth_failure('tw-strike-player', 600, 86400, 3)),
  '(3,f)', 'a rejection inside the cooldown is not counted'
);

SELECT * FROM finish();
ROLLBACK;

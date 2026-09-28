BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(5);

SELECT has_function(
  'public',
  'find_token_accrual_violations',
  ARRAY['text'],
  'find_token_accrual_violations exposes the accrual-invariant surface'
);

-- First battle 30h ago -> bound = 3 + 2 = 5.
INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, is_current,
  tacticus_api_key_encrypted, api_key_is_valid,
  last_sync_tokens, next_token_seconds, last_sync_at, last_sync_bombs, next_bomb_seconds
) VALUES
  (926200, 'tw2620-clean', 'TW2620 Clean', 'TW2620', true,
   null, null, null, null, null, null, null),
  -- All battles precede the snapshot so spend-invalidation cannot fire: 7 accrued > bound 5.
  (926201, 'tw2620-violator', 'TW2620 Violator', 'TW2620', true,
   'enc-test-key', true, 3, null, (now() - interval '1 hours')::timestamp, 1, null);

INSERT INTO public."EOT_GR_data"
  ("userId", "displayName", "Guild", "Season", "encounterId", "damageType", "damageDealt", "startedOn")
VALUES
  ('tw2620-clean', 'TW2620 Clean', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '30 hours')),
  ('tw2620-clean', 'TW2620 Clean', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '20 hours')),
  ('tw2620-clean', 'TW2620 Clean', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '10 hours')),
  ('tw2620-violator', 'TW2620 Violator', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '28 hours')),
  ('tw2620-violator', 'TW2620 Violator', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '22 hours')),
  ('tw2620-violator', 'TW2620 Violator', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '16 hours')),
  ('tw2620-violator', 'TW2620 Violator', 'TW2620', '92620', 0, 'Battle', 100, (now() - interval '6 hours'));

-- Only pgtap plumbing is granted; product data stays behind the DEFINER wrapper.
GRANT USAGE ON SCHEMA public, extensions TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO service_role;
SET LOCAL ROLE service_role;

SELECT is(
  (SELECT count(*)::int FROM public.find_token_accrual_violations('TW2620')),
  1,
  'exactly one member violates the accrual bound'
);

SELECT is(
  (SELECT v.player_id FROM public.find_token_accrual_violations('TW2620') v),
  'tw2620-violator',
  'the violator is the member whose snapshot claims impossible accrual'
);

SELECT is(
  (SELECT v.excess FROM public.find_token_accrual_violations('TW2620') v),
  2,
  'excess = (4 used + 3 available) - (3 + 2 regens over 30h) = 2'
);

SELECT is(
  (SELECT v.max_accruable FROM public.find_token_accrual_violations('TW2620') v),
  5,
  'bound = 3 starting tokens + floor(30h / 12h) regens'
);

RESET ROLE;
SELECT finish();
ROLLBACK;

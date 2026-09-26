BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- Mirrors tests/unit/calculations/token-availability-parity-fixtures.test.ts.

SELECT plan(23);

SELECT has_function(
  'public',
  'calculate_player_tokens_by_user',
  ARRAY['text', 'text', 'text'],
  'calculate_player_tokens_by_user exposes the userId-keyed replay'
);

INSERT INTO public."EOT_GR_data"
  ("userId", "displayName", "Guild", "Season", "encounterId", "damageType", "damageDealt", "startedOn")
VALUES
  -- A: spend-to-zero keeps the regen anchor
  ('wi2620-parity-a', 'Parity A', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '20 hours')),
  ('wi2620-parity-a', 'Parity A', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '14 hours')),
  -- B: recent spend-to-zero
  ('wi2620-parity-b', 'Parity B', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '8 hours')),
  ('wi2620-parity-b', 'Parity B', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '2 hours')),
  -- C: interleaved spends and pops
  ('wi2620-parity-c', 'Parity C', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '30 hours')),
  ('wi2620-parity-c', 'Parity C', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '20 hours')),
  ('wi2620-parity-c', 'Parity C', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '10 hours')),
  -- D: idle regen reaches the cap and pauses
  ('wi2620-parity-d', 'Parity D', 'WI2620P', '92620', 0, 'Battle', 1, (now() - interval '40 hours'));

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2620-parity-a', 'WI2620P', '92620') c),
  1,
  'A: spend-to-zero replay availability (1)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2620-parity-a', 'WI2620P', '92620') c),
  14400,
  'A: countdown measured from the -20h anchor, not the -14h spend'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2620-parity-b', 'WI2620P', '92620') c),
  0,
  'B: recent spend-to-zero availability (0)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2620-parity-b', 'WI2620P', '92620') c),
  14400,
  'B: countdown measured from the -8h anchor'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2620-parity-c', 'WI2620P', '92620') c),
  1,
  'C: interleaved spends and pops availability (1)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2620-parity-c', 'WI2620P', '92620') c),
  21600,
  'C: countdown preserves regen continuity across two zero-spends'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2620-parity-d', 'WI2620P', '92620') c),
  3,
  'D: idle regen reaches the cap'
);

SELECT is(
  (SELECT c.time_until_next_token FROM public.calculate_player_tokens_by_user('wi2620-parity-d', 'WI2620P', '92620') c),
  null::interval,
  'D: at cap there is no countdown (regen paused)'
);

-- Season-start anchors (TS cases E-I); A-D have none and pin the first-battle fallback.

INSERT INTO public.season_calendar (season_id, starts_at, ends_at)
VALUES
  (92630, now() - interval '30 hours', now() + interval '10 days'),
  (92640, now() - interval '10 hours', now() + interval '10 days'),
  (92650, now() - interval '10 hours', now() + interval '10 days'),
  (92660, now() - interval '26 hours', now() + interval '10 days'),
  (92670, now() - interval '60 hours', now() + interval '10 days'),
  -- J/K: the function must refuse to anchor on a future-dated calendar row.
  (92680, now() + interval '10 hours', now() + interval '10 days');

INSERT INTO public."EOT_GR_data"
  ("userId", "displayName", "Guild", "Season", "encounterId", "damageType", "damageDealt", "startedOn")
VALUES
  -- E: pre-first-battle regen caps before the spend (anchor -30h, battle -4h)
  ('wi2640-anchor-e', 'Anchor E', 'WI2620P', '92631', 0, 'Battle', 1, (now() - interval '4 hours')),
  -- F: anchored regen phase survives a below-cap spend (anchor -10h, battle -4h)
  ('wi2640-anchor-f', 'Anchor F', 'WI2620P', '92641', 0, 'Battle', 1, (now() - interval '4 hours')),
  -- G: battle predating the anchor degrades to first-battle anchor (anchor -10h, battle -20h)
  ('wi2640-anchor-g', 'Anchor G', 'WI2620P', '92651', 0, 'Battle', 1, (now() - interval '20 hours')),
  -- I: spend-to-zero then long idle regen across a gap (anchor -60h)
  ('wi2640-anchor-i', 'Anchor I', 'WI2620P', '92671', 0, 'Battle', 1, (now() - interval '55 hours')),
  ('wi2640-anchor-i', 'Anchor I', 'WI2620P', '92671', 0, 'Battle', 1, (now() - interval '50 hours')),
  ('wi2640-anchor-i', 'Anchor I', 'WI2620P', '92671', 0, 'Battle', 1, (now() - interval '3 hours')),
  -- J: future anchor with a battle -20h.
  ('wi2640-anchor-j', 'Anchor J', 'WI2620P', '92681', 0, 'Battle', 1, (now() - interval '20 hours'));

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-e', 'WI2620P', '92631') c),
  2,
  'E: pre-first-battle regen caps before the spend (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2640-anchor-e', 'WI2620P', '92631') c),
  28800,
  'E: countdown runs from the cap-spend, not the anchor'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-f', 'WI2620P', '92641') c),
  1,
  'F: anchored below-cap spend availability (1)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2640-anchor-f', 'WI2620P', '92641') c),
  7200,
  'F: countdown keeps the anchor regen phase'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-g', 'WI2620P', '92651') c),
  2,
  'G: battle predating the anchor degrades to first-battle anchor (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2640-anchor-g', 'WI2620P', '92651') c),
  14400,
  'G: degraded anchor countdown matches the legacy shape'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-h', 'WI2620P', '92661') c),
  3,
  'H: no battles regen from the anchor to the cap'
);

SELECT is(
  (SELECT c.time_until_next_token FROM public.calculate_player_tokens_by_user('wi2640-anchor-h', 'WI2620P', '92661') c),
  null::interval,
  'H: capped no-battle player has no countdown'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-i', 'WI2620P', '92671') c),
  2,
  'I: spend-to-zero then idle regen across a gap (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2640-anchor-i', 'WI2620P', '92671') c),
  32400,
  'I: countdown rebased at the cap-spend after the gap'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-j', 'WI2620P', '92681') c),
  2,
  'J: future anchor with battles degrades to the first-battle anchor (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('wi2640-anchor-j', 'WI2620P', '92681') c),
  14400,
  'J: degraded future-anchor countdown matches the legacy shape'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('wi2640-anchor-k', 'WI2620P', '92681') c),
  2,
  'K: future anchor with no battles yields the frozen initial state (2)'
);

SELECT is(
  (SELECT c.time_until_next_token FROM public.calculate_player_tokens_by_user('wi2640-anchor-k', 'WI2620P', '92681') c),
  null::interval,
  'K: future anchor with no battles has no countdown'
);

SELECT finish();
ROLLBACK;

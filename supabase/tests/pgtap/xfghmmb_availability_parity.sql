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
  ('xfghmmb-parity-a', 'Parity A', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '20 hours')),
  ('xfghmmb-parity-a', 'Parity A', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '14 hours')),
  -- B: recent spend-to-zero
  ('xfghmmb-parity-b', 'Parity B', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '8 hours')),
  ('xfghmmb-parity-b', 'Parity B', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '2 hours')),
  -- C: interleaved spends and pops
  ('xfghmmb-parity-c', 'Parity C', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '30 hours')),
  ('xfghmmb-parity-c', 'Parity C', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '20 hours')),
  ('xfghmmb-parity-c', 'Parity C', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '10 hours')),
  -- D: idle regen reaches the cap and pauses
  ('xfghmmb-parity-d', 'Parity D', 'xfghmmbP', '92620', 0, 'Battle', 1, (now() - interval '40 hours'));

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xfghmmb-parity-a', 'xfghmmbP', '92620') c),
  1,
  'A: spend-to-zero replay availability (1)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xfghmmb-parity-a', 'xfghmmbP', '92620') c),
  14400,
  'A: countdown measured from the -20h anchor, not the -14h spend'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xfghmmb-parity-b', 'xfghmmbP', '92620') c),
  0,
  'B: recent spend-to-zero availability (0)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xfghmmb-parity-b', 'xfghmmbP', '92620') c),
  14400,
  'B: countdown measured from the -8h anchor'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xfghmmb-parity-c', 'xfghmmbP', '92620') c),
  1,
  'C: interleaved spends and pops availability (1)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xfghmmb-parity-c', 'xfghmmbP', '92620') c),
  21600,
  'C: countdown preserves regen continuity across two zero-spends'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xfghmmb-parity-d', 'xfghmmbP', '92620') c),
  3,
  'D: idle regen reaches the cap'
);

SELECT is(
  (SELECT c.time_until_next_token FROM public.calculate_player_tokens_by_user('xfghmmb-parity-d', 'xfghmmbP', '92620') c),
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
  ('xcoobna-anchor-e', 'Anchor E', 'xfghmmbP', '92631', 0, 'Battle', 1, (now() - interval '4 hours')),
  -- F: anchored regen phase survives a below-cap spend (anchor -10h, battle -4h)
  ('xcoobna-anchor-f', 'Anchor F', 'xfghmmbP', '92641', 0, 'Battle', 1, (now() - interval '4 hours')),
  -- G: battle predating the anchor degrades to first-battle anchor (anchor -10h, battle -20h)
  ('xcoobna-anchor-g', 'Anchor G', 'xfghmmbP', '92651', 0, 'Battle', 1, (now() - interval '20 hours')),
  -- I: spend-to-zero then long idle regen across a gap (anchor -60h)
  ('xcoobna-anchor-i', 'Anchor I', 'xfghmmbP', '92671', 0, 'Battle', 1, (now() - interval '55 hours')),
  ('xcoobna-anchor-i', 'Anchor I', 'xfghmmbP', '92671', 0, 'Battle', 1, (now() - interval '50 hours')),
  ('xcoobna-anchor-i', 'Anchor I', 'xfghmmbP', '92671', 0, 'Battle', 1, (now() - interval '3 hours')),
  -- J: future anchor with a battle -20h.
  ('xcoobna-anchor-j', 'Anchor J', 'xfghmmbP', '92681', 0, 'Battle', 1, (now() - interval '20 hours'));

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-e', 'xfghmmbP', '92631') c),
  2,
  'E: pre-first-battle regen caps before the spend (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xcoobna-anchor-e', 'xfghmmbP', '92631') c),
  28800,
  'E: countdown runs from the cap-spend, not the anchor'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-f', 'xfghmmbP', '92641') c),
  1,
  'F: anchored below-cap spend availability (1)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xcoobna-anchor-f', 'xfghmmbP', '92641') c),
  7200,
  'F: countdown keeps the anchor regen phase'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-g', 'xfghmmbP', '92651') c),
  2,
  'G: battle predating the anchor degrades to first-battle anchor (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xcoobna-anchor-g', 'xfghmmbP', '92651') c),
  14400,
  'G: degraded anchor countdown matches the legacy shape'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-h', 'xfghmmbP', '92661') c),
  3,
  'H: no battles regen from the anchor to the cap'
);

SELECT is(
  (SELECT c.time_until_next_token FROM public.calculate_player_tokens_by_user('xcoobna-anchor-h', 'xfghmmbP', '92661') c),
  null::interval,
  'H: capped no-battle player has no countdown'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-i', 'xfghmmbP', '92671') c),
  2,
  'I: spend-to-zero then idle regen across a gap (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xcoobna-anchor-i', 'xfghmmbP', '92671') c),
  32400,
  'I: countdown rebased at the cap-spend after the gap'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-j', 'xfghmmbP', '92681') c),
  2,
  'J: future anchor with battles degrades to the first-battle anchor (2)'
);

SELECT is(
  (SELECT extract(epoch from c.time_until_next_token)::int FROM public.calculate_player_tokens_by_user('xcoobna-anchor-j', 'xfghmmbP', '92681') c),
  14400,
  'J: degraded future-anchor countdown matches the legacy shape'
);

SELECT is(
  (SELECT c.tokens_available FROM public.calculate_player_tokens_by_user('xcoobna-anchor-k', 'xfghmmbP', '92681') c),
  2,
  'K: future anchor with no battles yields the frozen initial state (2)'
);

SELECT is(
  (SELECT c.time_until_next_token FROM public.calculate_player_tokens_by_user('xcoobna-anchor-k', 'xfghmmbP', '92681') c),
  null::interval,
  'K: future anchor with no battles has no countdown'
);

SELECT finish();
ROLLBACK;

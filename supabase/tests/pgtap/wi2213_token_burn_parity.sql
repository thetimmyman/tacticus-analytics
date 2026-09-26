BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(5);

SELECT has_function(
  'public',
  'compute_player_token_burn',
  ARRAY['text', 'text', 'text', 'timestamp with time zone'],
  'compute_player_token_burn exposes the token-burn parity surface'
);

INSERT INTO public.season_calendar (
  season_id,
  season_label,
  starts_at,
  ends_at,
  tokens_per_player_cap,
  regen_interval_hours,
  regen_tokens_per_interval,
  notes
)
VALUES (
  92213,
  'WI-2213 parity fixture',
  '2026-01-01T00:00:00Z',
  '2026-01-14T00:00:00Z',
  28,
  12,
  1,
  'Deterministic no-battle token burn fixture.'
);

-- Mirrors token-sql-parity-fixtures.test.ts: 72h idle refills one cycle to cap and burns five.
SELECT is(
  (
    SELECT burned_tokens
    FROM public.compute_player_token_burn(
      'WI2213',
      '92213',
      'wi2213-idler',
      '2026-01-04T00:00:00Z'
    )
  ),
  5,
  'no-battle season-start burn count matches the TS golden fixture'
);

SELECT is(
  (
    SELECT time_over_cap_seconds
    FROM public.compute_player_token_burn(
      'WI2213',
      '92213',
      'wi2213-idler',
      '2026-01-04T00:00:00Z'
    )
  ),
  216000,
  'no-battle season-start over-cap seconds start after the first refill cycle'
);

SELECT is(
  (
    SELECT burned_tokens
    FROM public.compute_player_token_burn(
      'WI2213',
      '92213',
      'wi2213-idler',
      '2026-01-20T00:00:00Z'
    )
  ),
  25,
  'closed seasons clamp burn count at season end'
);

SELECT is(
  (
    SELECT time_over_cap_seconds
    FROM public.compute_player_token_burn(
      'WI2213',
      '92213',
      'wi2213-idler',
      '2026-01-20T00:00:00Z'
    )
  ),
  1080000,
  'closed seasons clamp over-cap seconds at season end'
);

SELECT finish();
ROLLBACK;

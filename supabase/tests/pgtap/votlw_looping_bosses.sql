-- Only bosses the season loops are awarded; the restart is derived from play records at
-- loopIndex >= 1, since SQL cannot read the TS season overlay.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

BEGIN;
SELECT plan(6);

-- Three players x two battles per boss clears the medal gate.
CREATE OR REPLACE FUNCTION pg_temp.seed_season(p_guild text, p_loop_from int)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public."EOT_GR_data"
    ("Guild", "Season", "displayName", "userId", "Name", "damageType", "damageDealt",
     tier, "set", "encounterId", "encounterIndex", "loopIndex", rarity,
     "maxHp", "remainingHp", "startedOn", "completedOn")
  -- Values vary by loop: prod's unique index on the battle row excludes loopIndex, so identical
  -- values across loops violate it.
  SELECT
    p_guild, '999', p.name, lower(p.name),
    ladder.rar || 'Boss' || ladder.setnum, 'Battle',
    1000000 + p.bump + b.n + loops.idx * 7,
    CASE ladder.rar WHEN 'Legendary' THEN 4 ELSE 5 END,
    ladder.setnum, 0, 0, loops.idx, ladder.rar,
    20000000, 5000000,
    '2026-08-11T10:00:00Z'::timestamptz
      + ((b.n + loops.idx * 10 + ladder.pos * 100) || ' minutes')::interval,
    '2026-08-11T10:00:30Z'::timestamptz
      + ((b.n + loops.idx * 10 + ladder.pos * 100) || ' minutes')::interval
  FROM (VALUES
    ('Legendary', 0, 0), ('Legendary', 1, 1), ('Legendary', 2, 2),
    ('Legendary', 3, 3), ('Legendary', 4, 4),
    ('Mythic', 0, 5), ('Mythic', 1, 6), ('Mythic', 2, 7)
  ) AS ladder(rar, setnum, pos)
  CROSS JOIN (VALUES ('PlayerA', 0), ('PlayerB', 100000), ('PlayerC', 200000)) AS p(name, bump)
  CROSS JOIN (VALUES (1), (2)) AS b(n)
  CROSS JOIN LATERAL (
    SELECT generate_series(0, CASE WHEN ladder.pos < p_loop_from THEN 0 ELSE 1 END)
  ) AS loops(idx);
$$;

SELECT pg_temp.seed_season('LOOPS-FROM-L4', 3);   -- S107 shape
SELECT pg_temp.seed_season('LOOPS-FROM-L1', 0);   -- S106 and earlier
SELECT pg_temp.seed_season('LOOPS-FROM-M1', 5);   -- the loopFromTier 5 era
SELECT pg_temp.seed_season('NEVER-LOOPED', 99);   -- no loopIndex >= 1 row anywhere

CREATE OR REPLACE FUNCTION pg_temp.levels(p_guild text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(e ->> 'levelString' ORDER BY e ->> 'levelString'), '[]'::jsonb)
  FROM jsonb_array_elements(get_votlw_set_winners(p_guild, '999', NULL)) e;
$$;

SELECT is(
  pg_temp.levels('LOOPS-FROM-L4'),
  '["L4", "L5", "M1", "M2", "M3"]'::jsonb,
  'a season looping from L4 awards only L4-M3'
);

SELECT is(
  pg_temp.levels('LOOPS-FROM-L4') @> '["L1"]'::jsonb,
  false,
  'the single-pass sets emit no row at all — not an empty one'
);

SELECT is(
  pg_temp.levels('LOOPS-FROM-L1'),
  '["L1", "L2", "L3", "L4", "L5", "M1", "M2", "M3"]'::jsonb,
  'a season looping the full ladder still awards every set (history is not rewritten)'
);

SELECT is(
  pg_temp.levels('LOOPS-FROM-M1'),
  '["M1", "M2", "M3"]'::jsonb,
  'the rule follows the config rather than hardcoding L4'
);

SELECT is(
  pg_temp.levels('NEVER-LOOPED'),
  '["L1", "L2", "L3", "L4", "L5", "M1", "M2", "M3"]'::jsonb,
  'a guild that never reached loop 1 has nothing excluded'
);

-- Non-vacuity: the seed produced the loop-1 evidence the rule reads.
SELECT is(
  (SELECT count(*) FROM public."EOT_GR_data"
    WHERE "Guild" = 'LOOPS-FROM-L4' AND "loopIndex" >= 1),
  30::bigint,
  'seed control: the looping half of the ladder carries loop-1 rows'
);

SELECT * FROM finish();
ROLLBACK;

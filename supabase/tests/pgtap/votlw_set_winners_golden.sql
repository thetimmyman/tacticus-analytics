-- Golden-fixture parity test for the canonical award RPC public.get_votlw_set_winners.
-- Mirrors tests/fixtures/votlw-golden-season.json (asserted client-side by
-- tests/unit/calculations/votlw-golden-fixture.test.ts); edit both together so CI
-- catches either runtime drifting. Scenario notes live in the fixture JSON.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

BEGIN;
SELECT plan(26);

INSERT INTO public."EOT_GR_data"
  ("Guild", "Season", "displayName", "userId", "Name", "damageType", "damageDealt", tier,
   "set", "encounterId", "encounterIndex", "loopIndex", rarity,
   "maxHp", "remainingHp", "startedOn", "completedOn")
VALUES
  ('GOLDEN-FIXTURE', '999', 'SteadyGold', 'steadygold', 'GoldenDorn', 'Battle', 1050000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 550000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SteadyGold', 'steadygold', 'GoldenDorn', 'Battle', 1250000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 350000, '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepGated', 'sweepgated', 'GoldenDorn', 'Battle', 1700000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 300000, '2026-01-01T00:02:00.000Z', '2026-01-01T00:02:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepGated', 'sweepgated', 'GoldenDorn', 'Battle', 150000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 0, '2026-01-01T00:03:00.000Z', '2026-01-01T00:03:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'OneShotBronze', 'oneshotbronze', 'GoldenDorn', 'Battle', 950000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 1050000, '2026-01-01T00:04:00.000Z', '2026-01-01T00:04:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'OneShotBronze', 'oneshotbronze', 'GoldenDorn', 'Battle', 750000, 5, 0, 0, 0, 0, 'Legendary', 700000, 0, '2026-01-01T00:05:00.000Z', '2026-01-01T00:05:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepLifted', 'sweeplifted', 'GoldenDorn', 'Battle', 450000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 1550000, '2026-01-01T00:06:00.000Z', '2026-01-01T00:06:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepLifted', 'sweeplifted', 'GoldenDorn', 'Battle', 650000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 1350000, '2026-01-01T00:07:00.000Z', '2026-01-01T00:07:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepLifted', 'sweeplifted', 'GoldenDorn', 'Battle', 1960000, 5, 0, 0, 0, 0, 'Legendary', 2000000, 0, '2026-01-01T00:08:00.000Z', '2026-01-01T00:08:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SideAvgWinner', 'sideavgwinner', 'GoldenSibyll', 'Battle', 1030000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 250000, '2026-01-01T00:10:00.000Z', '2026-01-01T00:10:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SideAvgWinner', 'sideavgwinner', 'GoldenSibyll', 'Battle', 1150000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 100000, '2026-01-01T00:11:00.000Z', '2026-01-01T00:11:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SideAvgWinner', 'sideavgwinner', 'GoldenSibyll', 'Battle', 260000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 0, '2026-01-01T00:12:00.000Z', '2026-01-01T00:12:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'RawAvgLeader', 'rawavgleader', 'GoldenSibyll', 'Battle', 960000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 350000, '2026-01-01T00:13:00.000Z', '2026-01-01T00:13:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'RawAvgLeader', 'rawavgleader', 'GoldenSibyll', 'Battle', 1000000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 250000, '2026-01-01T00:14:00.000Z', '2026-01-01T00:14:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SingleBattleA', 'singlebattlea', 'GoldenSibyll', 'Battle', 970000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 400000, '2026-01-01T00:15:00.000Z', '2026-01-01T00:15:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SingleBattleB', 'singlebattleb', 'GoldenSibyll', 'Battle', 925000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 450000, '2026-01-01T00:16:00.000Z', '2026-01-01T00:16:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SingleBattleB', 'singlebattleb', 'GoldenSibyll', 'Battle', 120000, 5, 0, 1, 1, 0, 'Legendary', 1500000, 0, '2026-01-01T00:17:00.000Z', '2026-01-01T00:17:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SoloToken', 'solotoken', 'GoldenThad', 'Battle', 820000, 5, 0, 2, 2, 0, 'Legendary', 1500000, 680000, '2026-01-01T00:20:00.000Z', '2026-01-01T00:20:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepOnly', 'sweeponly', 'GoldenThad', 'Battle', 320000, 5, 0, 2, 2, 0, 'Legendary', 1500000, 0, '2026-01-01T00:21:00.000Z', '2026-01-01T00:21:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'SweepOnly', 'sweeponly', 'GoldenThad', 'Battle', 380000, 5, 0, 2, 2, 0, 'Legendary', 1500000, 0, '2026-01-01T00:22:00.000Z', '2026-01-01T00:22:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'MythicGold', 'mythicgold', 'GoldenMagnus', 'Battle', 1550000, 5, 0, 0, 0, 0, 'Mythic', 3000000, 1450000, '2026-01-01T00:30:00.000Z', '2026-01-01T00:30:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'MythicGold', 'mythicgold', 'GoldenMagnus', 'Battle', 1550000, 5, 0, 0, 0, 0, 'Mythic', 3000000, 1350000, '2026-01-01T00:31:00.000Z', '2026-01-01T00:31:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'MythicSilver', 'mythicsilver', 'GoldenMagnus', 'Battle', 1450000, 5, 0, 0, 0, 0, 'Mythic', 3000000, 1550000, '2026-01-01T00:32:00.000Z', '2026-01-01T00:32:30.000Z'),
  ('GOLDEN-FIXTURE', '999', 'MythicSilver', 'mythicsilver', 'GoldenMagnus', 'Battle', 1450000, 5, 0, 0, 0, 0, 'Mythic', 3000000, 1450000, '2026-01-01T00:33:00.000Z', '2026-01-01T00:33:30.000Z');

-- Index of each (rarity, set) within the RPC's ordered result array
CREATE TEMPORARY VIEW idx AS
  SELECT (elem ->> 'rarity') AS rarity, (elem ->> 'set')::int AS set_num, ord - 1 AS i
  FROM jsonb_array_elements(get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL)) WITH ORDINALITY AS t(elem, ord);

SELECT is(
  jsonb_array_length(get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL)),
  2,
  'result has one entry per qualified (rarity, set)'
);

SELECT is(
  get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL),
  '[{"rarity":"Legendary","set":0,"levelString":"L1","bossName":"GoldenDorn","gold":{"player":"SteadyGold","value":1150000},"silver":{"player":"SweepLifted","value":1020000},"bronze":{"player":"OneShotBronze","value":850000},"mostDamage":{"player":"SweepLifted","value":3060000},"sideBoss1":{"player":"SideAvgWinner","value":1090000},"sideBoss2":{},"biggestHit":{"player":"SweepLifted","value":1960000}},{"rarity":"Mythic","set":0,"levelString":"M1","bossName":"GoldenMagnus","gold":{"player":"MythicGold","value":1550000},"silver":{"player":"MythicSilver","value":1450000},"bronze":{},"mostDamage":{"player":"MythicGold","value":3100000},"sideBoss1":{},"sideBoss2":{},"biggestHit":{"player":"MythicGold","value":1550000}}]'::jsonb,
  'full golden document matches'
);

SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'gold' ->> 'player', 'SteadyGold', 'L1 gold player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'gold' ->> 'value', '1150000', 'L1 gold value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'silver' ->> 'player', 'SweepLifted', 'L1 silver player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'silver' ->> 'value', '1020000', 'L1 silver value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'bronze' ->> 'player', 'OneShotBronze', 'L1 bronze player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'bronze' ->> 'value', '850000', 'L1 bronze value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'mostDamage' ->> 'player', 'SweepLifted', 'L1 mostDamage player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'mostDamage' ->> 'value', '3060000', 'L1 mostDamage value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'sideBoss1' ->> 'player', 'SideAvgWinner', 'L1 sideBoss1 player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'sideBoss1' ->> 'value', '1090000', 'L1 sideBoss1 value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'sideBoss2', '{}'::jsonb, 'L1 sideBoss2 is empty (nobody qualified)');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'biggestHit' ->> 'player', 'SweepLifted', 'L1 biggestHit player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Legendary' AND set_num = 0)) -> 'biggestHit' ->> 'value', '1960000', 'L1 biggestHit value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'gold' ->> 'player', 'MythicGold', 'M1 gold player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'gold' ->> 'value', '1550000', 'M1 gold value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'silver' ->> 'player', 'MythicSilver', 'M1 silver player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'silver' ->> 'value', '1450000', 'M1 silver value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'bronze', '{}'::jsonb, 'M1 bronze is empty (nobody qualified)');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'mostDamage' ->> 'player', 'MythicGold', 'M1 mostDamage player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'mostDamage' ->> 'value', '3100000', 'M1 mostDamage value');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'sideBoss1', '{}'::jsonb, 'M1 sideBoss1 is empty (nobody qualified)');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'sideBoss2', '{}'::jsonb, 'M1 sideBoss2 is empty (nobody qualified)');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'biggestHit' ->> 'player', 'MythicGold', 'M1 biggestHit player');
SELECT is((get_votlw_set_winners('GOLDEN-FIXTURE', '999', NULL) -> (SELECT i::int FROM idx WHERE rarity = 'Mythic' AND set_num = 0)) -> 'biggestHit' ->> 'value', '1550000', 'M1 biggestHit value');

SELECT * FROM finish();
ROLLBACK;

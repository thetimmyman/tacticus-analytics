BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(9);

-- p_guild_code scopes every assertion, so pre-existing rows in this table cannot
-- change the result.
INSERT INTO "EOT_GR_data" ("Guild", "Name", rarity, "set", "encounterId", "damageType", "damageDealt", "remainingHp") VALUES
  ('pgtap-boss-hp-guild', 'TestBossAlpha', 'Legendary', 3, 1, 'Battle', 4000, 1000),
  ('pgtap-boss-hp-guild', 'TestBossAlpha', 'Legendary', 3, 1, 'Battle', 3500, 900),
  ('pgtap-boss-hp-guild', 'TestBossAlpha', 'Legendary', 3, 1, 'Battle', 5000, 800),
  -- Excluded: zero damage, wrong damageType, and a lower rarity.
  ('pgtap-boss-hp-guild', 'TestBossAlpha', 'Legendary', 3, 1, 'Battle', 0, 999999),
  ('pgtap-boss-hp-guild', 'TestBossAlpha', 'Legendary', 3, 1, 'Bomb', 4000, 999999),
  ('pgtap-boss-hp-guild', 'TestBossBeta', 'Rare', 3, 1, 'Battle', 4000, 999999),
  -- A different guild's higher total must not leak into this guild's max.
  ('pgtap-boss-hp-guild-2', 'TestBossAlpha', 'Legendary', 3, 1, 'Battle', 9000, 9000);

SELECT is(
  (SELECT b.max_hp FROM public.get_all_boss_hp('pgtap-boss-hp-guild') AS b
    WHERE b.boss_name = 'TestBossAlpha' AND b.rarity = 'Legendary' AND b.set_level = 3 AND b.encounter_id = 1),
  5800::bigint,
  '1. max_hp is the highest damageDealt + remainingHp for the guild, boss, set and encounter'
);
SELECT is(
  (SELECT count(*)::int FROM public.get_all_boss_hp('pgtap-boss-hp-guild') AS b WHERE b.boss_name = 'TestBossBeta'),
  0,
  '2. a non-Legendary/Mythic boss is excluded'
);
SELECT is(
  (SELECT count(*)::int FROM public.get_all_boss_hp('pgtap-boss-hp-guild') AS b),
  1,
  '3. zero-damage and non-Battle rows contribute no extra bosses'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.get_all_boss_hp('pgtap-boss-hp-guild') AS b
    WHERE b.boss_name = 'TestBossAlpha' AND b.max_hp = 18000
  ),
  '4. a different guild''s battles do not affect this guild''s max_hp'
);
SELECT is(
  (SELECT b.max_hp FROM public.get_all_boss_hp(NULL) AS b WHERE b.boss_name = 'TestBossAlpha'),
  18000::bigint,
  '5. a null guild code aggregates across every guild, picking up the other guild''s higher max'
);

SELECT ok(to_regprocedure('public.get_all_boss_hp(text)') IS NOT NULL,
  '6. get_all_boss_hp exists');
SELECT ok(NOT has_function_privilege('anon', 'public.get_all_boss_hp(text)', 'EXECUTE'),
  '7. anon cannot execute get_all_boss_hp');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_all_boss_hp(text)', 'EXECUTE'),
  '8. authenticated cannot execute get_all_boss_hp');
SELECT ok(has_function_privilege('service_role', 'public.get_all_boss_hp(text)', 'EXECUTE'),
  '9. service_role can execute get_all_boss_hp');

ROLLBACK;

-- target-db: general
-- boss-assignment-solver (an edge function here) calls this on every run, but a sibling
-- repo's dead-function audit dropped it live, so every boss token target fell to the minimum.
-- The baseline text never ran under plpgsql.variable_conflict=error (its OUT columns clash
-- with a CTE column), hence #variable_conflict use_column. service_role is the only caller.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_all_boss_hp(p_guild_code text DEFAULT NULL::text) RETURNS TABLE(boss_name text, rarity text, set_level integer, encounter_id integer, max_hp bigint)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH boss_battles AS (
    -- Get all boss battles with damage and remaining HP
    SELECT
      g."Name" as boss_name,
      g."rarity" as rarity,
      g."set" as set_level,
      g."encounterId" as encounter_id,
      g."damageDealt" + g."remainingHp" as total_hp
    FROM "EOT_GR_data" g
    WHERE
      g."rarity" IN ('Legendary', 'Mythic')
      AND g."damageType" = 'Battle'
      AND g."damageDealt" > 0
      AND g."Name" IS NOT NULL
      AND (p_guild_code IS NULL OR g."Guild" = p_guild_code)
  ),
  max_hp_per_boss AS (
    -- Get the maximum HP seen for each boss/level/encounter combination
    SELECT
      boss_name,
      rarity,
      set_level,
      encounter_id,
      MAX(total_hp) as max_hp
    FROM boss_battles
    GROUP BY boss_name, rarity, set_level, encounter_id
  )
  SELECT
    boss_name::TEXT,
    rarity::TEXT,
    set_level::INT,
    encounter_id::INT,
    max_hp::BIGINT
  FROM max_hp_per_boss
  WHERE max_hp > 0
  ORDER BY
    CASE rarity
      WHEN 'Mythic' THEN 1
      WHEN 'Legendary' THEN 2
      ELSE 3
    END,
    set_level DESC,
    encounter_id,
    boss_name;
END;
$$;

ALTER FUNCTION public.get_all_boss_hp(p_guild_code text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_all_boss_hp(p_guild_code text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_boss_hp(p_guild_code text) TO service_role;

DO $verify$
BEGIN
  IF to_regprocedure('public.get_all_boss_hp(text)') IS NULL THEN
    RAISE EXCEPTION 'get_all_boss_hp did not get created';
  END IF;
  IF has_function_privilege('anon', 'public.get_all_boss_hp(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_all_boss_hp(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or authenticated can execute get_all_boss_hp';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_all_boss_hp(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute get_all_boss_hp';
  END IF;
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

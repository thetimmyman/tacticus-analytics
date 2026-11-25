-- target-db: general
-- Seed missing playable unit rows in public.hero_mappings so roster snapshots
-- for current heroes and upcoming Machines of War complete without skipping.
-- Preserves existing rows via ON CONFLICT DO NOTHING and backfills game_id on
-- astarEradicator only when unset.

-- Rollback: DELETE FROM public.hero_mappings WHERE unit_id IN ('orksWeirdboy', 'lostaBile', 'lostaFearmonger', 'custoDreadnought'); UPDATE public.hero_mappings SET game_id = NULL WHERE unit_id = 'astarEradicator' AND game_id = 'nubari';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

INSERT INTO public.hero_mappings (
  unit_id,
  display_name,
  category,
  game_id,
  movement,
  traits,
  damage_profiles,
  item_slots,
  base_health,
  base_damage,
  base_armor
)
VALUES
  (
    'orksWeirdboy',
    'Zapspitta',
    'Hero',
    'zapspitta',
    3,
    ARRAY['GetStuckIn', 'Psyker', 'Explodes']::text[],
    ARRAY['Psychic']::text[],
    ARRAY['I_Crit', 'I_Defensive', 'I_Booster_Crit']::text[],
    100,
    12,
    13
  ),
  (
    'lostaBile',
    'Fabius Bile',
    'Hero',
    'fabius-bile',
    3,
    ARRAY['Healer', 'Resilient']::text[],
    ARRAY['Physical', 'Toxic']::text[],
    ARRAY['I_Crit', 'I_Defensive', 'I_Booster_Crit']::text[],
    90,
    33,
    19
  ),
  (
    'lostaFearmonger',
    'Daras',
    'Hero',
    'daras',
    3,
    ARRAY['Overwatch', 'Camouflage', 'Terrifying']::text[],
    ARRAY['Physical', 'Bolter']::text[],
    ARRAY['I_Crit', 'I_Defensive', 'I_Booster_Crit']::text[],
    90,
    31,
    21
  ),
  (
    'custoDreadnought',
    'Boudicari',
    'MOW',
    'boudicari',
    3,
    ARRAY['MachineOfWar']::text[],
    ARRAY[]::text[],
    ARRAY[]::text[],
    0,
    0,
    0
  )
ON CONFLICT (unit_id) DO NOTHING;

UPDATE public.hero_mappings
SET game_id = 'nubari',
    updated_at = now()
WHERE unit_id = 'astarEradicator'
  AND game_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.hero_mappings existing
    WHERE existing.game_id = 'nubari'
  );

COMMIT;

-- target-db: general
-- War Room shared teams (one guild-scoped row per team) and rank-name ordering.
-- RLS uses _pm_caller_policy_rows(): authenticated cannot read player_mapping.

BEGIN;

-- rank_name is a display string whose alphabetical order is not gameplay order.
CREATE OR REPLACE FUNCTION public.tacticus_rank_index(p_rank_name text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_rank_name
    WHEN 'Stone I' THEN 0
    WHEN 'Stone II' THEN 1
    WHEN 'Stone III' THEN 2
    WHEN 'Iron I' THEN 3
    WHEN 'Iron II' THEN 4
    WHEN 'Iron III' THEN 5
    WHEN 'Bronze I' THEN 6
    WHEN 'Bronze II' THEN 7
    WHEN 'Bronze III' THEN 8
    WHEN 'Silver I' THEN 9
    WHEN 'Silver II' THEN 10
    WHEN 'Silver III' THEN 11
    WHEN 'Gold I' THEN 12
    WHEN 'Gold II' THEN 13
    WHEN 'Gold III' THEN 14
    WHEN 'Diamond I' THEN 15
    WHEN 'Diamond II' THEN 16
    WHEN 'Diamond III' THEN 17
    WHEN 'Adamantium I' THEN 18
    WHEN 'Adamantium II' THEN 19
    WHEN 'Adamantium III' THEN 20
    WHEN 'Mythic I' THEN 21
    WHEN 'Mythic II' THEN 22
    WHEN 'Mythic III' THEN 23
    ELSE NULL::integer
  END;
$$;

COMMENT ON FUNCTION public.tacticus_rank_index(text) IS
  'WI-8680: canonical ordering index for player_roster.rank_name (Stone I=0 .. Mythic III=23). NULL for unknown labels.';

REVOKE ALL ON FUNCTION public.tacticus_rank_index(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tacticus_rank_index(text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tacticus_rank_name(p_rank_index integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_rank_index
    WHEN 0 THEN 'Stone I'
    WHEN 1 THEN 'Stone II'
    WHEN 2 THEN 'Stone III'
    WHEN 3 THEN 'Iron I'
    WHEN 4 THEN 'Iron II'
    WHEN 5 THEN 'Iron III'
    WHEN 6 THEN 'Bronze I'
    WHEN 7 THEN 'Bronze II'
    WHEN 8 THEN 'Bronze III'
    WHEN 9 THEN 'Silver I'
    WHEN 10 THEN 'Silver II'
    WHEN 11 THEN 'Silver III'
    WHEN 12 THEN 'Gold I'
    WHEN 13 THEN 'Gold II'
    WHEN 14 THEN 'Gold III'
    WHEN 15 THEN 'Diamond I'
    WHEN 16 THEN 'Diamond II'
    WHEN 17 THEN 'Diamond III'
    WHEN 18 THEN 'Adamantium I'
    WHEN 19 THEN 'Adamantium II'
    WHEN 20 THEN 'Adamantium III'
    WHEN 21 THEN 'Mythic I'
    WHEN 22 THEN 'Mythic II'
    WHEN 23 THEN 'Mythic III'
    ELSE NULL::text
  END;
$$;

COMMENT ON FUNCTION public.tacticus_rank_name(integer) IS
  'WI-8680: inverse of tacticus_rank_index - rank label for a 0..23 index. NULL in, NULL out.';

REVOKE ALL ON FUNCTION public.tacticus_rank_name(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tacticus_rank_name(integer)
  TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.guild_war_meta_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_code  text NOT NULL REFERENCES public.guild_config(guild_code) ON DELETE CASCADE,
  name        text NOT NULL,
  side        text NOT NULL CHECK (side IN ('offense', 'defense')),
  -- Lower is more urgent; NULL sorts after real priorities.
  priority    integer CHECK (priority IS NULL OR priority BETWEEN 1 AND 99),
  notes       text,
  heroes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild_war_meta_teams_name_len
    CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT guild_war_meta_teams_heroes_array
    CHECK (jsonb_typeof(heroes) = 'array' AND jsonb_array_length(heroes) <= 15),
  CONSTRAINT guild_war_meta_teams_unique_name UNIQUE (guild_code, name)
);

COMMENT ON TABLE public.guild_war_meta_teams IS
  'WI-8680: guild-shared Guild War meta teams (offense/defense) with core/flex/MoW hero roles. Leadership edits, members read.';
COMMENT ON COLUMN public.guild_war_meta_teams.heroes IS
  'Array of {unitId, role}; role is core, flex, or mow. Maximum 15 entries including the Machine of War; element shape is enforced by trigger.';
COMMENT ON COLUMN public.guild_war_meta_teams.priority IS
  '1..99, lower = more urgent; NULL = unprioritised and sorts last.';

CREATE INDEX IF NOT EXISTS idx_guild_war_meta_teams_guild_side
  ON public.guild_war_meta_teams
    (guild_code, side, priority NULLS LAST, created_at);

-- A CHECK cannot inspect JSONB elements; this trigger enforces their shape.
CREATE OR REPLACE FUNCTION public.guild_war_meta_teams_validate_heroes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry jsonb;
  v_unit text;
  v_role text;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(NEW.heroes) <> 'array' THEN
    RAISE EXCEPTION 'guild_war_meta_teams.heroes must be an array';
  END IF;

  FOR v_entry IN SELECT jsonb_array_elements(NEW.heroes) LOOP
    IF v_entry IS NULL OR jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'guild_war_meta_teams.heroes entries must be objects';
    END IF;

    v_unit := v_entry ->> 'unitId';
    v_role := v_entry ->> 'role';

    IF v_unit IS NULL OR char_length(trim(v_unit)) = 0 THEN
      RAISE EXCEPTION 'guild_war_meta_teams.heroes entry missing unitId';
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('core', 'flex', 'mow') THEN
      RAISE EXCEPTION
        'guild_war_meta_teams.heroes role must be core, flex or mow (got %)',
        v_role;
    END IF;

    IF v_unit = ANY (v_seen) THEN
      RAISE EXCEPTION 'guild_war_meta_teams.heroes duplicate unitId %', v_unit;
    END IF;

    v_seen := array_append(v_seen, v_unit);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guild_war_meta_teams_validate_heroes
  ON public.guild_war_meta_teams;
CREATE TRIGGER trg_guild_war_meta_teams_validate_heroes
  BEFORE INSERT OR UPDATE OF heroes ON public.guild_war_meta_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.guild_war_meta_teams_validate_heroes();

CREATE OR REPLACE FUNCTION public.guild_war_meta_teams_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guild_war_meta_teams_updated_at
  ON public.guild_war_meta_teams;
CREATE TRIGGER trg_guild_war_meta_teams_updated_at
  BEFORE UPDATE ON public.guild_war_meta_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.guild_war_meta_teams_set_updated_at();

ALTER TABLE public.guild_war_meta_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guild_war_meta_teams_member_read
  ON public.guild_war_meta_teams;
CREATE POLICY guild_war_meta_teams_member_read
  ON public.guild_war_meta_teams
  FOR SELECT
  TO authenticated
  USING (
    guild_code IN (
      SELECT pm.guild_code
      FROM public._pm_caller_policy_rows() AS pm
      WHERE pm.is_current = true
        AND pm.guild_code IS NOT NULL
    )
  );

-- The same predicate in WITH CHECK stops moving a row to another guild.
DROP POLICY IF EXISTS guild_war_meta_teams_leader_write
  ON public.guild_war_meta_teams;
CREATE POLICY guild_war_meta_teams_leader_write
  ON public.guild_war_meta_teams
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public._pm_caller_policy_rows() AS pm
      WHERE pm.is_current = true
        AND pm.guild_code = guild_war_meta_teams.guild_code
        AND lower(pm.role::text) IN ('officer', 'leader')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public._pm_caller_policy_rows() AS pm
      WHERE pm.is_current = true
        AND pm.guild_code = guild_war_meta_teams.guild_code
        AND lower(pm.role::text) IN ('officer', 'leader')
    )
  );

-- For environments where service_role does not bypass RLS.
DROP POLICY IF EXISTS guild_war_meta_teams_service_all
  ON public.guild_war_meta_teams;
CREATE POLICY guild_war_meta_teams_service_all
  ON public.guild_war_meta_teams
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- The column allow-list withholds created_by; a table-level SELECT would re-expose it.
REVOKE ALL ON TABLE public.guild_war_meta_teams
  FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE, DELETE
  ON public.guild_war_meta_teams TO authenticated;
GRANT SELECT (
  id, guild_code, name, side, priority, notes, heroes, created_at, updated_at
)
  ON public.guild_war_meta_teams TO authenticated;
GRANT ALL ON public.guild_war_meta_teams TO service_role;

DO $verify$
DECLARE
  v_columns text[];
  v_trigger_count integer;
  v_policy_count integer;
  v_allowed_column text;
BEGIN
  IF to_regclass('public.guild_war_meta_teams') IS NULL THEN
    RAISE EXCEPTION 'WI-8680 verify: guild_war_meta_teams is missing';
  END IF;

  SELECT array_agg(column_name ORDER BY ordinal_position)
    INTO v_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'guild_war_meta_teams';

  IF v_columns IS DISTINCT FROM ARRAY[
    'id', 'guild_code', 'name', 'side', 'priority', 'notes', 'heroes',
    'created_by', 'created_at', 'updated_at'
  ]::text[] THEN
    RAISE EXCEPTION
      'WI-8680 verify: guild_war_meta_teams columns drifted: %', v_columns;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.guild_war_meta_teams'::regclass) THEN
    RAISE EXCEPTION 'WI-8680 verify: guild_war_meta_teams does not enable RLS';
  END IF;

  IF to_regprocedure('public.tacticus_rank_index(text)') IS NULL
     OR to_regprocedure('public.tacticus_rank_name(integer)') IS NULL
     OR to_regprocedure(
       'public.guild_war_meta_teams_validate_heroes()'
     ) IS NULL
     OR to_regprocedure(
       'public.guild_war_meta_teams_set_updated_at()'
     ) IS NULL THEN
    RAISE EXCEPTION 'WI-8680 verify: one or more War Room functions are missing';
  END IF;

  SELECT count(*)::integer INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'public.guild_war_meta_teams'::regclass
     AND NOT tgisinternal
     AND tgname IN (
       'trg_guild_war_meta_teams_validate_heroes',
       'trg_guild_war_meta_teams_updated_at'
     );
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION
      'WI-8680 verify: expected two War Room triggers, found %',
      v_trigger_count;
  END IF;

  SELECT count(*)::integer INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'public.guild_war_meta_teams'::regclass;
  IF v_policy_count <> 3
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.guild_war_meta_teams'::regclass
          AND polname = 'guild_war_meta_teams_member_read'
          AND polcmd = 'r'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.guild_war_meta_teams'::regclass
          AND polname = 'guild_war_meta_teams_leader_write'
          AND polcmd = '*'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.guild_war_meta_teams'::regclass
          AND polname = 'guild_war_meta_teams_service_all'
          AND polcmd = '*'
     ) THEN
    RAISE EXCEPTION
      'WI-8680 verify: expected the reviewed three-policy RLS set, found % policies',
      v_policy_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
       AND polname IN (
         'guild_war_meta_teams_member_read',
         'guild_war_meta_teams_leader_write'
       )
       AND (
         pg_get_expr(polqual, polrelid)
           ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
         OR pg_get_expr(polwithcheck, polrelid)
           ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
       )
  ) THEN
    RAISE EXCEPTION
      'WI-8680 verify: War Room RLS still reads player_mapping as a base relation';
  END IF;

  IF has_table_privilege('anon', 'public.guild_war_meta_teams', 'SELECT')
     OR has_table_privilege(
       'authenticated', 'public.guild_war_meta_teams', 'SELECT'
     )
     OR has_column_privilege(
       'authenticated', 'public.guild_war_meta_teams', 'created_by', 'SELECT'
     ) THEN
    RAISE EXCEPTION
      'WI-8680 verify: guild_war_meta_teams still has a broad or created_by SELECT grant';
  END IF;

  FOREACH v_allowed_column IN ARRAY ARRAY[
    'id', 'guild_code', 'name', 'side', 'priority', 'notes', 'heroes',
    'created_at', 'updated_at'
  ] LOOP
    IF NOT has_column_privilege(
      'authenticated',
      'public.guild_war_meta_teams',
      v_allowed_column,
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'WI-8680 verify: authenticated lost SELECT on guild_war_meta_teams.%',
        v_allowed_column;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
       'authenticated', 'public.guild_war_meta_teams', 'INSERT'
     )
     OR NOT has_table_privilege(
       'authenticated', 'public.guild_war_meta_teams', 'UPDATE'
     )
     OR NOT has_table_privilege(
       'authenticated', 'public.guild_war_meta_teams', 'DELETE'
     ) THEN
    RAISE EXCEPTION
      'WI-8680 verify: authenticated lost the leadership write grants';
  END IF;

  RAISE NOTICE
    'WI-8680 verify: shared War Room teams, triggers, RLS, and grants are installed';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- target-db: general
-- War Room readiness and hero-usage reads. DEFINER, so each returns nothing unless
-- the caller has a current mapping in p_guild_code.

BEGIN;

-- Battles and normalized attempts overlap; an attempt is dropped only when a
-- matching battle exists, so nothing double-counts.
CREATE OR REPLACE FUNCTION public.get_guild_war_hero_usage(p_guild_code text)
RETURNS TABLE (
  war_id         text,
  player_id      text,
  player_name    text,
  unit_id        text,
  is_mow         boolean,
  times_fielded  integer,
  times_died     integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- SECURITY DEFINER bypasses table RLS, so establish the caller boundary
  -- explicitly.  The helper already resolves auth.uid()'s own mappings; the
  -- explicit guild/current predicates make this RPC's contract reviewable.
  IF NOT EXISTS (
    SELECT 1
    FROM public._pm_caller_policy_rows() AS pm
    WHERE pm.user_id = (SELECT auth.uid())
      AND pm.is_current = true
      AND pm.guild_code = p_guild_code
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH active_war AS (
    SELECT m.war_id
    FROM public.guild_war_matches AS m
    WHERE m.guild_code = p_guild_code
      AND m.war_status = 'active'
      -- Match buildActiveWarVisibilityFilter(): an explicit end is visible
      -- through the 12-hour grace window, while a missing end is visible only
      -- for one 60-hour war plus that grace window after its start.
      AND (
        (
          m.war_end_date IS NOT NULL
          AND m.war_end_date > now() - interval '12 hours'
        )
        OR (
          m.war_end_date IS NULL
          AND m.war_start_date > now() - interval '72 hours'
        )
      )
    ORDER BY m.war_start_date DESC NULLS LAST, m.created_at DESC
    LIMIT 1
  ),
  raw_events AS (
    SELECT
      b.war_id,
      b.guild_code,
      b.event_id,
      b.attacker_player_id AS player_id,
      b.attacker_player_name AS player_name,
      b.attempt_number,
      b.attacker_team_index,
      'battle'::text AS source,
      COALESCE(
        NULLIF(
          CASE
            WHEN jsonb_typeof(b.attacker_units_json) = 'array'
              THEN b.attacker_units_json
          END,
          '[]'::jsonb
        ),
        CASE
          WHEN jsonb_typeof(b.units_used) = 'array' THEN b.units_used
        END,
        '[]'::jsonb
      )
      -- Loki keeps the attacker's MoW beside, rather than inside,
      -- attacker_units_json.  Prefer the battle summary written by the
      -- ingestor and fall back to the lineup projection when it is available.
      || CASE
        WHEN jsonb_typeof(attacker_machine.machine) = 'object'
          THEN jsonb_build_array(attacker_machine.machine)
        WHEN jsonb_typeof(attacker_machine.machine) = 'array'
          THEN attacker_machine.machine
        ELSE '[]'::jsonb
      END AS units
    FROM public.guild_war_battles AS b
    LEFT JOIN public.guild_war_lineups AS attacker_lineup
      ON attacker_lineup.lineup_id = b.attacker_lineup_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(
          b.battle_summary #> '{attacker,machineOfWar}',
          'null'::jsonb
        ),
        attacker_lineup.machine_of_war
      ) AS machine
    ) AS attacker_machine
    WHERE b.guild_code = p_guild_code
      AND b.war_id = (SELECT aw.war_id FROM active_war AS aw)
      AND b.is_guild_member = true

    UNION ALL

    SELECT
      a.war_id,
      a.guild_code,
      a.event_id,
      a.player_id,
      a.player_name,
      a.attempt_number,
      a.attacker_team_index,
      'attempt'::text AS source,
      COALESCE(
        NULLIF(
          CASE
            WHEN jsonb_typeof(a.attacker_units_json) = 'array'
              THEN a.attacker_units_json
          END,
          '[]'::jsonb
        ),
        CASE
          WHEN jsonb_typeof(a.units_used) = 'array' THEN a.units_used
        END,
        '[]'::jsonb
      ) || '[]'::jsonb AS units
    FROM public.guild_war_player_attempts AS a
    WHERE a.guild_code = p_guild_code
      AND a.war_id = (SELECT aw.war_id FROM active_war AS aw)
      AND a.is_guild_member = true
  ),
  canonical_events AS (
    SELECT e.*
    FROM raw_events AS e
    WHERE NOT EXISTS (
      SELECT 1
      FROM raw_events AS b
      WHERE b.source = 'battle'
        AND e.source = 'attempt'
        AND b.war_id = e.war_id
        AND b.guild_code = e.guild_code
        AND (
          (
            b.event_id IS NOT NULL
            AND e.event_id IS NOT NULL
            AND b.event_id = e.event_id
          )
          OR (
            -- Loki's two writers generate different hashes for a non-UUID
            -- source id.  A mismatched id therefore falls back to the same
            -- natural attempt identity; an equal non-null id above remains the
            -- preferred event identity.
            (
              b.event_id IS NULL
              OR e.event_id IS NULL
              OR b.event_id IS DISTINCT FROM e.event_id
            )
            AND b.player_id IS NOT DISTINCT FROM e.player_id
            AND b.attempt_number IS NOT DISTINCT FROM e.attempt_number
            AND b.attacker_team_index IS NOT DISTINCT FROM e.attacker_team_index
          )
        )
    )
  ),
  event_hp AS (
    SELECT
      e.*,
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(e.units) = 'array' THEN e.units
            ELSE '[]'::jsonb
          END
        ) AS peer(unit)
        WHERE jsonb_typeof(peer.unit) = 'object'
          AND CASE
            WHEN peer.unit ? 'remainingHPAfter'
              THEN peer.unit ->> 'remainingHPAfter'
            WHEN peer.unit ? 'remainingHpAfter'
              THEN peer.unit ->> 'remainingHpAfter'
            WHEN peer.unit ? 'remainingHp'
              THEN peer.unit ->> 'remainingHp'
          END ~ '^-?[0-9]+([.][0-9]+)?$'
      ) AS any_hp_after
    FROM canonical_events AS e
  ),
  unit_rows AS (
    SELECT
      e.war_id,
      e.player_id,
      e.player_name,
      NULLIF(btrim(u.unit ->> 'unitId'), '') AS unit_id,
      CASE
        WHEN u.unit ? 'remainingHPAfter'
          THEN u.unit ->> 'remainingHPAfter'
        WHEN u.unit ? 'remainingHpAfter'
          THEN u.unit ->> 'remainingHpAfter'
        WHEN u.unit ? 'remainingHp'
          THEN u.unit ->> 'remainingHp'
      END AS hp_after,
      (
        u.unit ? 'remainingHPAfter'
        OR u.unit ? 'remainingHpAfter'
        OR u.unit ? 'remainingHp'
      ) AS has_hp_field,
      e.any_hp_after
    FROM event_hp AS e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(e.units) = 'array' THEN e.units
        ELSE '[]'::jsonb
      END
    ) AS u(unit)
    WHERE jsonb_typeof(u.unit) = 'object'
      AND NULLIF(btrim(u.unit ->> 'unitId'), '') IS NOT NULL
  ),
  units AS (
    SELECT
      unit_rows.war_id,
      unit_rows.player_id,
      unit_rows.player_name,
      unit_rows.unit_id,
      CASE
        -- An explicit null is the parser's known-dead state.  An omitted HP
        -- field is inferred only when a teammate supplies after-HP evidence,
        -- exactly like isUnitDefeatedByHp in war-shared.tsx.
        WHEN unit_rows.has_hp_field AND unit_rows.hp_after IS NULL THEN true
        WHEN unit_rows.hp_after ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN unit_rows.hp_after::numeric <= 0
        ELSE unit_rows.any_hp_after
      END AS defeated
    FROM unit_rows
  )
  SELECT
    u.war_id::text,
    u.player_id::text,
    MAX(u.player_name)::text AS player_name,
    u.unit_id,
    COALESCE(
      EXISTS (
        SELECT 1
        FROM public.hero_mappings AS hm
        WHERE hm.unit_id = u.unit_id
          AND upper(hm.category) = 'MOW'
      ),
      false
    ) AS is_mow,
    COUNT(*)::integer AS times_fielded,
    COUNT(*) FILTER (WHERE u.defeated)::integer AS times_died
  FROM units AS u
  GROUP BY u.war_id, u.player_id, u.unit_id;
END;
$function$;

COMMENT ON FUNCTION public.get_guild_war_hero_usage(text) IS
  'WI-8680: per-unit usage for the caller''s current guild active war. Reads battles and normalized player attempts, preferring a battle when both describe the same attempt; no rows means no active war or no caller membership.';

REVOKE ALL ON FUNCTION public.get_guild_war_hero_usage(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guild_war_hero_usage(text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_war_room_team_readiness(
  p_guild_code text,
  p_min_rank_index integer DEFAULT 9  -- Silver I; battlefield minimum gate
)
RETURNS TABLE (
  team_id          uuid,
  team_name        text,
  team_side        text,
  team_priority    integer,
  heroes           jsonb,
  floor_rank_index integer,
  floor_rank_name  text,
  ready            boolean,
  weakest_unit_id  text,
  missing_units    jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- RLS on the shared-team table would hide another guild's rows, but a
  -- SECURITY DEFINER function must not rely on that implicit filter.  Return
  -- cleanly (rather than raising) for a stale or cross-guild caller.
  IF NOT EXISTS (
    SELECT 1
    FROM public._pm_caller_policy_rows() AS pm
    WHERE pm.user_id = (SELECT auth.uid())
      AND pm.is_current = true
      AND pm.guild_code = p_guild_code
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH caller AS (
    SELECT pm.user_id
    FROM public._pm_caller_policy_rows() AS pm
    WHERE pm.user_id = (SELECT auth.uid())
      AND pm.is_current = true
      AND pm.guild_code = p_guild_code
    LIMIT 1
  ),
  roster AS (
    -- Readiness is always the CALLER's own floor.  The explicit user_id filter
    -- is retained even though the function is SECURITY DEFINER.
    SELECT hm.unit_id, pr.rank_name
    FROM public.player_roster AS pr
    JOIN public.hero_mappings AS hm ON hm.id = pr.hero_mapping_id
    WHERE pr.user_id = (SELECT user_id FROM caller)
  ),
  teams AS (
    SELECT t.id, t.name, t.side, t.priority, t.heroes
    FROM public.guild_war_meta_teams AS t
    WHERE t.guild_code = p_guild_code
  ),
  per_team AS (
    SELECT
      t.id,
      t.name,
      t.side,
      t.priority,
      t.heroes,
      -- Fielded five: all core first, then the caller's best flex units. MoW
      -- is excluded because it has no gear track. The ordinal tie-breaker
      -- makes teams with equal-rank flex deterministic.
      COALESCE(
        (
          SELECT jsonb_agg(
            candidate.entry
            ORDER BY
              candidate.role_order,
              candidate.unit_rank DESC NULLS LAST,
              candidate.ordinal
          )
          FROM (
            SELECT
              he.entry,
              he.ordinal,
              CASE he.entry ->> 'role'
                WHEN 'core' THEN 0
                WHEN 'flex' THEN 1
                ELSE 2
              END AS role_order,
              COALESCE(tacticus_rank_index(r.rank_name), -1) AS unit_rank
            FROM jsonb_array_elements(t.heroes) WITH ORDINALITY
              AS he(entry, ordinal)
            LEFT JOIN roster AS r
              ON r.unit_id = (he.entry ->> 'unitId')
            WHERE he.entry ->> 'role' IN ('core', 'flex')
            ORDER BY
              CASE he.entry ->> 'role' WHEN 'core' THEN 0 ELSE 1 END,
              COALESCE(tacticus_rank_index(r.rank_name), -1) DESC,
              he.ordinal
            LIMIT 5
          ) AS candidate
        ),
        '[]'::jsonb
      ) AS fielded
    FROM teams AS t
  )
  SELECT
    pt.id,
    pt.name,
    pt.side,
    pt.priority,
    pt.heroes,
    MIN(tacticus_rank_index(r.rank_name))::integer,
    tacticus_rank_name(MIN(tacticus_rank_index(r.rank_name))),
    COALESCE(
      BOOL_AND(
        r.rank_name IS NOT NULL
        AND tacticus_rank_index(r.rank_name) >= p_min_rank_index
      ),
      false
    )::boolean AS ready,
    (
      SELECT f.entry ->> 'unitId'
      FROM jsonb_array_elements(COALESCE(pt.fielded, '[]'::jsonb)) AS f(entry)
      JOIN roster AS r ON r.unit_id = (f.entry ->> 'unitId')
      WHERE jsonb_typeof(f.entry) = 'object'
      ORDER BY
        COALESCE(tacticus_rank_index(r.rank_name), -1) ASC,
        f.entry ->> 'unitId'
      LIMIT 1
    ) AS weakest_unit_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'unitId', f.entry ->> 'unitId',
          'role', f.entry ->> 'role',
          'owned', r.unit_id IS NOT NULL,
          'rankIndex', tacticus_rank_index(r.rank_name)
        )
        ORDER BY f.entry ->> 'role', f.entry ->> 'unitId'
      ) FILTER (
        WHERE r.unit_id IS NULL
          OR tacticus_rank_index(r.rank_name) < p_min_rank_index
      ),
      '[]'::jsonb
    ) AS missing_units
  FROM per_team AS pt
  LEFT JOIN LATERAL jsonb_array_elements(
    COALESCE(pt.fielded, '[]'::jsonb)
  ) AS f(entry) ON jsonb_typeof(f.entry) = 'object'
  LEFT JOIN roster AS r ON r.unit_id = (f.entry ->> 'unitId')
  GROUP BY pt.id, pt.name, pt.side, pt.priority, pt.heroes, pt.fielded;
END;
$function$;

COMMENT ON FUNCTION public.get_war_room_team_readiness(text, integer) IS
  'WI-8680: per-caller gear-floor readiness for each guild shared team. Fielded five = all core plus best caller-owned flex; MoW is excluded. Returns empty for a non-member, another guild, or no teams.';

REVOKE ALL ON FUNCTION public.get_war_room_team_readiness(text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_war_room_team_readiness(text, integer)
  TO authenticated, service_role;

DO $verify$
DECLARE
  v_bad integer;
BEGIN
  IF to_regprocedure('public.get_guild_war_hero_usage(text)') IS NULL
     OR to_regprocedure(
       'public.get_war_room_team_readiness(text,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'WI-8680 verify: one or more War Room readiness functions are missing';
  END IF;

  SELECT count(*)::integer
    INTO v_bad
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.oid IN (
       'public.get_guild_war_hero_usage(text)'::regprocedure,
       'public.get_war_room_team_readiness(text,integer)'::regprocedure
     )
     AND (
       p.prosecdef = false
       OR p.provolatile <> 's'
       OR p.proconfig IS NULL
     );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'WI-8680 verify: readiness functions must be STABLE SECURITY DEFINER with a pinned search_path';
  END IF;

  IF has_function_privilege(
       'anon', 'public.get_guild_war_hero_usage(text)', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.get_war_room_team_readiness(text,integer)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'WI-8680 verify: anon must not execute War Room readiness functions';
  END IF;

  IF NOT has_function_privilege(
       'authenticated', 'public.get_guild_war_hero_usage(text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_war_room_team_readiness(text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.get_guild_war_hero_usage(text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.get_war_room_team_readiness(text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'WI-8680 verify: readiness function grants do not match the TA role contract';
  END IF;

  RAISE NOTICE
    'WI-8680 verify: War Room readiness and usage RPCs, security posture, and grants are installed';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

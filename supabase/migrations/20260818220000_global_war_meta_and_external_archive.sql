-- Global war meta: definer RPCs publish only anonymous composition counts via
-- service-role routes; raw battle rows stay guild-scoped.

BEGIN;

CREATE TABLE public.external_war_meta_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  metric_type text NOT NULL CHECK (metric_type IN ('cores', 'lineups')),
  side text NOT NULL CHECK (side IN ('offense', 'defense')),
  season integer NOT NULL CHECK (season > 0),
  battlefield_level integer NOT NULL CHECK (battlefield_level BETWEEN 1 AND 5),
  snapshot_at timestamptz NOT NULL,
  source_url text NOT NULL,
  page_count integer NOT NULL CHECK (page_count > 0),
  row_count integer NOT NULL CHECK (row_count >= 0),
  checksum text NOT NULL CHECK (length(checksum) = 64),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, metric_type, side, season, battlefield_level, checksum)
);

CREATE TABLE public.external_war_meta_lineups (
  snapshot_id uuid NOT NULL REFERENCES public.external_war_meta_snapshots(id) ON DELETE CASCADE,
  lineup_key text NOT NULL,
  unit_ids text[] NOT NULL CHECK (cardinality(unit_ids) = 5),
  uses bigint NOT NULL CHECK (uses >= 0),
  wins bigint NOT NULL CHECK (wins >= 0 AND wins <= uses),
  losses bigint NOT NULL CHECK (losses >= 0 AND wins + losses = uses),
  win_rate numeric(5, 2) NOT NULL CHECK (win_rate BETWEEN 0 AND 100),
  avg_score numeric,
  PRIMARY KEY (snapshot_id, lineup_key)
);

CREATE TABLE public.external_war_meta_cores (
  snapshot_id uuid NOT NULL REFERENCES public.external_war_meta_snapshots(id) ON DELETE CASCADE,
  core_key text NOT NULL,
  unit_ids text[] NOT NULL CHECK (cardinality(unit_ids) = 3),
  uses bigint NOT NULL CHECK (uses >= 0),
  wins bigint NOT NULL CHECK (wins >= 0 AND wins <= uses),
  win_rate numeric(5, 2) NOT NULL CHECK (win_rate BETWEEN 0 AND 100),
  flex_options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(flex_options) = 'array'),
  PRIMARY KEY (snapshot_id, core_key)
);

CREATE TABLE public.external_war_meta_quarantine (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  metric_type text NOT NULL,
  side text NOT NULL,
  season integer NOT NULL,
  battlefield_level integer NOT NULL,
  source_url text NOT NULL,
  unknown_unit_ids text[] NOT NULL,
  raw_row jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX external_war_meta_snapshots_latest_idx
  ON public.external_war_meta_snapshots
  (metric_type, side, season, battlefield_level, snapshot_at DESC);

ALTER TABLE public.external_war_meta_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_war_meta_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_war_meta_cores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_war_meta_quarantine ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.external_war_meta_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.external_war_meta_lineups
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.external_war_meta_cores
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.external_war_meta_quarantine
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.external_war_meta_quarantine_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.import_external_war_meta_slice(
  p_source text,
  p_metric_type text,
  p_side text,
  p_season integer,
  p_battlefield_level integer,
  p_snapshot_at timestamptz,
  p_source_url text,
  p_page_count integer,
  p_checksum text,
  p_rows jsonb,
  p_quarantined_rows jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot_id uuid;
  v_row_count integer;
BEGIN
  IF p_source IS NULL OR btrim(p_source) = ''
     OR p_metric_type NOT IN ('cores', 'lineups')
     OR p_side NOT IN ('offense', 'defense')
     OR p_season <= 0
     OR p_battlefield_level NOT BETWEEN 1 AND 5
     OR p_page_count <= 0
     OR length(p_checksum) <> 64
     OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_typeof(p_quarantined_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid external war meta slice';
  END IF;

  v_row_count := jsonb_array_length(p_rows);

  SELECT snapshot.id
  INTO v_snapshot_id
  FROM public.external_war_meta_snapshots AS snapshot
  WHERE snapshot.source = p_source
    AND snapshot.metric_type = p_metric_type
    AND snapshot.side = p_side
    AND snapshot.season = p_season
    AND snapshot.battlefield_level = p_battlefield_level
    AND snapshot.checksum = p_checksum;

  IF v_snapshot_id IS NOT NULL THEN
    RETURN v_snapshot_id;
  END IF;

  INSERT INTO public.external_war_meta_snapshots (
    source, metric_type, side, season, battlefield_level, snapshot_at,
    source_url, page_count, row_count, checksum
  ) VALUES (
    p_source, p_metric_type, p_side, p_season, p_battlefield_level,
    p_snapshot_at, p_source_url, p_page_count, v_row_count, p_checksum
  )
  RETURNING id INTO v_snapshot_id;

  IF p_metric_type = 'lineups' THEN
    INSERT INTO public.external_war_meta_lineups (
      snapshot_id, lineup_key, unit_ids, uses, wins, losses, win_rate, avg_score
    )
    SELECT
      v_snapshot_id,
      row_data.lineup_key,
      row_data.unit_ids,
      row_data.uses,
      row_data.wins,
      row_data.losses,
      row_data.win_rate,
      row_data.avg_score
    FROM jsonb_to_recordset(p_rows) AS row_data(
      lineup_key text,
      unit_ids text[],
      uses bigint,
      wins bigint,
      losses bigint,
      win_rate numeric,
      avg_score numeric
    );
  ELSE
    INSERT INTO public.external_war_meta_cores (
      snapshot_id, core_key, unit_ids, uses, wins, win_rate, flex_options
    )
    SELECT
      v_snapshot_id,
      row_data.core_key,
      row_data.unit_ids,
      row_data.uses,
      row_data.wins,
      row_data.win_rate,
      COALESCE(row_data.flex_options, '[]'::jsonb)
    FROM jsonb_to_recordset(p_rows) AS row_data(
      core_key text,
      unit_ids text[],
      uses bigint,
      wins bigint,
      win_rate numeric,
      flex_options jsonb
    );
  END IF;

  INSERT INTO public.external_war_meta_quarantine (
    source, metric_type, side, season, battlefield_level, source_url,
    unknown_unit_ids, raw_row
  )
  SELECT
    p_source,
    p_metric_type,
    p_side,
    p_season,
    p_battlefield_level,
    p_source_url,
    row_data.unknown_unit_ids,
    row_data.raw_row
  FROM jsonb_to_recordset(p_quarantined_rows) AS row_data(
    unknown_unit_ids text[], raw_row jsonb
  );

  RETURN v_snapshot_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_external_war_meta_slice(
  text, text, text, integer, integer, timestamptz, text, integer, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_external_war_meta_slice(
  text, text, text, integer, integer, timestamptz, text, integer, text, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_global_war_meta_filters()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH seasons AS (
    SELECT DISTINCT match.war_season AS value
    FROM public.guild_war_matches AS match
    WHERE match.war_season IS NOT NULL
    UNION
    SELECT DISTINCT snapshot.season
    FROM public.external_war_meta_snapshots AS snapshot
  ),
  levels AS (
    SELECT DISTINCT match.battlefield_level AS value
    FROM public.guild_war_matches AS match
    WHERE match.battlefield_level IS NOT NULL
    UNION
    SELECT DISTINCT snapshot.battlefield_level
    FROM public.external_war_meta_snapshots AS snapshot
  )
  SELECT jsonb_build_object(
    'seasons', COALESCE((SELECT jsonb_agg(value ORDER BY value DESC) FROM seasons), '[]'::jsonb),
    'battlefieldLevels', COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM levels), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_global_war_meta_filters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_war_meta_filters() TO service_role;

-- Self-contained: some schema snapshots lack the older war_zone_captured helper.
CREATE OR REPLACE FUNCTION public.global_war_zone_captured(
  p_attempt_result text,
  p_defender_units jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT p_attempt_result IS DISTINCT FROM 'loss'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p_defender_units) = 'array' THEN p_defender_units
          ELSE '[]'::jsonb
        END
      ) AS defender(unit)
      WHERE CASE
        WHEN defender.unit->>'remainingHPAfter'
          ~ '^[-+]?[0-9]+(?:\.[0-9]+)?$'
          THEN (defender.unit->>'remainingHPAfter')::numeric > 0
        ELSE false
      END
    );
$function$;

REVOKE ALL ON FUNCTION public.global_war_zone_captured(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.global_war_zone_captured(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_global_war_lineup_stats(
  p_side text DEFAULT 'offense',
  p_seasons integer[] DEFAULT NULL,
  p_battlefield_levels integer[] DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_min_uses integer DEFAULT 3,
  p_season_count integer DEFAULT 4
) RETURNS TABLE(
  lineup_id text,
  units_json jsonb,
  machine_of_war jsonb,
  uses bigint,
  wins bigint,
  losses bigint,
  win_rate numeric,
  avg_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seasons integer[];
BEGIN
  IF p_side NOT IN ('offense', 'defense') THEN
    RAISE EXCEPTION 'side must be offense or defense';
  END IF;

  v_seasons := p_seasons;
  IF v_seasons IS NULL OR cardinality(v_seasons) = 0 THEN
    SELECT array_agg(available.season ORDER BY available.season DESC)
    INTO v_seasons
    FROM (
      SELECT DISTINCT season
      FROM (
        SELECT match.war_season AS season
        FROM public.guild_war_matches AS match
        WHERE match.war_season IS NOT NULL
        UNION
        SELECT snapshot.season
        FROM public.external_war_meta_snapshots AS snapshot
      ) AS all_seasons
      ORDER BY season DESC
      LIMIT GREATEST(p_season_count, 1)
    ) AS available;
  END IF;

  RETURN QUERY
  WITH latest_external_snapshots AS (
    SELECT DISTINCT ON (
      snapshot.side, snapshot.season, snapshot.battlefield_level
    ) snapshot.id, snapshot.season, snapshot.battlefield_level
    FROM public.external_war_meta_snapshots AS snapshot
    WHERE snapshot.metric_type = 'lineups'
      AND snapshot.side = p_side
      AND snapshot.season = ANY(v_seasons)
      AND snapshot.row_count > 0
      AND (
        p_battlefield_levels IS NULL
        OR cardinality(p_battlefield_levels) = 0
        OR snapshot.battlefield_level = ANY(p_battlefield_levels)
      )
    ORDER BY
      snapshot.side,
      snapshot.season,
      snapshot.battlefield_level,
      snapshot.snapshot_at DESC,
      snapshot.imported_at DESC
  ),
  deduplicated_battles AS (
    SELECT DISTINCT ON (COALESCE(battle.event_id::text, battle.id::text))
      COALESCE(battle.event_id::text, battle.id::text) AS battle_id,
      match.war_season,
      match.battlefield_level,
      battle.attacker_units_json,
      battle.defender_units_json,
      battle.attempt_result,
      battle.score_earned
    FROM public.guild_war_battles AS battle
    JOIN public.guild_war_matches AS match
      ON match.war_id = battle.war_id
     AND match.guild_code = battle.guild_code
    WHERE match.war_season = ANY(v_seasons)
    ORDER BY
      COALESCE(battle.event_id::text, battle.id::text),
      battle.updated_at DESC,
      battle.guild_code
  ),
  own_battle_units AS (
    SELECT
      ARRAY(
        SELECT DISTINCT COALESCE(unit->>'heroKey', unit->>'unitId', unit->>'id')
        FROM jsonb_array_elements(
          CASE WHEN p_side = 'offense'
            THEN battle.attacker_units_json
            ELSE battle.defender_units_json
          END
        ) AS unit
        WHERE COALESCE(unit->>'heroKey', unit->>'unitId', unit->>'id') IS NOT NULL
        ORDER BY 1
      ) AS unit_ids,
      public.global_war_zone_captured(battle.attempt_result::text, battle.defender_units_json) AS captured,
      battle.score_earned::numeric AS score_earned
    FROM deduplicated_battles AS battle
    WHERE NOT EXISTS (
      -- An aggregate archive cannot be row-deduplicated against our raw
      -- corpus. Prefer the archive for a covered season/tier slice and use
      -- first-party battles only for slices absent from that archive.
      SELECT 1
      FROM latest_external_snapshots AS external_slice
      WHERE external_slice.season = battle.war_season
        AND external_slice.battlefield_level = battle.battlefield_level
    )
      AND (
        p_battlefield_levels IS NULL
        OR cardinality(p_battlefield_levels) = 0
        OR battle.battlefield_level = ANY(p_battlefield_levels)
      )
      AND CASE WHEN p_side = 'offense'
        THEN battle.attacker_units_json IS NOT NULL
        ELSE battle.defender_units_json IS NOT NULL
      END
  ),
  own_stats AS (
    SELECT
      array_to_string(own.unit_ids, '|') AS lineup_key,
      own.unit_ids,
      count(*)::bigint AS uses,
      count(*) FILTER (
        WHERE CASE WHEN p_side = 'offense' THEN own.captured ELSE NOT own.captured END
      )::bigint AS wins,
      count(own.score_earned)::bigint AS scored_uses,
      sum(own.score_earned) AS score_total
    FROM own_battle_units AS own
    WHERE cardinality(own.unit_ids) = 5
    GROUP BY own.unit_ids
  ),
  combined AS (
    SELECT
      own.lineup_key,
      own.unit_ids,
      own.uses,
      own.wins,
      own.scored_uses,
      own.score_total
    FROM own_stats AS own
    UNION ALL
    SELECT
      external.lineup_key,
      external.unit_ids,
      external.uses,
      external.wins,
      CASE WHEN external.avg_score IS NULL THEN 0 ELSE external.uses END AS scored_uses,
      external.avg_score * external.uses AS score_total
    FROM public.external_war_meta_lineups AS external
    WHERE external.snapshot_id IN (SELECT latest.id FROM latest_external_snapshots AS latest)
  ),
  merged AS (
    SELECT
      combined.lineup_key,
      combined.unit_ids,
      sum(combined.uses)::bigint AS uses,
      sum(combined.wins)::bigint AS wins,
      sum(combined.scored_uses)::bigint AS scored_uses,
      sum(combined.score_total) AS score_total
    FROM combined
    GROUP BY combined.lineup_key, combined.unit_ids
  )
  SELECT
    md5(merged.lineup_key) AS lineup_id,
    (
      SELECT jsonb_agg(jsonb_build_object('heroKey', unit_id) ORDER BY unit_id)
      FROM unnest(merged.unit_ids) AS unit_id
    ) AS units_json,
    NULL::jsonb AS machine_of_war,
    merged.uses,
    merged.wins,
    merged.uses - merged.wins AS losses,
    round(merged.wins::numeric * 100 / NULLIF(merged.uses, 0), 1) AS win_rate,
    round(merged.score_total / NULLIF(merged.scored_uses, 0), 1) AS avg_score
  FROM merged
  WHERE merged.uses >= GREATEST(p_min_uses, 1)
  ORDER BY merged.uses DESC, win_rate DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_global_war_lineup_stats(
  text, integer[], integer[], integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_war_lineup_stats(
  text, integer[], integer[], integer, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_global_war_core_compositions(
  p_side text DEFAULT 'offense',
  p_seasons integer[] DEFAULT NULL,
  p_battlefield_levels integer[] DEFAULT NULL,
  p_min_uses integer DEFAULT 5,
  p_limit integer DEFAULT 100,
  p_season_count integer DEFAULT 4,
  p_core_size integer DEFAULT 3
) RETURNS TABLE(
  core_id text,
  core_heroes jsonb,
  core_size integer,
  total_uses bigint,
  wins bigint,
  win_rate numeric,
  flex_options jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seasons integer[];
BEGIN
  IF p_side NOT IN ('offense', 'defense') THEN
    RAISE EXCEPTION 'side must be offense or defense';
  END IF;

  IF p_core_size < 2 OR p_core_size > 5 THEN
    RAISE EXCEPTION 'core size must be between 2 and 5'
      USING ERRCODE = '22023';
  END IF;

  v_seasons := p_seasons;
  IF v_seasons IS NULL OR cardinality(v_seasons) = 0 THEN
    SELECT array_agg(available.season ORDER BY available.season DESC)
    INTO v_seasons
    FROM (
      SELECT DISTINCT season
      FROM (
        SELECT match.war_season AS season
        FROM public.guild_war_matches AS match
        WHERE match.war_season IS NOT NULL
        UNION
        SELECT snapshot.season
        FROM public.external_war_meta_snapshots AS snapshot
      ) AS all_seasons
      ORDER BY season DESC
      LIMIT GREATEST(p_season_count, 1)
    ) AS available;
  END IF;

  RETURN QUERY
  WITH RECURSIVE latest_external_snapshots AS (
    SELECT DISTINCT ON (
      snapshot.side, snapshot.season, snapshot.battlefield_level
    ) snapshot.id, snapshot.season, snapshot.battlefield_level
    FROM public.external_war_meta_snapshots AS snapshot
    WHERE snapshot.metric_type = 'cores'
      AND snapshot.side = p_side
      AND p_core_size = 3
      AND snapshot.season = ANY(v_seasons)
      AND snapshot.row_count > 0
      AND (
        p_battlefield_levels IS NULL
        OR cardinality(p_battlefield_levels) = 0
        OR snapshot.battlefield_level = ANY(p_battlefield_levels)
      )
    ORDER BY
      snapshot.side,
      snapshot.season,
      snapshot.battlefield_level,
      snapshot.snapshot_at DESC,
      snapshot.imported_at DESC
  ),
  deduplicated_battles AS (
    SELECT DISTINCT ON (COALESCE(battle.event_id::text, battle.id::text))
      COALESCE(battle.event_id::text, battle.id::text) AS battle_id,
      match.war_season,
      match.battlefield_level,
      battle.attacker_units_json,
      battle.defender_units_json,
      battle.attempt_result
    FROM public.guild_war_battles AS battle
    JOIN public.guild_war_matches AS match
      ON match.war_id = battle.war_id
     AND match.guild_code = battle.guild_code
    WHERE match.war_season = ANY(v_seasons)
    ORDER BY
      COALESCE(battle.event_id::text, battle.id::text),
      battle.updated_at DESC,
      battle.guild_code
  ),
  battle_units AS (
    SELECT
      battle.battle_id,
      ARRAY(
        SELECT DISTINCT COALESCE(unit->>'heroKey', unit->>'unitId', unit->>'id')
        FROM jsonb_array_elements(
          CASE WHEN p_side = 'offense'
            THEN battle.attacker_units_json
            ELSE battle.defender_units_json
          END
        ) AS unit
        WHERE COALESCE(unit->>'heroKey', unit->>'unitId', unit->>'id') IS NOT NULL
        ORDER BY 1
      ) AS hero_keys,
      public.global_war_zone_captured(battle.attempt_result::text, battle.defender_units_json) AS captured
    FROM deduplicated_battles AS battle
    WHERE NOT EXISTS (
      SELECT 1
      FROM latest_external_snapshots AS external_slice
      WHERE external_slice.season = battle.war_season
        AND external_slice.battlefield_level = battle.battlefield_level
    )
      AND (
        p_battlefield_levels IS NULL
        OR cardinality(p_battlefield_levels) = 0
        OR battle.battlefield_level = ANY(p_battlefield_levels)
      )
      AND CASE WHEN p_side = 'offense'
        THEN battle.attacker_units_json IS NOT NULL
        ELSE battle.defender_units_json IS NOT NULL
      END
  ),
  own_core_combinations AS (
    SELECT
      battle.battle_id,
      battle.hero_keys,
      battle.captured,
      ARRAY[battle.hero_keys[i]]::text[] AS core_units,
      i AS last_index
    FROM battle_units AS battle
    CROSS JOIN LATERAL generate_series(1, cardinality(battle.hero_keys)) AS i
    WHERE cardinality(battle.hero_keys) >= p_core_size

    UNION ALL

    SELECT
      combination.battle_id,
      combination.hero_keys,
      combination.captured,
      combination.core_units || combination.hero_keys[next_index],
      next_index
    FROM own_core_combinations AS combination
    CROSS JOIN LATERAL generate_series(
      combination.last_index + 1,
      cardinality(combination.hero_keys)
    ) AS next_index
    WHERE cardinality(combination.core_units) < p_core_size
  ),
  own_core_observations AS (
    SELECT
      combination.battle_id,
      combination.hero_keys,
      combination.captured,
      combination.core_units
    FROM own_core_combinations AS combination
    WHERE cardinality(combination.core_units) = p_core_size
  ),
  own_core AS (
    SELECT
      array_to_string(observation.core_units, '|') AS core_key,
      observation.core_units AS unit_ids,
      count(*)::bigint AS uses,
      count(*) FILTER (
        WHERE CASE WHEN p_side = 'offense'
          THEN observation.captured
          ELSE NOT observation.captured
        END
      )::bigint AS wins
    FROM own_core_observations AS observation
    GROUP BY observation.core_units
  ),
  own_flex AS (
    SELECT
      array_to_string(observation.core_units, '|') AS core_key,
      flex.unit_id,
      count(*)::bigint AS uses,
      count(*) FILTER (
        WHERE CASE WHEN p_side = 'offense'
          THEN observation.captured
          ELSE NOT observation.captured
        END
      )::bigint AS wins
    FROM own_core_observations AS observation
    CROSS JOIN LATERAL unnest(observation.hero_keys) AS flex(unit_id)
    WHERE NOT flex.unit_id = ANY(observation.core_units)
    GROUP BY observation.core_units, flex.unit_id
  ),
  external_core AS (
    SELECT external.*
    FROM public.external_war_meta_cores AS external
    WHERE external.snapshot_id IN (SELECT latest.id FROM latest_external_snapshots AS latest)
      AND cardinality(external.unit_ids) = p_core_size
  ),
  combined_core AS (
    SELECT own.core_key, own.unit_ids, own.uses, own.wins FROM own_core AS own
    UNION ALL
    SELECT external.core_key, external.unit_ids, external.uses, external.wins
    FROM external_core AS external
  ),
  merged_core AS (
    SELECT
      combined.core_key,
      combined.unit_ids,
      sum(combined.uses)::bigint AS uses,
      sum(combined.wins)::bigint AS wins
    FROM combined_core AS combined
    GROUP BY combined.core_key, combined.unit_ids
  ),
  external_flex AS (
    SELECT
      external.core_key,
      flex.value->>'heroKey' AS unit_id,
      COALESCE((flex.value->>'uses')::bigint, 0) AS uses,
      COALESCE(
        (flex.value->>'wins')::bigint,
        round(
          COALESCE((flex.value->>'uses')::numeric, 0)
          * COALESCE((flex.value->>'winRate')::numeric, 0) / 100
        )::bigint
      ) AS wins
    FROM external_core AS external
    CROSS JOIN LATERAL jsonb_array_elements(external.flex_options) AS flex(value)
    WHERE flex.value->>'heroKey' IS NOT NULL
  ),
  combined_flex AS (
    SELECT own.core_key, own.unit_id, own.uses, own.wins FROM own_flex AS own
    UNION ALL
    SELECT external.core_key, external.unit_id, external.uses, external.wins
    FROM external_flex AS external
  ),
  merged_flex AS (
    SELECT
      combined.core_key,
      combined.unit_id,
      sum(combined.uses)::bigint AS uses,
      sum(combined.wins)::bigint AS wins
    FROM combined_flex AS combined
    GROUP BY combined.core_key, combined.unit_id
  )
  SELECT
    md5(core.core_key) AS core_id,
    to_jsonb(core.unit_ids) AS core_heroes,
    cardinality(core.unit_ids) AS core_size,
    core.uses AS total_uses,
    core.wins,
    round(core.wins::numeric * 100 / NULLIF(core.uses, 0), 1) AS win_rate,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'heroKey', ranked.unit_id,
          'uses', ranked.uses,
          'frequency', round(ranked.uses::numeric * 100 / NULLIF(core.uses, 0), 1),
          'winRate', round(ranked.wins::numeric * 100 / NULLIF(ranked.uses, 0), 1)
        ) ORDER BY ranked.uses DESC
      )
      FROM (
        SELECT flex.unit_id, flex.uses, flex.wins
        FROM merged_flex AS flex
        WHERE flex.core_key = core.core_key
        ORDER BY flex.uses DESC
        LIMIT 5
      ) AS ranked
    ), '[]'::jsonb) AS flex_options
  FROM merged_core AS core
  WHERE core.uses >= GREATEST(p_min_uses, 1)
  ORDER BY core.uses DESC, win_rate DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_global_war_core_compositions(
  text, integer[], integer[], integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_war_core_compositions(
  text, integer[], integer[], integer, integer, integer, integer
) TO service_role;

COMMIT;

-- target-db: general
-- Visit one qualifying row per season rather than every historical raid row.
-- Rollback: restore get_distinct_seasons_for_guild from the clean baseline.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_distinct_seasons_for_guild(
  p_guild text,
  p_cluster_code text DEFAULT NULL::text
)
RETURNS text[]
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO public, pg_temp
AS $$
  WITH RECURSIVE seasons(s) AS (
    (
      SELECT "Season"
      FROM public."EOT_GR_data"
      WHERE "Guild" = p_guild
        AND "Season" ~ '^\d+$'
        AND (p_cluster_code IS NULL OR cluster_code = p_cluster_code)
      ORDER BY "Season"
      LIMIT 1
    )
    UNION ALL
    SELECT next_season.s
    FROM seasons previous_season
    CROSS JOIN LATERAL (
      SELECT "Season" AS s
      FROM public."EOT_GR_data"
      WHERE "Guild" = p_guild
        AND "Season" > previous_season.s
        AND "Season" ~ '^\d+$'
        AND (p_cluster_code IS NULL OR cluster_code = p_cluster_code)
      ORDER BY "Season"
      LIMIT 1
    ) next_season
  )
  SELECT COALESCE(array_agg(s ORDER BY s::int DESC), ARRAY[]::text[])
  FROM seasons;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

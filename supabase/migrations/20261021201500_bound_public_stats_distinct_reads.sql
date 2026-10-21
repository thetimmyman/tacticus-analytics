-- target-db: general
-- Count distinct names with existing ordered indexes rather than repeated rows.
-- Rollback: restore get_public_stats_live from the clean baseline.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_public_stats_live()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
    stats jsonb;
BEGIN
    WITH RECURSIVE player_names(name) AS (
        (
            SELECT "displayName"
            FROM public."EOT_GR_data"
            WHERE "displayName" IS NOT NULL
            ORDER BY "displayName"
            LIMIT 1
        )
        UNION ALL
        SELECT next_name.name
        FROM player_names previous_name
        CROSS JOIN LATERAL (
            SELECT "displayName" AS name
            FROM public."EOT_GR_data"
            WHERE "displayName" > previous_name.name
            ORDER BY "displayName"
            LIMIT 1
        ) next_name
    ), guild_names(name) AS (
        (
            SELECT "Guild"
            FROM public."EOT_GR_data"
            WHERE "Guild" IS NOT NULL
              AND "Guild" NOT IN ('EOT', 'TEST')
            ORDER BY "Guild"
            LIMIT 1
        )
        UNION ALL
        SELECT next_name.name
        FROM guild_names previous_name
        CROSS JOIN LATERAL (
            SELECT "Guild" AS name
            FROM public."EOT_GR_data"
            WHERE "Guild" > previous_name.name
              AND "Guild" NOT IN ('EOT', 'TEST')
            ORDER BY "Guild"
            LIMIT 1
        ) next_name
    )
    SELECT jsonb_build_object(
        'active_players', (SELECT COUNT(*) FROM player_names),
        'battles_tracked', (
            SELECT COUNT(*) FROM public."EOT_GR_data"
        ),
        'guild_count', (SELECT COUNT(*) FROM guild_names),
        'total_damage', (
            SELECT COALESCE(SUM("damageDealt"::bigint), 0)
            FROM public."EOT_GR_data"
        ),
        'current_season', (
            SELECT MAX(season_num)::text FROM public."EOT_GR_data"
        )
    ) INTO stats;

    RETURN stats;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

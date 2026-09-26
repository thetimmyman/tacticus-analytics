-- pg_stat_statements for this database only; needs pg_read_all_stats or query text is redacted.
-- Usage: psql "$DATABASE_URL" -f <this file>

\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
       AND NOT pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') THEN
        RAISE EXCEPTION
            'pg_stat_statements_scoped: % cannot read other roles'' statement text; run as a superuser or a member of pg_read_all_stats',
            current_user;
    END IF;
END
$$;

-- 1. Stats window: earliest stats_since for this database and its age.
SELECT
    current_database()                        AS database,
    min(stats_since)                          AS stats_since,
    CASE
        WHEN min(stats_since) IS NULL THEN NULL
        ELSE round(EXTRACT(EPOCH FROM (now() - min(stats_since))) / 86400.0, 2)
    END                                       AS stats_age_days
FROM extensions.pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database());

-- 2. Per-statement rows for this database, with the refresh-target check.
WITH scoped AS (
    SELECT
        current_database()    AS database,
        queryid,
        query,
        calls,
        total_exec_time,
        mean_exec_time,
        rows,
        stats_since
    FROM extensions.pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
),
refreshes AS (
    -- Raw target text: one identifier or a schema-qualified pair, quoted or bare.
    SELECT DISTINCT
        queryid,
        (regexp_match(
            query,
            '^\s*refresh\s+materialized\s+view\s+(?:concurrently\s+)?'
            || '((?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)'
            || '(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*))?)',
            'i'
        ))[1] AS target_raw
    FROM scoped
    WHERE query ~* '^\s*refresh\s+materialized\s+view'
),
refresh_targets AS (
    SELECT
        r.queryid,
        r.target_raw,
        parse_ident(r.target_raw, false) AS parts
    FROM refreshes r
    WHERE r.target_raw IS NOT NULL
),
resolved AS (
    SELECT
        t.queryid,
        t.target_raw,
        CASE WHEN array_length(t.parts, 1) = 2 THEN t.parts[1] END AS target_schema,
        t.parts[array_length(t.parts, 1)]                            AS target_name,
        (
            SELECT count(*)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'm'
              AND c.relname = t.parts[array_length(t.parts, 1)]
              AND (array_length(t.parts, 1) = 1 OR n.nspname = t.parts[1])
        ) AS candidates
    FROM refresh_targets t
),
flagged AS (
    SELECT
        r.queryid,
        r.target_raw,
        CASE
            WHEN r.candidates = 1 AND r.target_schema IS NOT NULL THEN 'ok'
            WHEN r.candidates = 1 THEN 'ok (unqualified)'
            WHEN r.candidates > 1 THEN 'AMBIGUOUS'
            WHEN EXISTS (
                     SELECT 1 FROM cron.job j
                     WHERE position(lower(r.target_name) IN lower(j.command)) > 0
                 )
              OR EXISTS (
                     SELECT 1 FROM pg_proc p
                     WHERE position(lower(r.target_name) IN lower(p.prosrc)) > 0
                 )
            THEN 'ABSENT_STILL_REFERENCED'
            ELSE 'ABSENT_HISTORICAL'
        END AS refresh_target_status
    FROM resolved r
)
SELECT
    s.database,
    s.queryid,
    s.query,
    s.calls,
    s.total_exec_time,
    s.mean_exec_time,
    s.rows,
    s.stats_since,
    f.target_raw              AS refresh_target,
    f.refresh_target_status
FROM scoped s
LEFT JOIN flagged f
    ON f.queryid = s.queryid
ORDER BY
    CASE f.refresh_target_status
        WHEN 'ABSENT_STILL_REFERENCED' THEN 0
        WHEN 'AMBIGUOUS' THEN 1
        WHEN 'ABSENT_HISTORICAL' THEN 2
        ELSE 3
    END,
    s.total_exec_time DESC;

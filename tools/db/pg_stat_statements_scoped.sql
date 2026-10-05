-- pg_stat_statements for this database only; needs pg_read_all_stats or query text is redacted.
-- Usage: psql "$DATABASE_URL" -f <this file>
-- Cron absence or unreadable cron.job is reported as CRON_UNAVAILABLE, never inferred as historical.

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

-- 2. Count before returning details, so the 100-row bound is visible even for empty results.
SELECT
    count(*)                                  AS rows_total,
    least(count(*), 100)                      AS rows_returned,
    greatest(count(*) - 100, 0)               AS rows_omitted
FROM extensions.pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
\gset scoped_
\echo Scoped statement rows: :scoped_rows_total total; :scoped_rows_returned returned; :scoped_rows_omitted omitted (limit 100).

-- psql selects a safe relation expression only after checking relation presence,
-- schema USAGE, and table SELECT. The fallback is valid even when cron is absent.
WITH cron_relation AS (
    SELECT
        schema_oid,
        (SELECT c.oid
         FROM pg_catalog.pg_class c
         WHERE c.relnamespace = schema_oid
           AND c.relname = 'job') AS relation_oid
    FROM (
        SELECT (SELECT n.oid FROM pg_catalog.pg_namespace n WHERE n.nspname = 'cron') AS schema_oid
    ) AS cron_schema
), cron_access AS (
    SELECT
        CASE
            WHEN relation_oid IS NULL THEN false
            WHEN NOT pg_catalog.has_schema_privilege(current_user, schema_oid, 'USAGE') THEN false
            ELSE pg_catalog.has_table_privilege(current_user, relation_oid, 'SELECT')
        END AS readable
    FROM cron_relation
)
SELECT
    CASE WHEN readable
         THEN '(SELECT command FROM cron.job)'
         ELSE '(SELECT CAST(NULL AS text) AS command WHERE false)'
    END AS cron_commands_relation,
    readable AS cron_readable
FROM cron_access
\gset

WITH scoped AS (
    SELECT
        current_database()    AS database,
        dbid,
        userid,
        toplevel,
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
        dbid,
        userid,
        toplevel,
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
        r.dbid,
        r.userid,
        r.toplevel,
        r.queryid,
        r.target_raw,
        parse_ident(r.target_raw, false) AS parts
    FROM refreshes r
    WHERE r.target_raw IS NOT NULL
),
resolved AS (
    SELECT
        t.dbid,
        t.userid,
        t.toplevel,
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
        r.dbid,
        r.userid,
        r.toplevel,
        r.queryid,
        r.target_raw,
        CASE
            WHEN r.candidates = 1 AND r.target_schema IS NOT NULL THEN 'ok'
            WHEN r.candidates = 1 THEN 'ok (unqualified)'
            WHEN r.candidates > 1 THEN 'AMBIGUOUS'
            WHEN NOT :'cron_readable'::boolean AND NOT EXISTS (
                     SELECT 1 FROM pg_proc p
                     WHERE position(lower(r.target_name) IN lower(p.prosrc)) > 0
                 )
            THEN 'CRON_UNAVAILABLE'
            WHEN EXISTS (
                     SELECT 1
                     FROM :cron_commands_relation AS j
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
    left(s.query, 2048)        AS query,
    length(s.query) > 2048     AS query_truncated,
    s.calls,
    s.total_exec_time,
    s.mean_exec_time,
    s.rows,
    s.stats_since,
    f.target_raw              AS refresh_target,
    f.refresh_target_status
FROM scoped s
LEFT JOIN flagged f
    ON f.dbid = s.dbid
   AND f.userid = s.userid
   AND f.toplevel = s.toplevel
   AND f.queryid IS NOT DISTINCT FROM s.queryid
ORDER BY
    CASE f.refresh_target_status
        WHEN 'ABSENT_STILL_REFERENCED' THEN 0
        WHEN 'CRON_UNAVAILABLE' THEN 1
        WHEN 'AMBIGUOUS' THEN 2
        WHEN 'ABSENT_HISTORICAL' THEN 3
        ELSE 4
    END,
    s.total_exec_time DESC
LIMIT 100;

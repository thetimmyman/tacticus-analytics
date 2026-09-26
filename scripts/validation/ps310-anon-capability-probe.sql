-- What anon can actually read, including column-only grants has_table_privilege misses. Read-only
-- (ends in ROLLBACK). LEG D is the positive control: without its PASS, legs A-C mean nothing.

BEGIN;

SET LOCAL statement_timeout = '120s';

CREATE TEMP TABLE _ps310_cap (
  relname       text,
  relkind       "char",
  observed      text,
  pred_by_table boolean,
  pred_by_col   boolean,
  owner_rows    boolean
) ON COMMIT DROP;

DO $ps310$
DECLARE r record; n bigint; obs text; orows boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'PS-310: role "anon" does not exist here; nothing to probe.';
    RETURN;
  END IF;

  -- SET LOCAL ROLE in an exception-wrapped sub-block, not a helper: a default ACL revokes EXECUTE on new
  -- functions from PUBLIC, so a pg_temp function would abort the run. `SELECT 1 FROM rel` names no column
  -- so Postgres runs the "any column" check, the only one that sees a column-only grant.
  FOR r IN
    SELECT c.oid, c.relname::text AS relname, c.relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('r','v','m','p')
    ORDER BY c.relname
  LOOP
    -- On a caught error the subtransaction rolls back SET LOCAL; RESET ROLE below covers the success path.
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I LIMIT 1) t', r.relname)
        INTO n;
      obs := CASE WHEN n > 0 THEN 'ROWS' ELSE 'ALLOWED_ZERO' END;
    EXCEPTION
      WHEN insufficient_privilege THEN obs := 'DENIED';
      WHEN OTHERS THEN obs := 'OTHER_' || SQLSTATE;
    END;
    RESET ROLE;

    BEGIN
      EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I LIMIT 1) t', r.relname)
        INTO n;
      orows := n > 0;
    EXCEPTION WHEN OTHERS THEN orows := NULL;
    END;
    INSERT INTO _ps310_cap VALUES (
      r.relname, r.relkind, obs,
      has_table_privilege('anon', r.oid, 'SELECT'),
      has_any_column_privilege('anon', r.oid, 'SELECT'),
      orows
    );
  END LOOP;
END
$ps310$;

\echo ''
\echo '===== PS-310 LEG A — anon capability, and what the table predicate alone would have seen ====='
SELECT
  count(*)                                                   AS public_relations,
  count(*) FILTER (WHERE observed <> 'DENIED')               AS anon_capable,
  count(*) FILTER (WHERE pred_by_table)                      AS seen_by_table_predicate,
  count(*) FILTER (WHERE NOT pred_by_table AND pred_by_col)  AS seen_only_by_column_predicate
FROM _ps310_cap;

\echo '-- relations the table-level predicate is blind to (the PS-310 class) --'
SELECT relname, relkind, observed, pred_by_table, pred_by_col
FROM _ps310_cap
WHERE NOT pred_by_table AND pred_by_col
ORDER BY relname;

\echo '-- disagreements between observed capability and the combined prediction (expect none) --'
SELECT relname, relkind, observed, pred_by_table, pred_by_col
FROM _ps310_cap
WHERE (observed <> 'DENIED') IS DISTINCT FROM (pred_by_table OR pred_by_col)
ORDER BY relname;

\echo ''
\echo '===== PS-310 LEG B — relations from which anon actually retrieves rows ====='
SELECT relname, relkind, observed
FROM _ps310_cap
WHERE observed = 'ROWS'
ORDER BY relname;

\echo '-- probe errors other than a clean 42501 denial (investigate any row here) --'
SELECT relname, relkind, observed FROM _ps310_cap
WHERE observed LIKE 'OTHER!_%' ESCAPE '!' ORDER BY relname;

\echo ''
\echo '===== PS-310 LEG C — every anon/PUBLIC column-level SELECT grant ====='
\echo '-- the reviewed exception is guild_config(cluster_code, display_name, enabled,'
\echo '-- guild_code, guild_tag, onboarding_completed, short_code). Anything else is new. --'
SELECT ns.nspname AS schema, c.relname AS relation,
       COALESCE(rr.rolname, 'PUBLIC') AS grantee,
       string_agg(a.attname, ', ' ORDER BY a.attname) AS columns
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN LATERAL aclexplode(a.attacl) x
LEFT JOIN pg_catalog.pg_roles rr ON rr.oid = x.grantee
WHERE a.attacl IS NOT NULL
  AND ns.nspname NOT LIKE 'pg\_%'
  AND ns.nspname <> 'information_schema'
  AND x.privilege_type = 'SELECT'
  AND COALESCE(rr.rolname, 'PUBLIC') IN ('anon', 'PUBLIC')
GROUP BY ns.nspname, c.relname, COALESCE(rr.rolname, 'PUBLIC')
ORDER BY 1, 2, 3;

\echo ''
\echo '===== PS-310 LEG D — positive control ====='
\echo '-- PASS requires all three: the probe denied something, allowed something,'
\echo '-- and at least one DENIED relation is non-empty (so the denial is real). --'
SELECT
  count(*) FILTER (WHERE observed = 'DENIED')                    AS denied,
  count(*) FILTER (WHERE observed <> 'DENIED')                   AS allowed,
  count(*) FILTER (WHERE observed = 'DENIED' AND owner_rows)     AS denied_and_non_empty,
  CASE WHEN count(*) FILTER (WHERE observed = 'DENIED') > 0
        AND count(*) FILTER (WHERE observed <> 'DENIED') > 0
        AND count(*) FILTER (WHERE observed = 'DENIED' AND owner_rows) > 0
       THEN 'PASS' ELSE 'FAIL — treat LEG A and LEG B as unproven' END AS control
FROM _ps310_cap;

ROLLBACK;

-- No public serial/identity sequence sits at or below its column max. Manual acceptance for General.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(2);

-- A never-called sequence returns last_value itself, not last_value + 1.
CREATE TEMP VIEW ps329_owned_sequences AS
SELECT sn.nspname || '.' || s.relname AS seq_label,
       t.relname || '.' || a.attname   AS col_label,
       (xpath(
          '/row/v/text()',
          query_to_xml(
            format('SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END AS v FROM %I.%I',
                   sn.nspname, s.relname),
            false, true, '')
        ))[1]::text::bigint AS next_value,
       (xpath(
          '/row/v/text()',
          query_to_xml(
            format('SELECT max(%I) AS v FROM %I.%I', a.attname, tn.nspname, t.relname),
            true, true, '')
        ))[1]::text::bigint AS col_max
FROM pg_class AS s
JOIN pg_namespace AS sn ON sn.oid = s.relnamespace
JOIN pg_depend AS d
  ON d.objid = s.oid
 AND d.classid = 'pg_class'::regclass
 AND d.deptype IN ('a', 'i')
JOIN pg_class AS t ON t.oid = d.refobjid
JOIN pg_namespace AS tn ON tn.oid = t.relnamespace
JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
WHERE s.relkind = 'S'
  AND sn.nspname = 'public'
  AND tn.nspname = 'public'
  AND t.relkind IN ('r', 'p');

-- Positive control: an empty scan would pass vacuously.
SELECT cmp_ok(
  (SELECT count(*)::integer FROM ps329_owned_sequences),
  '>',
  0,
  'positive control: the scan examines at least one public sequence owned by a public column'
);

SELECT is(
  (
    SELECT coalesce(
             string_agg(
               format('%s (owns %s): next %s <= max %s', seq_label, col_label, next_value, col_max),
               '; ' ORDER BY seq_label
             ),
             ''
           )
    FROM ps329_owned_sequences
    WHERE col_max IS NOT NULL
      AND next_value <= col_max
  ),
  '',
  'no public sequence would hand out an id its own column already holds'
);

SELECT * FROM finish();
ROLLBACK;

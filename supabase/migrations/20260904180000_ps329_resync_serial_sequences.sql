-- Advance every public serial/identity sequence at or below its column max to
-- that max, so default-id INSERTs stop colliding. Forward-only and idempotent.
-- target-db: general

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-329 targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END
$$;

DO $$
DECLARE
  v_seq         record;
  v_last        bigint;
  v_called      boolean;
  v_max         bigint;
  v_next        bigint;
  v_after       bigint;
  v_fixed       integer := 0;
  v_examined    integer := 0;
BEGIN
  FOR v_seq IN
    SELECT quote_ident(sn.nspname) || '.' || quote_ident(s.relname) AS seq,
           quote_ident(tn.nspname) || '.' || quote_ident(t.relname) AS tbl,
           quote_ident(a.attname)                                   AS col,
           sn.nspname || '.' || s.relname                            AS seq_label,
           t.relname || '.' || a.attname                             AS col_label
    FROM pg_class AS s
    JOIN pg_namespace AS sn ON sn.oid = s.relnamespace
    JOIN pg_depend AS d
      ON d.objid = s.oid
     AND d.classid = 'pg_class'::regclass
     AND d.deptype IN ('a', 'i')
    JOIN pg_class AS t ON t.oid = d.refobjid
    JOIN pg_namespace AS tn ON tn.oid = t.relnamespace
    JOIN pg_attribute AS a
      ON a.attrelid = t.oid
     AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S'
      AND sn.nspname = 'public'
      AND tn.nspname = 'public'
      AND t.relkind IN ('r', 'p')
    ORDER BY 4
  LOOP
    v_examined := v_examined + 1;

    EXECUTE format('SELECT last_value, is_called FROM %s', v_seq.seq)
      INTO v_last, v_called;
    EXECUTE format('SELECT max(%s) FROM %s', v_seq.col, v_seq.tbl)
      INTO v_max;

    -- Empty table: the sequence cannot be behind anything.
    CONTINUE WHEN v_max IS NULL;

    -- The value the next nextval() would hand out. A sequence that has never
    -- been called returns last_value itself, not last_value + 1.
    v_next := v_last + CASE WHEN v_called THEN 1 ELSE 0 END;

    CONTINUE WHEN v_next > v_max;

    v_after := GREATEST(v_last, v_max);
    PERFORM setval(v_seq.seq::regclass, v_after, true);
    v_fixed := v_fixed + 1;

    RAISE NOTICE
      'PS-329: % (owns %) was at last_value=% is_called=% -> next would be %, column max is %; setval to % (is_called=true)',
      v_seq.seq_label, v_seq.col_label, v_last, v_called, v_next, v_max, v_after;
  END LOOP;

  IF v_examined = 0 THEN
    RAISE EXCEPTION
      'PS-329: examined 0 public sequences -- the scan found nothing to check, which cannot be right';
  END IF;

  IF v_fixed = 0 THEN
    RAISE NOTICE
      'PS-329: examined % public sequence(s); none was behind its column max, nothing changed',
      v_examined;
  ELSE
    RAISE NOTICE
      'PS-329: examined % public sequence(s); resynced %',
      v_examined, v_fixed;
  END IF;
END
$$;

DO $$
DECLARE
  v_seq       record;
  v_last      bigint;
  v_called    boolean;
  v_max       bigint;
  v_next      bigint;
  v_behind    text[] := ARRAY[]::text[];
  v_examined  integer := 0;
BEGIN
  FOR v_seq IN
    SELECT quote_ident(sn.nspname) || '.' || quote_ident(s.relname) AS seq,
           quote_ident(tn.nspname) || '.' || quote_ident(t.relname) AS tbl,
           quote_ident(a.attname)                                   AS col,
           sn.nspname || '.' || s.relname                            AS seq_label
    FROM pg_class AS s
    JOIN pg_namespace AS sn ON sn.oid = s.relnamespace
    JOIN pg_depend AS d
      ON d.objid = s.oid
     AND d.classid = 'pg_class'::regclass
     AND d.deptype IN ('a', 'i')
    JOIN pg_class AS t ON t.oid = d.refobjid
    JOIN pg_namespace AS tn ON tn.oid = t.relnamespace
    JOIN pg_attribute AS a
      ON a.attrelid = t.oid
     AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S'
      AND sn.nspname = 'public'
      AND tn.nspname = 'public'
      AND t.relkind IN ('r', 'p')
  LOOP
    v_examined := v_examined + 1;

    EXECUTE format('SELECT last_value, is_called FROM %s', v_seq.seq)
      INTO v_last, v_called;
    EXECUTE format('SELECT max(%s) FROM %s', v_seq.col, v_seq.tbl)
      INTO v_max;

    CONTINUE WHEN v_max IS NULL;

    v_next := v_last + CASE WHEN v_called THEN 1 ELSE 0 END;
    IF v_next <= v_max THEN
      v_behind := v_behind || format('%s (next %s <= max %s)', v_seq.seq_label, v_next, v_max);
    END IF;
  END LOOP;

  IF v_examined = 0 THEN
    RAISE EXCEPTION 'PS-329 VERIFY: examined 0 public sequences';
  END IF;

  IF array_length(v_behind, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PS-329 VERIFY FAILED: % sequence(s) still behind: %',
      array_length(v_behind, 1), array_to_string(v_behind, '; ');
  END IF;

  RAISE NOTICE 'PS-329 VERIFY: % public sequence(s) examined, 0 behind', v_examined;
END
$$;

COMMIT;

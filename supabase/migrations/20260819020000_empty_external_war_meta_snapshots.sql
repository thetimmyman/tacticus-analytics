-- An empty external snapshot is authoritative: the newest wins over archive and raw rows.

DO $migration$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_revised_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_global_war_lineup_stats(text,integer[],integer[],integer,integer,integer)'::regprocedure,
    'public.get_global_war_core_compositions(text,integer[],integer[],integer,integer,integer,integer)'::regprocedure
  ]
  LOOP
    v_definition := pg_get_functiondef(v_signature);
    v_revised_definition := regexp_replace(
      v_definition,
      E'\\n[[:space:]]+AND snapshot\\.row_count > 0',
      '',
      'g'
    );

    IF v_revised_definition = v_definition
       OR v_revised_definition LIKE '%snapshot.row_count > 0%' THEN
      RAISE EXCEPTION 'expected row_count predicate was not replaced in %', v_signature;
    END IF;

    EXECUTE v_revised_definition;
  END LOOP;
END;
$migration$;

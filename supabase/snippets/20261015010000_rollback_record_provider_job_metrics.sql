-- target-db: general
-- Restore captured predecessor functions; retain all recorded measurements.
BEGIN;
DO $rollback$
DECLARE saved text[]; statement text; installed jsonb;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Provider job rollback requires database postgres';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.complete_job(uuid,text,jsonb,jsonb)'))
       IS DISTINCT FROM '6d4594dd02bdd2363f7374e776f96afe'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fail_job(uuid,text,text,jsonb)'))
       IS DISTINCT FROM '6a0a8afd2fea18422de38605cb9b1142' THEN
    RAISE EXCEPTION 'Job terminal contract changed after apply; inspect before rollback';
  END IF;
  SELECT statements INTO saved FROM supabase_migrations.schema_migrations
  WHERE version='20261015010000' AND name='record_provider_job_metrics';
  IF cardinality(saved) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Provider job rollback state missing';
  END IF;
  SELECT jsonb_object_agg(p.proname,
    md5(jsonb_build_array(pg_get_functiondef(p.oid), p.proowner, p.proacl)::text))
  INTO installed
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN ('public.complete_job(uuid,text,jsonb,jsonb)'::regprocedure,
                  'public.fail_job(uuid,text,text,jsonb)'::regprocedure);
  IF installed IS DISTINCT FROM saved[3]::jsonb THEN
    RAISE EXCEPTION 'Job terminal authority or definition changed after apply; inspect before rollback';
  END IF;
  FOREACH statement IN ARRAY saved[1:2] LOOP EXECUTE statement; END LOOP;
  DELETE FROM supabase_migrations.schema_migrations WHERE version='20261015010000';
END;
$rollback$;
NOTIFY pgrst, 'reload schema';
COMMIT;

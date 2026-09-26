-- One transaction so a bulk ban repair is never partially durable.

CREATE OR REPLACE FUNCTION public.enqueue_user_ban_reconciliation_jobs(
  p_jobs jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_inserted integer := 0;
  v_job jsonb;
  v_payload jsonb;
  v_lock_ids jsonb;
  v_admin_ids jsonb;
  v_credential_ids jsonb;
  v_user_id text;
  v_base_dedupe_key text;
  v_insert_dedupe_key text;
BEGIN
  IF p_jobs IS NULL OR jsonb_typeof(p_jobs) <> 'array' THEN
    RAISE EXCEPTION 'p_jobs must be a JSON array';
  END IF;
  IF jsonb_array_length(p_jobs) < 1 OR jsonb_array_length(p_jobs) > 500 THEN
    RAISE EXCEPTION 'p_jobs must contain 1-500 jobs';
  END IF;

  FOR v_job IN SELECT value FROM jsonb_array_elements(p_jobs)
  LOOP
    IF jsonb_typeof(v_job) IS DISTINCT FROM 'object'
       OR (v_job->>'dedupeKey') IS NULL
       OR (v_job->>'dedupeKey') !~ '^user-ban-reconcile:[0-9a-f]{64}$'
       OR jsonb_typeof(v_job->'payload') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid user-ban reconciliation job';
    END IF;

    v_payload := v_job->'payload';
    v_lock_ids := v_payload->'lockUserIds';
    v_admin_ids := v_payload->'adminCandidateUserIds';
    v_credential_ids := v_payload->'credentialUserIds';
    IF jsonb_typeof(v_lock_ids) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_admin_ids) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_credential_ids) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'each reconciliation payload must contain identity arrays';
    END IF;
    IF jsonb_array_length(v_lock_ids) <> 1
       OR jsonb_array_length(v_admin_ids) > 1
       OR jsonb_array_length(v_credential_ids) > 1 THEN
      RAISE EXCEPTION 'each reconciliation job must contain one identity';
    END IF;

    v_user_id := v_lock_ids->>0;
    IF v_user_id IS NULL
       OR v_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (jsonb_array_length(v_admin_ids) = 1 AND v_admin_ids->>0 <> v_user_id)
       OR (jsonb_array_length(v_credential_ids) = 1 AND v_credential_ids->>0 <> v_user_id) THEN
      RAISE EXCEPTION 'invalid reconciliation identity payload';
    END IF;
  END LOOP;

  -- Serialize enqueues per identity family. A pending row is durable coverage
  -- for the state that already exists when this function is called. A
  -- processing row is not: its handler may have released the user lock after
  -- reconciling an older state but may not yet have completed the queue row.
  -- In that window, preserve the later repair as a distinct pending successor.
  FOR v_job IN
    SELECT value
    FROM jsonb_array_elements(p_jobs)
    ORDER BY value->>'dedupeKey'
  LOOP
    v_base_dedupe_key := v_job->>'dedupeKey';
    PERFORM pg_advisory_xact_lock(hashtextextended(v_base_dedupe_key, 7900));

    IF EXISTS (
      SELECT 1
      FROM public.work_queue
      WHERE status = 'pending'
        AND (
          dedupe_key = v_base_dedupe_key
          OR dedupe_key LIKE v_base_dedupe_key || ':successor:%'
        )
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.work_queue
      WHERE status = 'processing'
        AND (
          dedupe_key = v_base_dedupe_key
          OR dedupe_key LIKE v_base_dedupe_key || ':successor:%'
        )
    ) THEN
      v_insert_dedupe_key :=
        v_base_dedupe_key || ':successor:' || gen_random_uuid()::text;
    ELSE
      v_insert_dedupe_key := v_base_dedupe_key;
    END IF;

    INSERT INTO public.work_queue (
      job_type,
      job_class,
      payload,
      dedupe_key,
      priority,
      max_attempts
    ) VALUES (
      'user-ban-reconcile',
      'verify',
      v_job->'payload',
      v_insert_dedupe_key,
      1,
      32767
    )
    ON CONFLICT (dedupe_key)
      WHERE status IN ('pending', 'processing')
      DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$function$;

ALTER FUNCTION public.enqueue_user_ban_reconciliation_jobs(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_user_ban_reconciliation_jobs(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_user_ban_reconciliation_jobs(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.enqueue_user_ban_reconciliation_jobs(jsonb) IS
  'Atomically enqueues one independently deduplicated verify-class user-ban reconciliation job per identity, preserving a pending successor behind processing work.';

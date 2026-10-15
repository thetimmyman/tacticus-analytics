-- target-db: general
-- Preserve physical provider measurements in the existing job metrics.
-- Terminal transitions lock the owned processing row, so replay cannot double count.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Provider job measurements require database postgres';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid IN (to_regprocedure('public.complete_job(uuid,text,jsonb,jsonb)'),
                  to_regprocedure('public.fail_job(uuid,text,text,jsonb)'))
      AND (prosecdef OR proconfig IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Job function authority drifted; inspect before applying measurements';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.complete_job(uuid,text,jsonb,jsonb)'))
       IS DISTINCT FROM 'bc50fd9768db5fd90306b6bcf440f1b1'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fail_job(uuid,text,text,jsonb)'))
       IS DISTINCT FROM '3d63c61f3124312d6348efc940016b7e' THEN
    RAISE EXCEPTION 'Job terminal contract drifted; inspect before applying measurements';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('20261015010000', 'record_provider_job_metrics', ARRAY[
  pg_get_functiondef('public.complete_job(uuid,text,jsonb,jsonb)'::regprocedure),
  pg_get_functiondef('public.fail_job(uuid,text,text,jsonb)'::regprocedure)
]);

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_worker_id text, p_progress jsonb DEFAULT '{}'::jsonb, p_metrics jsonb DEFAULT '{}'::jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_guild_code TEXT;
  v_job_type TEXT;
  v_started_at TIMESTAMPTZ;
BEGIN
  IF COALESCE((p_metrics->>'api_calls')::INT, 0) < 0
    OR COALESCE((p_metrics->>'api_errors')::INT, 0) NOT BETWEEN 0 AND COALESCE((p_metrics->>'api_calls')::INT, 0)
    OR COALESCE((p_metrics->>'api_retry_count')::INT, 0) NOT BETWEEN 0 AND COALESCE((p_metrics->>'api_calls')::INT, 0) THEN
    RAISE EXCEPTION 'Invalid provider measurements';
  END IF;
  SELECT guild_code, job_type, started_at
  INTO v_guild_code, v_job_type, v_started_at
  FROM sync_queue
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE sync_queue
  SET
    status = 'completed',
    completed_at = NOW(),
    progress = p_progress,
    updated_at = NOW()
  WHERE id = p_job_id;

  IF v_job_type IN ('full_sync', 'incremental_sync', 'realtime_sync') THEN
    UPDATE guild_sync_status
    SET
      last_sync = NOW(),
      status = 'completed',
      records_synced = COALESCE((p_progress->>'records_processed')::INT, 0),
      error_message = NULL,
      last_error = NULL,
      updated_at = NOW()
    WHERE guild_code = v_guild_code;

    IF v_job_type = 'full_sync' THEN
      UPDATE guild_sync_status
      SET
        full_sync_at = NOW(),
        full_sync_success = TRUE
      WHERE guild_code = v_guild_code;
    END IF;
  ELSE
    UPDATE guild_sync_status
    SET
      status = 'completed',
      error_message = NULL,
      last_error = NULL,
      updated_at = NOW()
    WHERE guild_code = v_guild_code;
  END IF;

  INSERT INTO sync_metrics (
    guild_code, job_id, job_type,
    processing_time_ms,
    records_processed,
    players_updated,
    api_calls, api_errors, api_retry_count,
    success
  ) VALUES (
    v_guild_code, p_job_id, v_job_type,
    EXTRACT(EPOCH FROM (NOW() - v_started_at)) * 1000,
    COALESCE((p_metrics->>'records_processed')::INT, 0),
    COALESCE((p_metrics->>'players_updated')::INT, 0),
    COALESCE((p_metrics->>'api_calls')::INT, 0),
    COALESCE((p_metrics->>'api_errors')::INT, 0),
    COALESCE((p_metrics->>'api_retry_count')::INT, 0),
    TRUE
  );

  PERFORM update_sync_health(v_guild_code, TRUE);

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_job(p_job_id uuid, p_worker_id text, p_error text, p_progress jsonb DEFAULT '{}'::jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_guild_code TEXT;
  v_job_type TEXT;
  v_started_at TIMESTAMPTZ;
  v_attempts INTEGER;
  v_max_attempts INTEGER;
  v_jitter_seconds INTEGER;
BEGIN
  IF COALESCE((p_progress->>'api_calls')::INT, 0) < 0
    OR COALESCE((p_progress->>'api_errors')::INT, 0) NOT BETWEEN 0 AND COALESCE((p_progress->>'api_calls')::INT, 0)
    OR COALESCE((p_progress->>'api_retry_count')::INT, 0) NOT BETWEEN 0 AND COALESCE((p_progress->>'api_calls')::INT, 0) THEN
    RAISE EXCEPTION 'Invalid provider measurements';
  END IF;
  -- Get job details
  SELECT guild_code, attempts, max_attempts, job_type, started_at
  INTO v_guild_code, v_attempts, v_max_attempts, v_job_type, v_started_at
  FROM sync_queue
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Append error to log
  UPDATE sync_queue
  SET
    error_log = error_log || jsonb_build_array(jsonb_build_object(
      'attempt', v_attempts,
      'error', p_error,
      'timestamp', NOW()
    )),
    progress = p_progress,
    updated_at = NOW()
  WHERE id = p_job_id;

  -- Check if we should retry
  IF v_attempts < v_max_attempts THEN
    -- Calculate jitter: random 0-30 seconds
    v_jitter_seconds := floor(random() * 30)::INTEGER;

    -- Schedule retry with exponential backoff + jitter
    -- Base: attempts * 1 minute, plus 0-30 seconds jitter
    UPDATE sync_queue
    SET
      status = 'pending',
      worker_id = NULL,
      started_at = NULL,
      scheduled_for = NOW() + (v_attempts * INTERVAL '1 minute') + (v_jitter_seconds * INTERVAL '1 second')
    WHERE id = p_job_id;
  ELSE
    -- Max attempts reached, mark as failed
    UPDATE sync_queue
    SET
      status = 'failed',
      completed_at = NOW()
    WHERE id = p_job_id;

    -- Update guild_sync_status
    UPDATE guild_sync_status
    SET
      status = 'error',
      error_message = p_error,
      last_error = p_error,
      updated_at = NOW()
    WHERE guild_code = v_guild_code;
  END IF;

  INSERT INTO sync_metrics (
    guild_code, job_id, job_type, processing_time_ms,
    records_processed, players_updated, api_calls, api_errors, api_retry_count,
    success, error_message
  ) VALUES (
    v_guild_code, p_job_id, v_job_type,
    EXTRACT(EPOCH FROM (NOW() - v_started_at)) * 1000,
    COALESCE((p_progress->>'records_processed')::INT, 0),
    COALESCE((p_progress->>'players_updated')::INT, 0),
    COALESCE((p_progress->>'api_calls')::INT, 0),
    COALESCE((p_progress->>'api_errors')::INT, 0),
    COALESCE((p_progress->>'api_retry_count')::INT, 0),
    FALSE, 'Job execution failed'
  );

  -- Update health metrics
  PERFORM update_sync_health(v_guild_code, FALSE);

  RETURN TRUE;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

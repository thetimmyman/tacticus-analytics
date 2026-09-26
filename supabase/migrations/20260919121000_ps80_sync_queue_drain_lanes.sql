-- target-db: general
-- Measure the sync_queue drain each run and alert when it cannot catch up.
-- claim_next_job claims SKIP LOCKED, so parallel lanes need no new locking.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

DO $precondition$
BEGIN
  IF to_regclass('public.sync_queue') IS NULL THEN
    RAISE EXCEPTION 'PS-80: public.sync_queue does not exist; refusing to run';
  END IF;

  -- The whole design rests on the claim already being exclusive. If
  -- claim_next_job ever loses SKIP LOCKED, lanes become a double-processing
  -- bug and this migration must not be the thing that hides it.
  IF to_regprocedure('public.claim_next_job(text, text[])') IS NULL THEN
    RAISE EXCEPTION
      'PS-80: public.claim_next_job(text, text[]) is absent; the drain has no claim-based consumer and lanes cannot be made safe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'claim_next_job'
       AND pg_get_functiondef(p.oid) ~* 'FOR\s+UPDATE\s+SKIP\s+LOCKED'
  ) THEN
    RAISE EXCEPTION
      'PS-80: public.claim_next_job no longer claims FOR UPDATE SKIP LOCKED; parallel drain lanes would double-process. Refusing to run.';
  END IF;

  IF to_regprocedure('monitoring.notify(text, text, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION
      'PS-80: monitoring.notify is absent; an alert with no notifier is an orphan';
  END IF;
END;
$precondition$;

-- One row per run: per-job sync_metrics cannot show a run that drained nothing.

CREATE TABLE IF NOT EXISTS public.sync_drain_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ran_at timestamp with time zone DEFAULT now() NOT NULL,
  worker_id text NOT NULL,
  lanes integer NOT NULL,
  budget_ms integer NOT NULL,
  window_ms integer NOT NULL,
  duration_ms integer NOT NULL,
  jobs_drained integer DEFAULT 0 NOT NULL,
  queue_depth_start integer,
  oldest_pending_age_seconds integer,
  saturated boolean DEFAULT false NOT NULL,
  per_lane jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT sync_drain_runs_pkey PRIMARY KEY (id),
  CONSTRAINT sync_drain_runs_lanes_check CHECK (lanes >= 1),
  CONSTRAINT sync_drain_runs_duration_check CHECK (duration_ms >= 0),
  CONSTRAINT sync_drain_runs_window_check CHECK (window_ms >= 0)
);

COMMENT ON TABLE public.sync_drain_runs IS
  'PS-80: one row per sync_queue drain invocation. duration_ms against window_ms is the "drain duration vs window" measurement made continuous; queue_depth_start and oldest_pending_age_seconds are sampled BEFORE the lanes run. Written only by record_sync_drain_run().';
COMMENT ON COLUMN public.sync_drain_runs.window_ms IS
  'PS-80: usable drain window per lane = WORKER_CONFIG.workerTimeout - laneTailReserveMs (45s - 5s = 40s). NOT a statement_timeout and not the cron minute.';
COMMENT ON COLUMN public.sync_drain_runs.saturated IS
  'PS-80: true when at least one lane stopped because its window closed rather than because the queue was empty. A run that is saturated had more work than window.';
COMMENT ON COLUMN public.sync_drain_runs.queue_depth_start IS
  'PS-80: pending sync_queue rows sampled at the start of the run. NULL means not measured, which the monitor must not read as zero.';

CREATE INDEX IF NOT EXISTS idx_sync_drain_runs_ran_at
  ON public.sync_drain_runs USING btree (ran_at DESC);

-- No policy: fail-closed for clients, reached via definers and service_role.
ALTER TABLE public.sync_drain_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sync_drain_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.sync_drain_runs TO service_role;

-- DEFINER to avoid depending on RLS; never raises, so it cannot break the drain.

CREATE OR REPLACE FUNCTION public.record_sync_drain_run(
  p_worker_id text,
  p_lanes integer,
  p_budget_ms integer,
  p_window_ms integer,
  p_duration_ms integer,
  p_jobs_drained integer,
  p_queue_depth_start integer DEFAULT NULL,
  p_oldest_pending_age_seconds integer DEFAULT NULL,
  p_saturated boolean DEFAULT false,
  p_per_lane jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.sync_drain_runs (
    worker_id, lanes, budget_ms, window_ms, duration_ms, jobs_drained,
    queue_depth_start, oldest_pending_age_seconds, saturated, per_lane)
  VALUES (
    p_worker_id,
    GREATEST(COALESCE(p_lanes, 1), 1),
    GREATEST(COALESCE(p_budget_ms, 0), 0),
    GREATEST(COALESCE(p_window_ms, 0), 0),
    GREATEST(COALESCE(p_duration_ms, 0), 0),
    GREATEST(COALESCE(p_jobs_drained, 0), 0),
    p_queue_depth_start,
    p_oldest_pending_age_seconds,
    COALESCE(p_saturated, false),
    COALESCE(p_per_lane, '[]'::jsonb))
  RETURNING id INTO v_id;

  -- Retention. 14 days is four times the longest window any threshold here
  -- looks back over, and this table gains one row per invocation.
  DELETE FROM public.sync_drain_runs WHERE ran_at < now() - INTERVAL '14 days';

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[record_sync_drain_run] could not record run %: %', p_worker_id, SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.record_sync_drain_run(text, integer, integer, integer, integer, integer, integer, integer, boolean, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sync_drain_run(text, integer, integer, integer, integer, integer, integer, integer, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sync_drain_run(text, integer, integer, integer, integer, integer, integer, integer, boolean, jsonb)
  TO service_role;

-- Fires on N consecutive full-window runs, N runs above the pending ceiling, or
-- the oldest pending row too old (read live, so it fires even if runs stop).
-- 'no_runs' means "cannot tell" and is deliberately not 'ok'.

CREATE OR REPLACE FUNCTION public.sync_queue_drain_health(
  p_consecutive_runs integer DEFAULT 3,
  p_pending_ceiling integer DEFAULT 20,
  p_max_oldest_minutes integer DEFAULT 10
) RETURNS TABLE(
  verdict text,
  pending_depth bigint,
  oldest_pending_age_seconds numeric,
  runs_considered integer,
  saturated_runs integer,
  backlog_runs integer,
  last_run_at timestamp with time zone,
  last_duration_ms integer,
  last_window_ms integer,
  window_utilisation numeric
)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  v_runs integer := GREATEST(COALESCE(p_consecutive_runs, 3), 1);
  v_ceiling integer := GREATEST(COALESCE(p_pending_ceiling, 20), 0);
  v_age_minutes integer := GREATEST(COALESCE(p_max_oldest_minutes, 10), 1);
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT r.*
      FROM public.sync_drain_runs r
     ORDER BY r.ran_at DESC
     LIMIT v_runs
  ), live AS (
    SELECT
      count(*)::bigint AS depth,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(q.created_at))), 0)::numeric AS age
      FROM public.sync_queue q
     WHERE q.status = 'pending'
       AND q.attempts < q.max_attempts
  ), agg AS (
    SELECT
      count(*)::integer AS considered,
      count(*) FILTER (WHERE r.saturated)::integer AS sat,
      -- NULL depth is "not measured" and must not count as breaching; it also
      -- must not count as healthy, which is why `considered` is compared to
      -- v_runs below rather than to the number of measured rows.
      count(*) FILTER (WHERE r.queue_depth_start > v_ceiling)::integer AS backlog,
      max(r.ran_at) AS last_at
      FROM recent r
  ), last_run AS (
    SELECT r.duration_ms, r.window_ms
      FROM recent r
     ORDER BY r.ran_at DESC
     LIMIT 1
  )
  SELECT
    CASE
      WHEN live.age > (v_age_minutes * 60)::numeric THEN 'stalled'
      WHEN agg.considered < v_runs THEN
        CASE WHEN agg.considered = 0 THEN 'no_runs' ELSE 'ok' END
      WHEN agg.sat >= v_runs THEN 'saturated'
      WHEN agg.backlog >= v_runs THEN 'backlog'
      ELSE 'ok'
    END::text,
    live.depth,
    live.age,
    agg.considered,
    agg.sat,
    agg.backlog,
    agg.last_at,
    last_run.duration_ms,
    last_run.window_ms,
    CASE
      WHEN COALESCE(last_run.window_ms, 0) > 0
        THEN round(last_run.duration_ms::numeric / last_run.window_ms::numeric, 3)
      ELSE NULL
    END
    FROM agg CROSS JOIN live LEFT JOIN last_run ON true;
END;
$$;

ALTER FUNCTION public.sync_queue_drain_health(integer, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_queue_drain_health(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_queue_drain_health(integer, integer, integer)
  TO service_role;

-- One fleet-wide key. 'no_runs' neither fires nor clears; the age leg covers it.

CREATE OR REPLACE FUNCTION public.check_sync_queue_drain_health(
  p_consecutive_runs integer DEFAULT 3,
  p_pending_ceiling integer DEFAULT 20,
  p_max_oldest_minutes integer DEFAULT 10,
  p_quiet boolean DEFAULT false
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  h          record;
  alert_key  text := 'sync.queue.drain';
  body       text;
BEGIN
  SELECT * INTO h FROM public.sync_queue_drain_health(
    p_consecutive_runs, p_pending_ceiling, p_max_oldest_minutes);

  IF h.verdict IN ('stalled', 'saturated', 'backlog') THEN
    body := format(
      'The sync_queue drain is behind (%s).'
      || E'\n  pending depth now: %s (ceiling %s)'
      || E'\n  oldest pending row: %s s old (bound %s min)'
      || E'\n  runs considered: %s of %s -- saturated %s, over-ceiling %s'
      || E'\n  last run: %s, %s ms of a %s ms window (utilisation %s)'
      || E'\n  The window is WORKER_CONFIG.workerTimeout minus the lane tail'
      || E'\n  reserve, NOT a statement_timeout and not the cron minute.',
      h.verdict,
      h.pending_depth, GREATEST(COALESCE(p_pending_ceiling, 20), 0),
      round(COALESCE(h.oldest_pending_age_seconds, 0)),
      GREATEST(COALESCE(p_max_oldest_minutes, 10), 1),
      h.runs_considered, GREATEST(COALESCE(p_consecutive_runs, 3), 1),
      h.saturated_runs, h.backlog_runs,
      COALESCE(h.last_run_at::text, 'never'),
      COALESCE(h.last_duration_ms::text, 'n/a'),
      COALESCE(h.last_window_ms::text, 'n/a'),
      COALESCE(h.window_utilisation::text, 'n/a'));

    PERFORM monitoring.notify(
      alert_key, 'firing', 'sync_queue drain is behind', body, p_quiet);
    RETURN 1;

  ELSIF h.verdict = 'ok' THEN
    PERFORM monitoring.notify(
      alert_key, 'cleared', 'sync_queue drain is behind',
      format('The drain is keeping up: pending depth %s, oldest pending %s s, '
             || 'last run %s ms of a %s ms window.',
             h.pending_depth, round(COALESCE(h.oldest_pending_age_seconds, 0)),
             COALESCE(h.last_duration_ms::text, 'n/a'),
             COALESCE(h.last_window_ms::text, 'n/a')),
      p_quiet);
    RETURN 0;
  END IF;

  -- 'no_runs': cannot tell. Neither leg.
  RETURN 0;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[check_sync_queue_drain_health] monitor error: %', SQLERRM;
  RETURN -1;
END;
$$;

ALTER FUNCTION public.check_sync_queue_drain_health(integer, integer, integer, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_sync_queue_drain_health(integer, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;

-- Every 5 minutes, within the 10-minute age bound. Guarded: replay has no pg_cron.

DO $schedule$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE
      'PS-80: pg_cron is not installed on database % -- the monitor functions are created but NOT scheduled here. This is expected on the pgTAP replay lane and is a hard miss anywhere else.',
      current_database();
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT cron.unschedule(jobid) FROM cron.job
     WHERE jobname = 'sync-queue-drain-monitor'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'sync-queue-drain-monitor',
      '*/5 * * * *',
      'SELECT public.check_sync_queue_drain_health();')
  $sql$;

  RAISE NOTICE 'PS-80: scheduled sync-queue-drain-monitor on %', current_database();
END;
$schedule$;

DO $verify$
DECLARE
  v_missing text;
  v_scheduled boolean;
  v_anon_can boolean;
  v_verdict text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['ran_at', 'worker_id', 'lanes', 'budget_ms', 'window_ms',
                      'duration_ms', 'jobs_drained', 'queue_depth_start',
                      'oldest_pending_age_seconds', 'saturated', 'per_lane']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sync_drain_runs'
        AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PS-80 verify: sync_drain_runs is missing %', v_missing;
  END IF;

  -- The zero-argument call is what pg_cron issues. If the defaults stop
  -- covering every parameter the scheduled monitor fails every run in silence.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_sync_queue_drain_health'
     AND p.pronargdefaults = p.pronargs;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PS-80 verify: check_sync_queue_drain_health() is not callable with zero arguments, so the cron command cannot run';
  END IF;

  -- The measurement must actually evaluate on this database, not merely exist.
  SELECT verdict INTO v_verdict FROM public.sync_queue_drain_health();
  IF v_verdict IS NULL THEN
    RAISE EXCEPTION
      'PS-80 verify: sync_queue_drain_health() returned no row; a monitor that cannot read is not a monitor';
  END IF;

  -- Fresh functions inherit anon EXECUTE from ALTER DEFAULT PRIVILEGES on this
  -- estate. Assert the revoke actually took.
  SELECT bool_or(has_function_privilege(role_name, p.oid, 'EXECUTE'))
    INTO v_anon_can
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
   WHERE n.nspname = 'public'
     AND p.proname IN ('record_sync_drain_run',
                       'sync_queue_drain_health',
                       'check_sync_queue_drain_health')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name);
  IF COALESCE(v_anon_can, false) THEN
    RAISE EXCEPTION
      'PS-80 verify: anon or authenticated retains EXECUTE on a PS-80 function';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_table_privilege('anon', 'public.sync_drain_runs', 'SELECT') THEN
    RAISE EXCEPTION 'PS-80 verify: anon retains SELECT on public.sync_drain_runs';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT EXISTS (SELECT 1 FROM cron.job
                      WHERE jobname = 'sync-queue-drain-monitor'
                        AND command ~ 'check_sync_queue_drain_health')
    $sql$ INTO v_scheduled;
    IF NOT v_scheduled THEN
      RAISE EXCEPTION
        'PS-80 verify: the monitor is not scheduled -- an unwired monitor is an orphan';
    END IF;
  END IF;
END;
$verify$;

COMMIT;

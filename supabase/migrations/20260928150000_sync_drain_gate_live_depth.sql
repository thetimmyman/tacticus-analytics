-- target-db: general
-- Recent runs describe history, not now: saturated/backlog also require claimable rows in the
-- live queue, else the verdict is 'drained'. 'drained' neither fires nor clears, because the
-- monitor samples just before each scheduler burst, when the queue is at its lowest.

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
     WHERE r.ran_at >= now() - make_interval(mins => v_age_minutes)
     ORDER BY r.ran_at DESC
     LIMIT v_runs
  ), live AS (
    SELECT
      count(*)::bigint AS depth,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(q.created_at))), 0)::numeric AS age,
      -- Only rows claim_next_job could take now; deferred and retry rows wait for scheduled_for.
      count(*) FILTER (WHERE q.scheduled_for IS NULL OR q.scheduled_for <= now())::bigint
        AS claimable
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
      -- Live depth is not used here: the queue is filled in bursts, so a single
      -- sample over the ceiling is normal and would flap the alert.
      WHEN agg.considered = 0
       AND EXISTS (SELECT 1 FROM public.sync_drain_runs) THEN 'runs_stale'
      WHEN agg.considered < v_runs THEN
        CASE WHEN agg.considered = 0 THEN 'no_runs' ELSE 'ok' END
      -- Breaching run history with nothing claimable now: the burst it described has drained.
      WHEN live.claimable = 0 AND (agg.sat >= v_runs OR agg.backlog >= v_runs) THEN 'drained'
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

-- 'no_runs' and 'drained' neither fire nor clear; 'runs_stale' clears because the run evidence aged out.
-- A firing alert therefore clears only on 'ok' or 'runs_stale', not on one empty-queue sample.

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
      COALESCE(h.last_run_at::text,
               format('none in the last %s min', GREATEST(COALESCE(p_max_oldest_minutes, 10), 1))),
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

  ELSIF h.verdict = 'runs_stale' THEN
    PERFORM monitoring.notify(
      alert_key, 'cleared', 'sync_queue drain is behind',
      format('No drain run recorded in the last %s min (newest %s), so no run '
             || 'evidence is current. Live queue: pending depth %s, oldest pending %s s.',
             GREATEST(COALESCE(p_max_oldest_minutes, 10), 1),
             COALESCE((SELECT max(r.ran_at) FROM public.sync_drain_runs r)::text, 'never'),
             h.pending_depth, round(COALESCE(h.oldest_pending_age_seconds, 0))),
      p_quiet);
    RETURN 0;

  END IF;

  -- 'no_runs' or 'drained': cannot tell from this sample. Neither leg.
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

-- The monitor must still evaluate here and stay closed to client roles.
DO $verify$
DECLARE
  v_verdict text;
BEGIN
  SELECT verdict INTO v_verdict FROM public.sync_queue_drain_health();
  IF v_verdict IS NULL THEN
    RAISE EXCEPTION 'sync_queue_drain_health() returned no row';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname IN ('sync_queue_drain_health', 'check_sync_queue_drain_health')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'anon or authenticated can execute a sync drain monitor function';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

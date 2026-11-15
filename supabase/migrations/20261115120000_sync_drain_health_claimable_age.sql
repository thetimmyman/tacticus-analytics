-- target-db: general
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'This migration targets the general database only';
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
      COALESCE(EXTRACT(EPOCH FROM (now() - min(
        GREATEST(q.created_at, COALESCE(q.scheduled_for, q.created_at))
      ) FILTER (WHERE q.scheduled_for IS NULL OR q.scheduled_for <= now()))), 0)::numeric AS age,
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

NOTIFY pgrst, 'reload schema';

COMMIT;

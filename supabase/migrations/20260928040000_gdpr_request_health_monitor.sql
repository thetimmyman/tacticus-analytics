-- target-db: general
-- Report GDPR requests that remain unfulfilled so an individual log line cannot be lost.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'This migration targets the General database only; refusing to run on %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.gdpr_request_health(
  p_stuck_export_minutes integer DEFAULT 60,
  p_overdue_deletion_hours integer DEFAULT 24
) RETURNS TABLE(
  verdict text,
  failed_exports integer,
  stuck_exports integer,
  overdue_deletions integer,
  oldest_open_request_at timestamptz,
  sample_export_request_ids uuid[],
  sample_deletion_request_ids uuid[]
)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$
DECLARE
  v_export_minutes integer := GREATEST(COALESCE(p_stuck_export_minutes, 60), 1);
  v_deletion_hours integer := GREATEST(COALESCE(p_overdue_deletion_hours, 24), 1);
BEGIN
  RETURN QUERY
  WITH exports AS (
    SELECT e.request_id, COALESCE(e.requested_at, e.created_at) AS opened_at, e.status
      FROM public.gdpr_data_exports e
     WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.user_id)
       AND (e.status = 'failed'
         OR (e.status IN ('pending', 'processing')
             AND COALESCE(e.requested_at, e.created_at) < now() - make_interval(mins => v_export_minutes)))
  ), deletions AS (
    SELECT d.request_id, COALESCE(d.requested_at, d.created_at) AS opened_at
      FROM public.gdpr_deletion_requests d
     WHERE d.status IN ('pending', 'scheduled')
       AND d.scheduled_for < now() - make_interval(hours => v_deletion_hours)
  ), counts AS (
    SELECT count(*) FILTER (WHERE status = 'failed')::integer AS failed_count,
           count(*) FILTER (WHERE status IN ('pending', 'processing'))::integer AS stuck_count
      FROM exports
  )
  SELECT CASE WHEN c.failed_count + c.stuck_count + (SELECT count(*) FROM deletions) > 0
              THEN 'unfulfilled' ELSE 'ok' END,
         c.failed_count, c.stuck_count, (SELECT count(*)::integer FROM deletions),
         (SELECT min(opened_at) FROM (
            SELECT opened_at FROM exports UNION ALL SELECT opened_at FROM deletions
          ) all_open),
         COALESCE((SELECT array_agg(request_id ORDER BY opened_at, request_id) FROM
                    (SELECT request_id, opened_at FROM exports ORDER BY opened_at, request_id LIMIT 5) sampled), ARRAY[]::uuid[]),
         COALESCE((SELECT array_agg(request_id ORDER BY opened_at, request_id) FROM
                    (SELECT request_id, opened_at FROM deletions ORDER BY opened_at, request_id LIMIT 5) sampled), ARRAY[]::uuid[])
    FROM counts c;
END;
$$;

ALTER FUNCTION public.gdpr_request_health(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gdpr_request_health(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_request_health(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.check_gdpr_request_health(p_quiet boolean DEFAULT false)
RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
  AS $$
DECLARE
  h record;
  v_age text;
  v_body text;
BEGIN
  SELECT * INTO h FROM public.gdpr_request_health();
  v_age := CASE WHEN h.oldest_open_request_at IS NULL THEN 'none'
    ELSE justify_interval(now() - h.oldest_open_request_at)::text END;
  -- Request ids stay out of the alert: Discord is a third party and an id links to a person.
  v_body := format(
    'Failed exports: %s; stuck exports: %s; overdue deletions: %s.%s'
    || E'\nList them with SELECT * FROM public.gdpr_request_health();'
    || E'\nRe-drive a failed export with POST /api/admin/gdpr/exports/<request_id>/redrive.'
    || E'\nAn overdue deletion means the daily /api/cron/gdpr-cleanup run is not completing it.',
    h.failed_exports, h.stuck_exports, h.overdue_deletions,
    CASE WHEN h.oldest_open_request_at IS NULL THEN E'\nOldest open request age: none.'
         ELSE format(E'\nOldest open request age: %s.', v_age) END);
  PERFORM monitoring.notify('gdpr.requests',
    CASE WHEN h.verdict = 'unfulfilled' THEN 'firing' ELSE 'cleared' END,
    CASE WHEN h.verdict = 'unfulfilled'
         THEN 'GDPR requests unfulfilled (Article 12(3): answer within one month)'
         ELSE 'GDPR requests: none unfulfilled' END,
    v_body, p_quiet);
  RETURN CASE WHEN h.verdict = 'unfulfilled' THEN 1 ELSE 0 END;
END;
$$;

ALTER FUNCTION public.check_gdpr_request_health(boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_gdpr_request_health(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_gdpr_request_health(boolean) TO service_role;

DO $route$
BEGIN
  IF to_regclass('monitoring.alert_route') IS NULL THEN
    RAISE NOTICE 'monitoring.alert_route is absent; GDPR route was not added';
  ELSE
    INSERT INTO monitoring.alert_route(pattern, channel, note)
    VALUES ('gdpr.%', 'ta', 'GDPR request fulfillment monitor')
    ON CONFLICT (pattern) DO NOTHING;
  END IF;
END;
$route$;

DO $expectation$
BEGIN
  IF to_regclass('monitoring.alert_expectation') IS NULL THEN
    RAISE NOTICE 'monitoring.alert_expectation is absent; GDPR cadence was not added';
  ELSE
    INSERT INTO monitoring.alert_expectation(key_pattern, expected_interval, note)
    VALUES ('gdpr.requests', INTERVAL '3 hours',
      'supabase/migrations/20260928040000_gdpr_request_health_monitor.sql schedules gdpr-request-health hourly at minute 23; three hours allows one missed run.')
    ON CONFLICT (key_pattern) DO NOTHING;
  END IF;
END;
$expectation$;

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed here; GDPR request health job was not scheduled';
    RETURN;
  END IF;
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'gdpr-request-health' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule('gdpr-request-health', '23 * * * *',
    'SELECT public.check_gdpr_request_health();');
END;
$cron$;

DO $verify$
BEGIN
  IF to_regprocedure('public.gdpr_request_health(integer,integer)') IS NULL
     OR to_regprocedure('public.check_gdpr_request_health(boolean)') IS NULL THEN
    RAISE EXCEPTION 'GDPR request monitor functions are missing';
  END IF;
  IF has_function_privilege('anon', 'public.gdpr_request_health(integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.gdpr_request_health(integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.check_gdpr_request_health(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.check_gdpr_request_health(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or authenticated can execute a GDPR request monitor function';
  END IF;
END;
$verify$;

COMMIT;

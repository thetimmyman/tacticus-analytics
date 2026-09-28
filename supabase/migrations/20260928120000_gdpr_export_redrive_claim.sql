-- target-db: general
-- Atomic claim for an export re-drive, so two re-drives of the same row cannot run at once.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'This migration targets the General database only; refusing to run on %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- Stamped by each re-drive claim: requested_at never moves, so it cannot tell a live re-drive from an orphan.
ALTER TABLE public.gdpr_data_exports
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- One UPDATE decides and claims; a concurrent claim re-checks the row after the first commits and matches nothing.
CREATE OR REPLACE FUNCTION public.claim_gdpr_export_redrive(
  p_request_id uuid,
  p_stuck_export_minutes integer DEFAULT 60
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
  AS $$
DECLARE
  v_export_minutes integer := GREATEST(COALESCE(p_stuck_export_minutes, 60), 1);
  v_claimed uuid;
BEGIN
  UPDATE public.gdpr_data_exports e
     SET status = 'processing', processing_started_at = now()
   WHERE e.request_id = p_request_id
     AND (e.status = 'failed'
       OR (e.status IN ('pending', 'processing')
           AND COALESCE(e.processing_started_at, e.requested_at, e.created_at)
               < now() - make_interval(mins => v_export_minutes)))
  RETURNING e.request_id INTO v_claimed;
  RETURN v_claimed IS NOT NULL;
END;
$$;

ALTER FUNCTION public.claim_gdpr_export_redrive(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_gdpr_export_redrive(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gdpr_export_redrive(uuid, integer) TO service_role;

-- Same stuck line as the claim above, so every row the monitor reports stuck can be re-driven.
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
             AND COALESCE(e.processing_started_at, e.requested_at, e.created_at)
                 < now() - make_interval(mins => v_export_minutes)))
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
    || E'\nRe-drive a failed or stuck export with POST /api/admin/gdpr/exports/<request_id>/redrive.'
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

DO $verify$
BEGIN
  IF to_regprocedure('public.claim_gdpr_export_redrive(uuid,integer)') IS NULL
     OR to_regprocedure('public.gdpr_request_health(integer,integer)') IS NULL
     OR to_regprocedure('public.check_gdpr_request_health(boolean)') IS NULL THEN
    RAISE EXCEPTION 'GDPR export re-drive functions are missing';
  END IF;
  IF has_function_privilege('anon', 'public.claim_gdpr_export_redrive(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_gdpr_export_redrive(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.gdpr_request_health(integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.gdpr_request_health(integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.check_gdpr_request_health(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.check_gdpr_request_health(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or authenticated can execute a GDPR export function';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

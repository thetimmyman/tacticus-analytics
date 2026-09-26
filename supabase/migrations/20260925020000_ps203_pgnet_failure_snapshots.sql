-- Keep sanitized pg_net failures after net._http_response expires (~6h). Only id,
-- status, error text, time and URL host are kept: responses can hold credentials.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-203 pgnet failure snapshots require database postgres, got %',
      current_database();
  END IF;

  IF to_regprocedure('public.check_http_response_errors()') IS NULL
     OR to_regprocedure('public.check_pgnet_freshness()') IS NULL THEN
    RAISE EXCEPTION
      'PS-203 requires the live public.check_http_response_errors() and public.check_pgnet_freshness() watchdogs';
  END IF;
END;
$guard$;

-- Owner-only: RLS with no policy, all client grants revoked (sequence too).

CREATE TABLE monitoring.pgnet_failure_snapshots (
  id           bigserial PRIMARY KEY,
  captured_at  timestamptz DEFAULT now(),
  source       text,
  response_id  bigint,
  status_code  int,
  error_msg    text,
  url_host     text,
  created      timestamptz
);

ALTER TABLE monitoring.pgnet_failure_snapshots OWNER TO postgres;
ALTER TABLE monitoring.pgnet_failure_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE monitoring.pgnet_failure_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE monitoring.pgnet_failure_snapshots_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX pgnet_failure_snapshots_captured_at_idx
  ON monitoring.pgnet_failure_snapshots (captured_at);
CREATE UNIQUE INDEX pgnet_failure_snapshots_response_id_idx
  ON monitoring.pgnet_failure_snapshots (response_id);

COMMENT ON TABLE monitoring.pgnet_failure_snapshots IS
  'PS-203: durable, sanitized snapshots of failed pg_net responses captured by the bridge watchdogs.';
COMMENT ON COLUMN monitoring.pgnet_failure_snapshots.source IS
  'Watchdog that first captured this response_id.';
COMMENT ON COLUMN monitoring.pgnet_failure_snapshots.url_host IS
  'Host only, parsed from monitoring.pgnet_request_ledger.url; never the full URL.';

-- The LEFT JOIN keeps unattributed responses, with a NULL url_host.

CREATE OR REPLACE FUNCTION public.check_http_response_errors()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  error_count INTEGER;
  error_summary TEXT;
BEGIN
  DELETE FROM monitoring.pgnet_failure_snapshots
  WHERE captured_at < NOW() - INTERVAL '90 days';

  SELECT count(*), string_agg(line, E'\n')
  INTO error_count, error_summary
  FROM (
    SELECT DISTINCT
      COALESCE(led.function_name, '(unattributed)')
      || ' → '
      || COALESCE(
           resp.status_code::text,
           CASE WHEN resp.timed_out THEN 'TIMEOUT' ELSE 'CONN_ERR' END
         )
      || COALESCE(' ' || led.url, '')
      || COALESCE(': ' || LEFT(COALESCE(resp.error_msg, resp.content), 160), '')
      AS line
    FROM net._http_response resp
    LEFT JOIN monitoring.pgnet_request_ledger led ON led.request_id = resp.id
    WHERE resp.created >= NOW() - INTERVAL '30 minutes'
      AND (resp.status_code < 200 OR resp.status_code >= 400
           OR resp.error_msg IS NOT NULL OR resp.timed_out = true)
  ) s;

  DELETE FROM monitoring.pgnet_request_ledger
  WHERE called_at < NOW() - INTERVAL '7 days';

  IF error_count > 0 THEN
    INSERT INTO monitoring.pgnet_failure_snapshots
      (source, response_id, status_code, error_msg, url_host, created)
    SELECT
      'check_http_response_errors',
      resp.id,
      resp.status_code,
      resp.error_msg,
      LOWER(SUBSTRING(led.url FROM
        '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?(\[[0-9A-Fa-f:.]+\]|[^:/?#]+)')),
      resp.created
    FROM net._http_response resp
    LEFT JOIN monitoring.pgnet_request_ledger led ON led.request_id = resp.id
    WHERE resp.created >= NOW() - INTERVAL '30 minutes'
      AND (resp.status_code IS NULL OR resp.status_code >= 400)
    ON CONFLICT (response_id) DO NOTHING;

    PERFORM monitoring.notify(
      'pgnet.http_errors', 'firing',
      format('pg_net HTTP errors (%s in last 30min)', error_count),
      LEFT(COALESCE(error_summary, 'Unknown errors'), 1800));
  ELSE
    PERFORM monitoring.notify(
      'pgnet.http_errors', 'cleared',
      'pg_net HTTP errors',
      'No failed pg_net responses in the last 30 minutes.');
  END IF;
END;
$function$;

-- Captures from the same window that produced the firing verdict.

CREATE OR REPLACE FUNCTION public.check_pgnet_freshness()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  last_success timestamptz;
  last_any timestamptz;
  recent_cron_runs integer;
  msg text;
  reset_at timestamptz;
  window_start timestamptz;
  was_reset boolean;
  grace interval := INTERVAL '1 hour';
BEGIN
  DELETE FROM monitoring.pgnet_failure_snapshots
  WHERE captured_at < NOW() - INTERVAL '90 days';

  reset_at := pg_postmaster_start_time();
  window_start := GREATEST(NOW() - INTERVAL '4 hours', reset_at);
  was_reset := reset_at > NOW() - INTERVAL '4 hours';

  SELECT MAX(created) FILTER (WHERE status_code >= 200 AND status_code < 300),
         MAX(created)
    INTO last_success, last_any
    FROM net._http_response
   WHERE created >= window_start;

  IF last_success IS NOT NULL THEN
    -- WI-6170: an explicit all-clear, not a silent re-arm.
    PERFORM monitoring.notify(
      'pgnet.bridge', 'cleared',
      'pg_net cron → HTTP bridge',
      format('Bridge is delivering again (last 2xx: %s).', last_success));
    RETURN;
  END IF;

  -- WI-6160: too soon after a promotion wiped the UNLOGGED response history to
  -- judge. Report NEITHER state — "I cannot tell" is not "cleared".
  IF was_reset AND NOW() - reset_at < grace THEN
    RAISE NOTICE '[check_pgnet_freshness] deferring: unlogged response history was reset at % (postmaster restart/promotion), only % ago — no verdict is possible yet.',
      reset_at, NOW() - reset_at;
    RETURN;
  END IF;

  SELECT count(*) INTO recent_cron_runs
    FROM cron.job_run_details
   WHERE start_time >= window_start;

  msg := format(
    'pg_net has delivered NO successful HTTP response since %s '
    || '(last 2xx: %s, last response of any kind: %s, cron runs in window: %s). '
    || 'The cron -> HTTP bridge may be silently broken again — see WI-2530/WI-2560.%s',
    window_start,
    COALESCE(last_success::text, 'none in window'),
    COALESCE(last_any::text, 'none'),
    recent_cron_runs,
    CASE WHEN was_reset THEN format(
      E'\nNOTE: net._http_response is UNLOGGED and was emptied by a postmaster '
      || 'restart/promotion at %s, so the window starts there rather than 4h '
      || 'back. This is NOT purge noise — more than %s has since elapsed with '
      || 'zero successes, which a healthy bridge cannot do.', reset_at, grace)
    ELSE '' END
  );

  INSERT INTO monitoring.pgnet_failure_snapshots
    (source, response_id, status_code, error_msg, url_host, created)
  SELECT
    'check_pgnet_freshness',
    resp.id,
    resp.status_code,
    resp.error_msg,
    LOWER(SUBSTRING(led.url FROM
      '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?(\[[0-9A-Fa-f:.]+\]|[^:/?#]+)')),
    resp.created
  FROM net._http_response resp
  LEFT JOIN monitoring.pgnet_request_ledger led ON led.request_id = resp.id
  WHERE resp.created >= window_start
    AND (resp.status_code IS NULL OR resp.status_code NOT BETWEEN 200 AND 299)
  ON CONFLICT (response_id) DO NOTHING;

  PERFORM monitoring.notify(
    'pgnet.bridge', 'firing', 'pg_net freshness watchdog: bridge may be down', msg);
EXCEPTION WHEN OTHERS THEN
  -- Never let the watchdog kill its own cron slot.
  RAISE WARNING '[check_pgnet_freshness] watchdog error: %', SQLERRM;
END;
$function$;

ALTER FUNCTION public.check_http_response_errors() OWNER TO postgres;
ALTER FUNCTION public.check_pgnet_freshness() OWNER TO postgres;

DO $verify$
DECLARE
  v_table regclass := 'monitoring.pgnet_failure_snapshots'::regclass;
  v_signature text;
  v_bad text;
BEGIN
  IF to_regclass('monitoring.pgnet_failure_snapshots') IS NULL THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table is missing';
  END IF;

  IF (SELECT relpersistence FROM pg_class WHERE oid = v_table) <> 'p' THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table is not durable/logged';
  END IF;

  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = v_table) <> 'postgres' THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table is not owned by postgres';
  END IF;

  SELECT string_agg(c.column_name, ', ' ORDER BY c.ordinal_position)
    INTO v_bad
    FROM information_schema.columns c
   WHERE c.table_schema = 'monitoring'
     AND c.table_name = 'pgnet_failure_snapshots'
     AND c.column_name NOT IN (
       'id', 'captured_at', 'source', 'response_id', 'status_code',
       'error_msg', 'url_host', 'created');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PS-203 verify: unexpected snapshot column(s): %', v_bad;
  END IF;

  IF (SELECT count(*)::integer
        FROM information_schema.columns
       WHERE table_schema = 'monitoring'
         AND table_name = 'pgnet_failure_snapshots')
     <> 8 THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table does not have the eight required columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = v_table AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table has no primary key on id';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table does not have RLS enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = v_table) THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table must remain policy-free and fail closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_index i ON i.indrelid = c.oid
     WHERE c.oid = v_table
       AND i.indisunique
       AND i.indnatts = 1
       AND i.indkey[0] = 4) THEN
    RAISE EXCEPTION 'PS-203 verify: response_id does not have a single-column unique index';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_index i ON i.indrelid = c.oid
     WHERE c.oid = v_table
       AND i.indnatts = 1
       AND i.indkey[0] = 2) THEN
    RAISE EXCEPTION 'PS-203 verify: captured_at index is missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      LEFT JOIN LATERAL aclexplode(c.relacl) a ON true
     WHERE c.oid = v_table
       AND (a.grantee = 0
            OR a.grantee IN (
              SELECT oid FROM pg_roles
               WHERE rolname IN ('anon', 'authenticated', 'service_role')))) THEN
    RAISE EXCEPTION 'PS-203 verify: snapshot table has a PUBLIC or client-role grant';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.check_http_response_errors()',
    'public.check_pgnet_freshness()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'PS-203 verify: watchdog % is missing', v_signature;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc p
       WHERE p.oid = to_regprocedure(v_signature)
         AND p.prosecdef
         AND pg_get_userbyid(p.proowner) = 'postgres'
         AND p.proconfig::text[] @> ARRAY['search_path=public']
         AND position('monitoring.pgnet_failure_snapshots' IN p.prosrc) > 0
         AND position('INTERVAL ''90 days''' IN p.prosrc) > 0
         AND position('ON CONFLICT (response_id) DO NOTHING' IN p.prosrc) > 0) THEN
      RAISE EXCEPTION
        'PS-203 verify: % lost its security contract or durable snapshot path',
        v_signature;
    END IF;
  END LOOP;

  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job
       WHERE jobname = 'check-http-errors'
         AND schedule = '*/30 * * * *'
         AND btrim(command) = 'SELECT public.check_http_response_errors();')
      OR NOT EXISTS (
      SELECT 1 FROM cron.job
       WHERE jobname = 'pgnet-freshness-watchdog'
         AND schedule = '17,47 * * * *'
         AND btrim(command) = 'SELECT public.check_pgnet_freshness();') THEN
      RAISE EXCEPTION 'PS-203 verify: the live pg_net watchdog cron rows drifted';
    END IF;
  END IF;

  RAISE NOTICE 'PS-203 verify: durable pg_net failure snapshots are installed';
END;
$verify$;

COMMIT;

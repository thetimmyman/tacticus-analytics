-- Ignore retained responses created before the current HTTP request was emitted.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

-- reap_pgnet_outcomes() below uses called_at as the emission cutoff, so every
-- writer stamps it with wall-clock time. now() is fixed at transaction start;
-- in a long transaction it can predate a retained response for a reused id.
SET LOCAL lock_timeout = '5s';

ALTER TABLE monitoring.pgnet_request_ledger
  ALTER COLUMN called_at SET DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION monitoring.record_pgnet_request(
  p_request_id    bigint,
  p_function_name text,
  p_url           text
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO monitoring.pgnet_request_ledger
    (request_id, function_name, url, outcome)
  VALUES (p_request_id, p_function_name, p_url, 'pending')
  ON CONFLICT (request_id) DO UPDATE
    SET function_name = EXCLUDED.function_name,
        url           = EXCLUDED.url,
        called_at     = clock_timestamp(),
        outcome       = 'pending',
        status_code   = NULL,
        error_msg     = NULL,
        timed_out     = NULL,
        settled_at    = NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[record_pgnet_request] could not record % (request %): %',
    p_function_name, p_request_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.call_edge_function(function_name text, payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  base_url TEXT;
  cron_secret TEXT;
  service_key TEXT;
  api_route TEXT;
  req_headers JSONB;
  v_request_id BIGINT;   -- v_ prefix: `request_id` is also a ledger COLUMN name
  v_fn TEXT;             -- ditto for `function_name` (which is also a PARAMETER)
  target_url TEXT;
BEGIN
  base_url := get_api_base_url();

  -- Map edge function names to local API routes
  api_route := CASE function_name
    -- Discord webhook functions
    WHEN 'discord-notifications' THEN '/api/discord-webhooks/event-notification'
    WHEN 'discord-kill-notifications' THEN '/api/discord-webhooks/boss-assignments'
    WHEN 'update-discord-leaderboards' THEN '/api/discord/leaderboard-refresh'
    WHEN 'daily-summary' THEN '/api/cron/daily-alert-summary'
    WHEN 'detect-season-end' THEN '/api/cron/season-transition-monitor'
    WHEN 'process-cap-notifications' THEN '/api/discord-webhooks/cap-notification'

    -- Data sync functions
    WHEN 'check-capped-players' THEN '/api/cron/token-reminders'
    WHEN 'gr-availability' THEN '/api/discord-webhooks/post-availability'
    WHEN 'guild-raid-sync' THEN '/api/cron/guild-batch-sync'
    WHEN 'guild-war-sync' THEN '/api/cron/guild-war-sync'

    -- Token economy audit
    WHEN 'token-audit' THEN '/api/cron/token-audit'

    -- Calculation functions - use local Edge Functions via Kong
    WHEN 'calculate-votlw' THEN NULL
    WHEN 'votlw_history' THEN NULL

    -- Backfill - manual operation
    WHEN 'historical-backfill' THEN NULL
    WHEN 'historical-backfill-modular' THEN NULL

    -- Default: assume API route matches function name
    ELSE '/api/' || REPLACE(function_name, '_', '-')
  END;

  IF api_route IS NULL THEN
    -- Supabase Edge Function via Kong (k3s Service DNS — the docker-era
    -- short gateway hostname does not resolve in the cluster). The
    -- get_secret row is an operator override knob, deliberately unseeded.
    base_url := COALESCE(NULLIF(internal.get_secret('supabase_internal_url'), ''), 'http://supabase-kong.tacticus.svc.cluster.local:8000');
    api_route := '/functions/v1/' || function_name;

    -- Kong requires the service-role key, not the cron secret. If this key
    -- drifts from the cluster's SUPABASE_SERVICE_ROLE_KEY, Kong answers 401 and
    -- pg_cron still reports `succeeded`, a silent failure. The
    -- fingerprint comparison that catches it lives in the deploy-drift-check
    -- `check_service_key` lane (it needs kubectl, so it cannot live here).
    service_key := internal.get_secret('service_role_key');
    IF service_key IS NULL OR service_key = '' THEN
      RAISE WARNING 'call_edge_function: service_role_key not configured (needed for %). Seed it via the credential-rotation runbook: INSERT INTO internal.cron_secrets (name, value) VALUES (''service_role_key'', ...);', function_name;
      RETURN jsonb_build_object('error', 'service_role_key not configured', 'function', function_name);
    END IF;
    req_headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json',
      'X-Cron-Source', 'pg_cron'
    );
  ELSE
    cron_secret := get_cron_secret();
    req_headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(cron_secret, ''),
      'Content-Type', 'application/json',
      'X-Cron-Source', 'pg_cron'
    );
  END IF;

  target_url := base_url || api_route;

  -- pg_net queues the request and returns a request id (async). 120s timeout
  -- (endpoints can take 30-90s for multi-guild ops — 20260410000006).
  BEGIN
    SELECT net.http_post(
      url := target_url,
      body := payload,
      headers := req_headers,
      timeout_milliseconds := 120000
    ) INTO v_request_id;
  EXCEPTION WHEN undefined_function THEN
    -- Legacy pg_net installs expose a TEXT body instead of JSONB.
    SELECT net.http_post(
      url := target_url,
      headers := req_headers,
      body := payload::text,
      timeout_milliseconds := 120000
    ) INTO v_request_id;
  END;

  -- Attribute the request so a later failure can name this caller.
  -- Swallowing errors here is DELIBERATE and load-bearing: this is an
  -- observability side-effect, and it must never be able to break the
  -- cron -> HTTP bridge it exists to observe. A lost ledger row degrades a
  -- future alert to today's behaviour (unattributed); a raised exception here
  -- would take down every cron job that dispatches HTTP.
  BEGIN
    v_fn := function_name;
    INSERT INTO monitoring.pgnet_request_ledger (request_id, function_name, url)
    VALUES (v_request_id, v_fn, target_url)
    ON CONFLICT (request_id) DO UPDATE
      SET function_name = EXCLUDED.function_name,
          url           = EXCLUDED.url,
          called_at     = clock_timestamp();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'call_edge_function: ledger write failed for % (request %): %',
      function_name, v_request_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'url', target_url,
    'status', 'queued'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'call_edge_function failed for %: %', function_name, SQLERRM;
  RETURN jsonb_build_object('error', SQLERRM, 'function', function_name);
END;
$$;

CREATE OR REPLACE FUNCTION monitoring.reap_pgnet_outcomes(
  p_lookback      interval DEFAULT INTERVAL '24 hours',
  p_give_up_after interval DEFAULT INTERVAL '2 hours'
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_settled integer := 0;
  v_unknown integer := 0;
BEGIN
  -- pg_net is an extension, not a schema this tree creates. Where it is absent
  -- there is nothing to reap and nothing to report; saying so is not an error.
  IF to_regclass('net._http_response') IS NULL THEN
    RAISE NOTICE '[reap_pgnet_outcomes] net._http_response is absent on % -- nothing to reap', current_database();
    RETURN 0;
  END IF;

  WITH settled AS (
    UPDATE monitoring.pgnet_request_ledger led
       SET outcome     = monitoring.classify_pgnet_outcome(
                           resp.status_code, resp.timed_out, resp.error_msg),
           status_code = resp.status_code,
           error_msg   = resp.error_msg,
           timed_out   = resp.timed_out,
           settled_at  = now()
      FROM net._http_response resp
     WHERE resp.id = led.request_id
       AND resp.created >= led.called_at
       AND led.outcome = 'pending'
       AND led.called_at >= now() - p_lookback
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_settled FROM settled;

  WITH gave_up AS (
    UPDATE monitoring.pgnet_request_ledger
       SET outcome    = 'unknown',
           settled_at = now()
     WHERE outcome = 'pending'
       AND called_at < now() - p_give_up_after
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_unknown FROM gave_up;

  IF v_settled > 0 OR v_unknown > 0 THEN
    RAISE NOTICE '[reap_pgnet_outcomes] settled %, gave up on %', v_settled, v_unknown;
  END IF;

  RETURN v_settled + v_unknown;
EXCEPTION WHEN OTHERS THEN
  -- Log, then RE-RAISE: a normal return here would let pg_cron record the run
  -- as succeeded while the subtransaction rolled every settlement back -- the
  -- exact silent success this migration exists to remove.
  RAISE WARNING '[reap_pgnet_outcomes] reaper error: %', SQLERRM;
  RAISE;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;

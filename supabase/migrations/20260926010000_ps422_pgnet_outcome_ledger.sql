-- target-db: general
-- Durably record cron-fired HTTP outcomes (job_run_details sees only the enqueue;
-- net._http_response is pruned within hours) via a 5-minute reaper. Re-pointing
-- direct net.http_post jobs at http_post_recorded() is an operator step.

BEGIN;

-- 'pending' is the default so call_edge_function's INSERT is unchanged; 'unknown'
-- (no response before give-up) is deliberately not success.

ALTER TABLE monitoring.pgnet_request_ledger
  ADD COLUMN IF NOT EXISTS outcome     text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS status_code integer,
  ADD COLUMN IF NOT EXISTS error_msg   text,
  ADD COLUMN IF NOT EXISTS timed_out   boolean,
  ADD COLUMN IF NOT EXISTS settled_at  timestamptz;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pgnet_request_ledger_outcome_check'
       AND conrelid = 'monitoring.pgnet_request_ledger'::regclass
  ) THEN
    ALTER TABLE monitoring.pgnet_request_ledger
      ADD CONSTRAINT pgnet_request_ledger_outcome_check
      CHECK (outcome IN ('pending', 'succeeded', 'failed', 'unknown'));
  END IF;
END;
$constraint$;

-- Partial: the reaper only ever looks up pending rows.
CREATE INDEX IF NOT EXISTS pgnet_request_ledger_pending_idx
  ON monitoring.pgnet_request_ledger (called_at)
  WHERE outcome = 'pending';

COMMENT ON COLUMN monitoring.pgnet_request_ledger.outcome IS
  'PS-422: pending | succeeded | failed | unknown. `unknown` means no response row was found before the give-up window elapsed (pruned, wiped by a restart, or never delivered) -- it is NOT success.';
COMMENT ON COLUMN monitoring.pgnet_request_ledger.status_code IS
  'PS-422: net._http_response.status_code, copied inside the pg_net retention window by monitoring.reap_pgnet_outcomes().';
COMMENT ON COLUMN monitoring.pgnet_request_ledger.error_msg IS
  'PS-422: net._http_response.error_msg (transport-level failure), copied at settle time.';
COMMENT ON COLUMN monitoring.pgnet_request_ledger.timed_out IS
  'PS-422: net._http_response.timed_out, copied at settle time.';
COMMENT ON COLUMN monitoring.pgnet_request_ledger.settled_at IS
  'PS-422: when the outcome was written. NULL while pending.';

-- Pure, so success has one definition; a NULL status is never success.

CREATE OR REPLACE FUNCTION monitoring.classify_pgnet_outcome(
  p_status_code integer,
  p_timed_out   boolean,
  p_error_msg   text
) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN COALESCE(p_timed_out, false) THEN 'failed'
    WHEN p_error_msg IS NOT NULL AND p_error_msg <> '' THEN 'failed'
    WHEN p_status_code BETWEEN 200 AND 299 THEN 'succeeded'
    ELSE 'failed'
  END;
$$;

ALTER FUNCTION monitoring.classify_pgnet_outcome(integer, boolean, text)
  OWNER TO postgres;

COMMENT ON FUNCTION monitoring.classify_pgnet_outcome(integer, boolean, text) IS
  'PS-422: the single definition of a successful cron-fired HTTP request. Anything that is not a 2xx with no timeout and no transport error is failed.';

-- For jobs calling net.http_post directly. Swallows errors so observability never breaks the cron.

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
        called_at     = now(),
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

ALTER FUNCTION monitoring.record_pgnet_request(bigint, text, text)
  OWNER TO postgres;

COMMENT ON FUNCTION monitoring.record_pgnet_request(bigint, text, text) IS
  'PS-422: record a pg_net request at emit time so its outcome can be settled later. Never raises.';

-- The undefined_function fallback covers legacy pg_net with a TEXT body.

CREATE OR REPLACE FUNCTION monitoring.http_post_recorded(
  p_job_name   text,
  p_url        text,
  p_body       jsonb   DEFAULT '{}'::jsonb,
  p_headers    jsonb   DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  p_timeout_ms integer DEFAULT 120000
) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_request_id bigint;
BEGIN
  BEGIN
    SELECT net.http_post(
      url := p_url,
      body := p_body,
      headers := p_headers,
      timeout_milliseconds := p_timeout_ms
    ) INTO v_request_id;
  EXCEPTION WHEN undefined_function THEN
    SELECT net.http_post(
      url := p_url,
      headers := p_headers,
      body := p_body::text,
      timeout_milliseconds := p_timeout_ms
    ) INTO v_request_id;
  END;

  PERFORM monitoring.record_pgnet_request(v_request_id, p_job_name, p_url);

  RETURN v_request_id;
END;
$$;

ALTER FUNCTION monitoring.http_post_recorded(text, text, jsonb, jsonb, integer)
  OWNER TO postgres;

COMMENT ON FUNCTION monitoring.http_post_recorded(text, text, jsonb, jsonb, integer) IS
  'PS-422: net.http_post plus the emit-time ledger row. The statement a pg_cron job should run instead of calling net.http_post directly.';

-- Settles pending rows, then marks rows pending past p_give_up_after 'unknown'. Never raises.

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

ALTER FUNCTION monitoring.reap_pgnet_outcomes(interval, interval)
  OWNER TO postgres;

COMMENT ON FUNCTION monitoring.reap_pgnet_outcomes(interval, interval) IS
  'PS-422: copy pg_net response outcomes into monitoring.pgnet_request_ledger before net._http_response prunes them, and mark anything still unanswered after the give-up window as `unknown`. Returns rows touched; an internal error is re-raised so the pg_cron run is recorded as failed.';

-- monitoring has no client USAGE; per-role revokes defeat default privileges.

REVOKE ALL ON FUNCTION monitoring.classify_pgnet_outcome(integer, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.record_pgnet_request(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.http_post_recorded(text, text, jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.reap_pgnet_outcomes(interval, interval) FROM PUBLIC;

DO $acl$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE monitoring.pgnet_request_ledger FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.classify_pgnet_outcome(integer, boolean, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.record_pgnet_request(bigint, text, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.http_post_recorded(text, text, jsonb, jsonb, integer) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.reap_pgnet_outcomes(interval, interval) FROM %I', r);
    END IF;
  END LOOP;
END;
$acl$;

-- Guarded: the replay lane has no pg_cron.

-- pg_net can reuse a request id, and call_edge_function's ON CONFLICT only moves
-- called_at, so any update that moves called_at resets the outcome to pending.
CREATE OR REPLACE FUNCTION monitoring.pgnet_ledger_reset_on_reemit()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.called_at IS DISTINCT FROM OLD.called_at THEN
    NEW.outcome     := 'pending';
    NEW.status_code := NULL;
    NEW.error_msg   := NULL;
    NEW.timed_out   := NULL;
    NEW.settled_at  := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION monitoring.pgnet_ledger_reset_on_reemit() OWNER TO postgres;
REVOKE ALL ON FUNCTION monitoring.pgnet_ledger_reset_on_reemit() FROM PUBLIC;

DROP TRIGGER IF EXISTS pgnet_ledger_reset_on_reemit ON monitoring.pgnet_request_ledger;
CREATE TRIGGER pgnet_ledger_reset_on_reemit
  BEFORE UPDATE ON monitoring.pgnet_request_ledger
  FOR EACH ROW EXECUTE FUNCTION monitoring.pgnet_ledger_reset_on_reemit();

-- No PUBLIC grant: granted to the direct jobs' cron.job.username roles, aborting on a client role.
DO $grants$
DECLARE
  v_roles text[];
  r       text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'PS-422: pg_cron absent on % -- no direct-job roles to grant', current_database();
    RETURN;
  END IF;
  EXECUTE $q$
    SELECT array_agg(DISTINCT username)
      FROM cron.job
     WHERE database = current_database()
       AND command ~* 'net\.http_post'
  $q$ INTO v_roles;
  IF v_roles && ARRAY['anon', 'authenticated', 'service_role']::text[] THEN
    RAISE EXCEPTION
      'PS-422: a direct net.http_post job runs as a client role (%); granting it the wrapper is an operator decision',
      v_roles;
  END IF;
  FOREACH r IN ARRAY COALESCE(v_roles, ARRAY[]::text[]) LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA monitoring TO %I', r);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION monitoring.http_post_recorded(text, text, jsonb, jsonb, integer) TO %I', r);
    RAISE NOTICE 'PS-422: granted monitoring.http_post_recorded to cron role %', r;
  END LOOP;
END;
$grants$;

DO $schedule$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE
      'PS-422: pg_cron is not installed on database % -- the reaper is created but NOT scheduled here. This is expected on the pgTAP replay lane and is a hard miss anywhere else.',
      current_database();
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT cron.unschedule(jobid) FROM cron.job
     WHERE jobname = 'pgnet-outcome-reaper'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'pgnet-outcome-reaper',
      '*/5 * * * *',
      'SELECT monitoring.reap_pgnet_outcomes();')
  $sql$;

  RAISE NOTICE 'PS-422: scheduled pgnet-outcome-reaper on %', current_database();
END;
$schedule$;

DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['outcome', 'status_code', 'error_msg', 'timed_out', 'settled_at']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'monitoring'
        AND table_name = 'pgnet_request_ledger'
        AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PS-422 verify: pgnet_request_ledger is missing %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pgnet_request_ledger_outcome_check'
       AND conrelid = 'monitoring.pgnet_request_ledger'::regclass
  ) THEN
    RAISE EXCEPTION 'PS-422 verify: the outcome CHECK constraint is absent, so any string could be written as an outcome';
  END IF;

  -- The cron command is the zero-argument call. If the defaults stop covering
  -- every parameter, the scheduled reaper fails every five minutes in silence
  -- and the ledger quietly stops settling.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'monitoring' AND p.proname = 'reap_pgnet_outcomes'
     AND p.pronargdefaults = p.pronargs;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PS-422 verify: monitoring.reap_pgnet_outcomes() is not callable with zero arguments, so the cron command cannot run';
  END IF;

  -- The classifier is the definition of success; assert it here rather than
  -- trusting the CASE to have been written the way the comment claims.
  IF monitoring.classify_pgnet_outcome(200, false, NULL) <> 'succeeded'
     OR monitoring.classify_pgnet_outcome(500, false, NULL) <> 'failed'
     OR monitoring.classify_pgnet_outcome(404, false, NULL) <> 'failed'
     OR monitoring.classify_pgnet_outcome(NULL, true, NULL) <> 'failed'
     OR monitoring.classify_pgnet_outcome(NULL, false, 'conn refused') <> 'failed'
     OR monitoring.classify_pgnet_outcome(NULL, false, NULL) <> 'failed' THEN
    RAISE EXCEPTION 'PS-422 verify: classify_pgnet_outcome does not classify the six reference cases as documented';
  END IF;

  RAISE NOTICE 'PS-422 verify: outcome columns, constraint, zero-arg reaper and classifier all present on %', current_database();
END;
$verify$;

COMMIT;

-- Rollback: re-point jobs using http_post_recorded() first, or dropping it breaks them.

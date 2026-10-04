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

COMMIT;

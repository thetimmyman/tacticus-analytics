-- Rollback for 20260919011000: monitoring.notify() verbatim from its prior migration.
-- Run this first; for a full withdrawal then drop both check_staleness overloads,
-- stale_alerts(), alert_expectation and alert_state's two new columns.

-- === SIGNATURES ===
-- monitoring.notify(text,text,text,text,boolean)
-- === DEFS ===
CREATE OR REPLACE FUNCTION monitoring.notify(p_alert_key text, p_status text, p_title text, p_body text DEFAULT NULL::text, p_quiet boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  prev_status TEXT;
  prev_since  TIMESTAMPTZ;
  webhook_url TEXT;
  colour int;
  prefix text;
  since_txt text := '';
  payload jsonb;
BEGIN
  IF p_status NOT IN ('firing', 'cleared') THEN
    RAISE EXCEPTION 'monitoring.notify: status must be firing|cleared, got %', p_status;
  END IF;

  -- Per-key lock: without it two concurrent reporters can both observe the old
  -- status and both post the same transition.
  SELECT s.status, s.since INTO prev_status, prev_since
    FROM monitoring.alert_state s
   WHERE s.alert_key = p_alert_key
     FOR UPDATE;

  -- Unchanged: refresh liveness only. Never posts.
  IF prev_status IS NOT DISTINCT FROM p_status THEN
    UPDATE monitoring.alert_state
       SET last_seen_at = now(), last_title = p_title, last_body = p_body
     WHERE alert_key = p_alert_key;
    RETURN false;
  END IF;

  -- First sighting of an already-healthy key is not news, but DO register it so
  -- the table is a complete coverage index rather than a list of things that
  -- have happened to break.
  IF prev_status IS NULL AND p_status = 'cleared' THEN
    INSERT INTO monitoring.alert_state (alert_key, status, since, last_seen_at, last_title, last_body)
    VALUES (p_alert_key, 'cleared', now(), now(), p_title, p_body)
    ON CONFLICT (alert_key) DO UPDATE
       SET last_seen_at = now(), last_title = EXCLUDED.last_title, last_body = EXCLUDED.last_body;
    RETURN false;
  END IF;

  -- A real transition. Record it ONLY after delivery is accepted (defect 1),
  -- except in quiet mode where there is nothing to deliver.
  IF NOT p_quiet THEN
    webhook_url := internal.get_secret('monitoring_webhook_url');
    IF webhook_url IS NULL OR webhook_url = '' THEN
      -- Deliberately does NOT write state: leaving it untouched is what lets
      -- the next run retry instead of silently swallowing the transition.
      RAISE WARNING '[monitoring.notify] % -> % NOT recorded: no monitoring_webhook_url configured (will retry next run)',
        p_alert_key, p_status;
      RETURN false;
    END IF;

    IF p_status = 'firing' THEN
      colour := 15548997; prefix := '🔴 ';
    ELSE
      colour := 3066993;  prefix := '🟢 RESOLVED — ';
      -- prev_since, captured before any write (defect 2).
      IF prev_since IS NOT NULL THEN
        since_txt := format(E'\nWas firing for %s.', justify_interval(now() - prev_since));
      END IF;
    END IF;

    payload := jsonb_build_object(
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', prefix || p_title,
        'description', LEFT(COALESCE(p_body, '') || since_txt, 1900),
        'color', colour,
        'footer', jsonb_build_object('text', 'alert_key: ' || p_alert_key),
        'timestamp', now()::text
      )));

    BEGIN
      PERFORM net.http_post(url := webhook_url,
                            headers := '{"Content-Type": "application/json"}'::jsonb,
                            body := payload);
    EXCEPTION WHEN undefined_function THEN
      -- Legacy pg_net exposes a TEXT body (defect 4) — same fallback
      -- call_edge_function() carries.
      PERFORM net.http_post(url := webhook_url,
                            headers := '{"Content-Type": "application/json"}'::jsonb,
                            body := payload::text);
    END;
  END IF;

  INSERT INTO monitoring.alert_state (alert_key, status, since, last_seen_at, last_title, last_body)
  VALUES (p_alert_key, p_status, now(), now(), p_title, p_body)
  ON CONFLICT (alert_key) DO UPDATE
     SET status = EXCLUDED.status, since = now(), last_seen_at = now(),
         last_title = EXCLUDED.last_title, last_body = EXCLUDED.last_body;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  -- A notifier must never take down its caller. State is deliberately left
  -- as-is so the transition is retried rather than lost.
  RAISE WARNING '[monitoring.notify] % -> % failed (state unchanged, will retry): %',
    p_alert_key, p_status, SQLERRM;
  RETURN false;
END;
$$;

ALTER FUNCTION monitoring.notify(p_alert_key text, p_status text, p_title text, p_body text, p_quiet boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION monitoring.notify(p_alert_key text, p_status text, p_title text, p_body text, p_quiet boolean) FROM PUBLIC;

-- Rollback capture of monitoring.notify()'s live body immediately before the
-- persistence-gate migration (2026-10-04, copied verbatim from
-- tmos-sentinel/alert-routing/backup/notify.postgres.live-20261004.sql rather
-- than re-deriving it, same discipline as the existing rollback captures in
-- this directory). Run this first; for a full withdrawal then also:
--   DROP FUNCTION IF EXISTS monitoring.alert_policy_for(TEXT);
--   DROP TABLE IF EXISTS monitoring.alert_policy;
--   ALTER TABLE monitoring.alert_state DROP COLUMN IF EXISTS consecutive_count;
-- Alert status, since, last_seen_at, last_notified_at and renotify_count are
-- untouched either way. Dropping consecutive_count loses only the
-- in-progress persistence counter for currently-gated episodes.

=== SIGNATURES ===
monitoring.notify(text,text,text,text,boolean)
=== DEFS ===
CREATE OR REPLACE FUNCTION monitoring.notify(p_alert_key text, p_status text, p_title text, p_body text DEFAULT NULL::text, p_quiet boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tracked boolean := false;  -- ops-autopilot: set when the key is tracked in Plane
  prev_status TEXT;
  prev_since  TIMESTAMPTZ;
  webhook_url TEXT;
  colour int;
  prefix text;
  since_txt text := '';
  payload jsonb;
  -- PS-411.
  prev_notified TIMESTAMPTZ;
  prev_count    integer;
  due_after     interval;
BEGIN
  IF p_status NOT IN ('firing', 'cleared') THEN
    RAISE EXCEPTION 'monitoring.notify: status must be firing|cleared, got %', p_status;
  END IF;

  -- ops-autopilot: tracked in Plane -> record state, never post, never remind, report not-delivered.
  IF monitoring.is_tracked(p_alert_key) THEN
    p_quiet := true;
    v_tracked := true;
  END IF;

  -- Per-key lock: without it two concurrent reporters can both observe the old
  -- status and both post the same transition.
  SELECT s.status, s.since, s.last_notified_at, s.renotify_count
    INTO prev_status, prev_since, prev_notified, prev_count
    FROM monitoring.alert_state s
   WHERE s.alert_key = p_alert_key
     FOR UPDATE;

  -- Unchanged: refresh liveness only. Never posts...
  IF prev_status IS NOT DISTINCT FROM p_status THEN

    -- ...EXCEPT for a still-firing alert whose reminder has come due (PS-411).
    -- `cleared` never reminds; quiet mode never reminds (it delivers nothing,
    -- so a counter increment there would be a lie); a key with no delivery
    -- behind it (last_notified_at NULL) never reminds, because there is no
    -- clock to decay from. The decay is measured from the last ACCEPTED post:
    --   0 reminders so far -> 1 hour, 1 -> 6 hours, 2 or more -> daily.
    due_after := CASE COALESCE(prev_count, 0)
                   WHEN 0 THEN INTERVAL '1 hour'
                   WHEN 1 THEN INTERVAL '6 hours'
                   ELSE INTERVAL '1 day'
                 END;

    IF p_status = 'firing' AND NOT p_quiet
       AND prev_notified IS NOT NULL
       AND now() - prev_notified >= due_after THEN

      webhook_url := monitoring.webhook_for(p_alert_key);
      IF webhook_url IS NULL OR webhook_url = '' THEN
        -- Liveness still refreshes — the monitor DID run — but the reminder
        -- clock deliberately does not move, so it is retried next run.
        UPDATE monitoring.alert_state
           SET last_seen_at = now(), last_title = p_title, last_body = p_body
         WHERE alert_key = p_alert_key;
        RAISE WARNING '[monitoring.notify] % reminder NOT sent: no monitoring_webhook_url configured (will retry next run)',
          p_alert_key;
        RETURN false;
      END IF;

      payload := jsonb_build_object(
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', format('🔴 STILL FIRING (reminder %s) — %s', COALESCE(prev_count, 0) + 1, p_title),
          'description', LEFT(COALESCE(p_body, '')
                              || CASE WHEN prev_since IS NOT NULL
                                   THEN format(E'\nFiring for %s.', justify_interval(now() - prev_since))
                                   ELSE '' END, 1900),
          'color', 15548997,
          'footer', jsonb_build_object('text', 'alert_key: ' || p_alert_key),
          'timestamp', now()::text
        )));

      BEGIN
        PERFORM net.http_post(url := webhook_url,
                              headers := '{"Content-Type": "application/json"}'::jsonb,
                              body := payload);
      EXCEPTION WHEN undefined_function THEN
        PERFORM net.http_post(url := webhook_url,
                              headers := '{"Content-Type": "application/json"}'::jsonb,
                              body := payload::text);
      END;

      -- Recorded only after delivery was accepted. If the post above raised,
      -- the handler at the bottom leaves last_notified_at where it was and the
      -- reminder is retried — the same discipline an undeliverable transition
      -- already has.
      UPDATE monitoring.alert_state
         SET last_seen_at = now(), last_title = p_title, last_body = p_body,
             last_notified_at = now(),
             renotify_count = COALESCE(prev_count, 0) + 1
       WHERE alert_key = p_alert_key;
      RETURN true;
    END IF;

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
    webhook_url := monitoring.webhook_for(p_alert_key);
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

  -- PS-411: a transition resets the reminder clock. In quiet mode nothing was
  -- delivered, so last_notified_at is left NULL rather than claiming a post.
  INSERT INTO monitoring.alert_state (alert_key, status, since, last_seen_at, last_title, last_body,
                                      last_notified_at, renotify_count)
  VALUES (p_alert_key, p_status, now(), now(), p_title, p_body,
          CASE WHEN p_quiet THEN NULL ELSE now() END, 0)
  ON CONFLICT (alert_key) DO UPDATE
     SET status = EXCLUDED.status, since = now(), last_seen_at = now(),
         last_title = EXCLUDED.last_title, last_body = EXCLUDED.last_body,
         last_notified_at = CASE WHEN p_quiet THEN NULL ELSE now() END,
         renotify_count = 0;
  RETURN NOT v_tracked;  -- true = delivered; a tracked transition is recorded, not posted
EXCEPTION WHEN OTHERS THEN
  -- A notifier must never take down its caller. State is deliberately left
  -- as-is so the transition is retried rather than lost.
  RAISE WARNING '[monitoring.notify] % -> % failed (state unchanged, will retry): %',
    p_alert_key, p_status, SQLERRM;
  RETURN false;
END;
$function$
;

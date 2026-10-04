-- monitoring.notify() posted to Discord on every first 'firing' report and
-- re-reminded hourly, which spammed the channel with single-cycle blips.
-- target-db: postgres  (Tacticus Analytics / tacticusanalytics.com)

-- Adds a persistence gate before the first post (monitoring.alert_policy,
-- longest-LIKE-pattern-wins, same convention as alert_route /
-- alert_expectation / alert_tracking), a silent reset for an episode that
-- was never actually posted, and slows reminder decay from three tiers
-- (1h/6h/24h) to two (6h/24h). Per-pattern rationale lives in each seed
-- row's own note column below, cited rather than guessed.

-- Routing, the quiet-caller / Plane-tracking contract, staleness tracking,
-- and last_seen_at/last_title/last_body liveness bookkeeping are unchanged;
-- the verify block below checks notify() still calls webhook_for and
-- is_tracked. Rollback captures notify()'s pre-change body in
-- supabase/snippets/20261004200000_rollback_alert_persistence_policy.sql.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'this migration requires database postgres, got %', current_database();
  END IF;
  IF to_regclass('monitoring.alert_state') IS NULL THEN
    RAISE EXCEPTION 'this migration requires monitoring.alert_state; it does not exist on %', current_database();
  END IF;
  IF to_regprocedure('monitoring.webhook_for(text)') IS NULL THEN
    RAISE EXCEPTION 'this migration requires monitoring.webhook_for(text) (20260925170000_alert_channel_routing.sql); it does not exist on %', current_database();
  END IF;
  IF to_regprocedure('monitoring.is_tracked(text)') IS NULL THEN
    RAISE EXCEPTION 'this migration requires monitoring.is_tracked(text) (20260925190000_alert_tracking_quiet.sql); it does not exist on %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. monitoring.alert_policy + alert_policy_for()
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS monitoring.alert_policy (
  key_pattern          TEXT PRIMARY KEY,
  min_consecutive      INTEGER NOT NULL DEFAULT 2 CHECK (min_consecutive >= 1),
  min_firing_duration  INTERVAL,
  note                 TEXT,
  added_by             TEXT,
  added_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE monitoring.alert_policy IS
  'Persistence-before-first-post policy: longest-LIKE-pattern-wins, same convention as alert_route/alert_expectation/alert_tracking. min_consecutive consecutive firing reports, OR firing continuously (since alert_state.since) for min_firing_duration, whichever comes first, before the first Discord post for an episode. NULL min_firing_duration means only the consecutive-report count gates the key.';

REVOKE ALL ON TABLE monitoring.alert_policy FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE monitoring.alert_policy FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE monitoring.alert_policy FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE monitoring.alert_policy FROM service_role';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION monitoring.alert_policy_for(p_alert_key text)
 RETURNS TABLE(matched_pattern text, min_consecutive integer, min_firing_duration interval)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p.key_pattern, p.min_consecutive, p.min_firing_duration
    FROM monitoring.alert_policy p
   WHERE p_alert_key LIKE p.key_pattern
   ORDER BY length(p.key_pattern) DESC, p.key_pattern
   LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION monitoring.alert_policy_for(TEXT) FROM PUBLIC;

ALTER TABLE monitoring.alert_state
  ADD COLUMN IF NOT EXISTS consecutive_count INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN monitoring.alert_state.consecutive_count IS
  'Consecutive ''firing'' reports seen for the current episode, toward monitoring.alert_policy_for()''s min_consecutive gate. Reset to 0 on every transition (a new episode starts a new count).';

-- ---------------------------------------------------------------------------
-- 2. Seed policy rows (cited against this repo's actual schedules)
-- ---------------------------------------------------------------------------

INSERT INTO monitoring.alert_policy (key_pattern, min_consecutive, min_firing_duration, note, added_by) VALUES
  ('%',                   2, interval '10 minutes', 'Default: 2 consecutive firing reports, or firing continuously >= 10 minutes, whichever comes first.', 'alert-persistence-gate'),
  ('%.blind',             3, NULL,                  '"Could not check" keys need 3 consecutive reports — a check that cannot run only matters if it stays that way.', 'alert-persistence-gate'),
  ('monitoring.staleness', 1, NULL,                 'The staleness meta-alert itself, posted by monitoring.check_staleness() on the shared token-monitor-heartbeat CronJob (tacticus-infra, every 6h, run across the shared cluster''s databases). Gating the gate would double the time to notice something went silent.', 'alert-persistence-gate'),
  ('roster.write.%',      1, NULL,                  'Daily (guild-roster-write-monitor, one key per guild, see 20260910010000_ps513_roster_write_monitor.sql). A once-a-day monitor must post on its first report.', 'alert-persistence-gate'),
  ('deploy-drift.host.%', 1, NULL,                  'Daily (deploy/host/systemd/tacticus-deploy-drift-check.timer, OnCalendar=*-*-* 09:20:00, per monitoring.alert_expectation). A once-a-day monitor must post on its first report.', 'alert-persistence-gate'),
  ('tokens.%',            1, NULL,                  'Daily (the token-invariant-monitor pg_cron job, see 20260904080000_ps200_estimator_freshness_guard.sql). A once-a-day monitor must post on its first report.', 'alert-persistence-gate'),
  ('tp411.%',             1, NULL,                  'Pre-existing pgtap test fixture key (not a production alert) — pinned to immediate-post so the existing reminder-decay/quiet-caller tests stay unaffected by this gate.', 'alert-persistence-gate')
ON CONFLICT (key_pattern) DO UPDATE
   SET min_consecutive = EXCLUDED.min_consecutive,
       min_firing_duration = EXCLUDED.min_firing_duration,
       note = EXCLUDED.note,
       added_by = EXCLUDED.added_by,
       added_at = now();

-- ---------------------------------------------------------------------------
-- 3. monitoring.notify() — persistence gate + silent reset + 6h/24h decay
-- ---------------------------------------------------------------------------

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
  -- Reminder decay.
  prev_notified TIMESTAMPTZ;
  prev_count    integer;
  due_after     interval;
  -- Persistence gate.
  prev_consecutive  INTEGER;
  v_min_consecutive INTEGER;
  v_min_duration    INTERVAL;
  v_force           boolean;
  v_new_consecutive INTEGER;
  v_posted          boolean;
BEGIN
  IF p_status NOT IN ('firing', 'cleared') THEN
    RAISE EXCEPTION 'monitoring.notify: status must be firing|cleared, got %', p_status;
  END IF;

  -- ops-autopilot: tracked in Plane -> record state, never post, never remind, report not-delivered.
  IF monitoring.is_tracked(p_alert_key) THEN
    p_quiet := true;
    v_tracked := true;
  END IF;

  -- Cheap override: a caller that has already debounced this report itself
  -- can force an immediate post without a signature change. Reading a
  -- session GUC is free next to the row lock below.
  v_force := COALESCE(current_setting('app.settings.alert_force_immediate', true), '') IN ('1', 'true', 'on', 'yes');

  -- Per-key lock: without it two concurrent reporters can both observe the old
  -- status and both post the same transition.
  SELECT s.status, s.since, s.last_notified_at, s.renotify_count, s.consecutive_count
    INTO prev_status, prev_since, prev_notified, prev_count, prev_consecutive
    FROM monitoring.alert_state s
   WHERE s.alert_key = p_alert_key
     FOR UPDATE;

  -- Unchanged: refresh liveness only, except...
  IF prev_status IS NOT DISTINCT FROM p_status THEN

    IF p_status = 'firing' AND NOT p_quiet AND prev_notified IS NULL THEN
      -- Persistence gate: this episode has never posted. Hold it until
      -- policy is met (N consecutive reports, or firing continuously long
      -- enough), same mechanism as a fresh transition below.
      v_new_consecutive := COALESCE(prev_consecutive, 1) + 1;
      SELECT pf.min_consecutive, pf.min_firing_duration
        INTO v_min_consecutive, v_min_duration
        FROM monitoring.alert_policy_for(p_alert_key) pf;

      IF NOT (v_force
              OR v_new_consecutive >= COALESCE(v_min_consecutive, 2)
              OR (v_min_duration IS NOT NULL AND prev_since IS NOT NULL
                  AND now() - prev_since >= v_min_duration)) THEN
        UPDATE monitoring.alert_state
           SET last_seen_at = now(), last_title = p_title, last_body = p_body,
               consecutive_count = v_new_consecutive
         WHERE alert_key = p_alert_key;
        RETURN false;
      END IF;

      webhook_url := monitoring.webhook_for(p_alert_key);
      IF webhook_url IS NULL OR webhook_url = '' THEN
        UPDATE monitoring.alert_state
           SET last_seen_at = now(), last_title = p_title, last_body = p_body,
               consecutive_count = v_new_consecutive
         WHERE alert_key = p_alert_key;
        RAISE WARNING '[monitoring.notify] % -> firing NOT recorded: no monitoring_webhook_url configured (will retry next run)',
          p_alert_key;
        RETURN false;
      END IF;

      payload := jsonb_build_object(
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '🔴 ' || p_title,
          'description', LEFT(COALESCE(p_body, ''), 1900),
          'color', 15548997,
          'footer', jsonb_build_object('text', 'alert_key: ' || p_alert_key),
          'timestamp', now()::text
        )));

      BEGIN
        PERFORM net.http_post(url := webhook_url,
                              headers := '{"Content-Type": "application/json"}'::jsonb,
                              body := payload);
      EXCEPTION WHEN undefined_function THEN
        -- Legacy pg_net exposes a TEXT body — same fallback call_edge_function() carries.
        PERFORM net.http_post(url := webhook_url,
                              headers := '{"Content-Type": "application/json"}'::jsonb,
                              body := payload::text);
      END;

      UPDATE monitoring.alert_state
         SET last_seen_at = now(), last_title = p_title, last_body = p_body,
             last_notified_at = now(), renotify_count = 0,
             consecutive_count = v_new_consecutive
       WHERE alert_key = p_alert_key;
      RETURN true;
    END IF;

    -- ...a still-firing alert whose reminder has come due. 'cleared' never
    -- reminds; quiet mode never reminds; a key with no delivery behind it is
    -- handled above (the gate), not here. Decay: 0 reminders so far -> 6
    -- hours, 1 or more -> daily.
    due_after := CASE COALESCE(prev_count, 0)
                   WHEN 0 THEN INTERVAL '6 hours'
                   ELSE        INTERVAL '24 hours'
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
    INSERT INTO monitoring.alert_state (alert_key, status, since, last_seen_at, last_title, last_body, consecutive_count)
    VALUES (p_alert_key, 'cleared', now(), now(), p_title, p_body, 0)
    ON CONFLICT (alert_key) DO UPDATE
       SET last_seen_at = now(), last_title = EXCLUDED.last_title, last_body = EXCLUDED.last_body;
    RETURN false;
  END IF;

  -- Silent reset: an alert clearing that was NEVER actually posted (the gate
  -- above held every report) has nothing to resolve. Reset silently instead
  -- of announcing a RESOLVED nobody ever saw fire. Plane-tracked keys are
  -- exempt: they never post by design and must keep recording every
  -- transition.
  IF p_status = 'cleared' AND prev_notified IS NULL AND NOT v_tracked THEN
    UPDATE monitoring.alert_state
       SET status = 'cleared', since = now(), last_seen_at = now(),
           last_title = p_title, last_body = p_body,
           last_notified_at = NULL, renotify_count = 0, consecutive_count = 0
     WHERE alert_key = p_alert_key;
    RETURN false;
  END IF;

  IF p_status = 'firing' THEN
    -- A fresh episode starts subject to the same persistence gate as a
    -- continuing one above: this is report #1 of however many the key's
    -- policy requires.
    v_new_consecutive := 1;
    v_posted := false;

    IF NOT p_quiet THEN
      webhook_url := monitoring.webhook_for(p_alert_key);
      IF webhook_url IS NULL OR webhook_url = '' THEN
        -- Deliberately does NOT write state: leaving it untouched is what lets
        -- the next run retry instead of silently swallowing the transition.
        RAISE WARNING '[monitoring.notify] % -> % NOT recorded: no monitoring_webhook_url configured (will retry next run)',
          p_alert_key, p_status;
        RETURN false;
      END IF;

      SELECT pf.min_consecutive, pf.min_firing_duration
        INTO v_min_consecutive, v_min_duration
        FROM monitoring.alert_policy_for(p_alert_key) pf;

      IF v_force OR v_new_consecutive >= COALESCE(v_min_consecutive, 2) THEN
        payload := jsonb_build_object(
          'embeds', jsonb_build_array(jsonb_build_object(
            'title', '🔴 ' || p_title,
            'description', LEFT(COALESCE(p_body, ''), 1900),
            'color', 15548997,
            'footer', jsonb_build_object('text', 'alert_key: ' || p_alert_key),
            'timestamp', now()::text
          )));

        BEGIN
          PERFORM net.http_post(url := webhook_url,
                                headers := '{"Content-Type": "application/json"}'::jsonb,
                                body := payload);
        EXCEPTION WHEN undefined_function THEN
          -- Legacy pg_net exposes a TEXT body — same fallback call_edge_function() carries.
          PERFORM net.http_post(url := webhook_url,
                                headers := '{"Content-Type": "application/json"}'::jsonb,
                                body := payload::text);
        END;
        v_posted := true;
      END IF;
      -- else: policy not yet met on report #1 — fall through and record the
      -- episode (webhook existence already confirmed, so it's safe to track)
      -- without posting.
    END IF;

    INSERT INTO monitoring.alert_state (alert_key, status, since, last_seen_at, last_title, last_body,
                                        last_notified_at, renotify_count, consecutive_count)
    VALUES (p_alert_key, 'firing', now(), now(), p_title, p_body,
            CASE WHEN v_posted THEN now() ELSE NULL END, 0, v_new_consecutive)
    ON CONFLICT (alert_key) DO UPDATE
       SET status = 'firing', since = now(), last_seen_at = now(),
           last_title = EXCLUDED.last_title, last_body = EXCLUDED.last_body,
           last_notified_at = CASE WHEN v_posted THEN now() ELSE NULL END,
           renotify_count = 0, consecutive_count = v_new_consecutive;
    RETURN CASE WHEN p_quiet THEN NOT v_tracked ELSE v_posted END;
  END IF;

  -- p_status = 'cleared', transitioning from a real (posted or Plane-tracked)
  -- firing episode. Record it ONLY after delivery is accepted, except in
  -- quiet mode where there is nothing to deliver.
  IF NOT p_quiet THEN
    webhook_url := monitoring.webhook_for(p_alert_key);
    IF webhook_url IS NULL OR webhook_url = '' THEN
      -- Deliberately does NOT write state: leaving it untouched is what lets
      -- the next run retry instead of silently swallowing the transition.
      RAISE WARNING '[monitoring.notify] % -> % NOT recorded: no monitoring_webhook_url configured (will retry next run)',
        p_alert_key, p_status;
      RETURN false;
    END IF;

    colour := 3066993;  prefix := '🟢 RESOLVED — ';
    IF prev_since IS NOT NULL THEN
      since_txt := format(E'\nWas firing for %s.', justify_interval(now() - prev_since));
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
      PERFORM net.http_post(url := webhook_url,
                            headers := '{"Content-Type": "application/json"}'::jsonb,
                            body := payload::text);
    END;
  END IF;

  -- A transition resets the reminder clock. In quiet mode nothing was
  -- delivered, so last_notified_at is left NULL rather than claiming a post.
  INSERT INTO monitoring.alert_state (alert_key, status, since, last_seen_at, last_title, last_body,
                                      last_notified_at, renotify_count, consecutive_count)
  VALUES (p_alert_key, p_status, now(), now(), p_title, p_body,
          CASE WHEN p_quiet THEN NULL ELSE now() END, 0, 0)
  ON CONFLICT (alert_key) DO UPDATE
     SET status = EXCLUDED.status, since = now(), last_seen_at = now(),
         last_title = EXCLUDED.last_title, last_body = EXCLUDED.last_body,
         last_notified_at = CASE WHEN p_quiet THEN NULL ELSE now() END,
         renotify_count = 0, consecutive_count = 0;
  RETURN NOT v_tracked;  -- true = delivered; a tracked transition is recorded, not posted
EXCEPTION WHEN OTHERS THEN
  -- A notifier must never take down its caller. State is deliberately left
  -- as-is so the transition is retried rather than lost.
  RAISE WARNING '[monitoring.notify] % -> % failed (state unchanged, will retry): %',
    p_alert_key, p_status, SQLERRM;
  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION monitoring.notify(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  v_rec record;
  v_src text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'monitoring' AND table_name = 'alert_state'
       AND column_name = 'consecutive_count') THEN
    RAISE EXCEPTION 'verify: alert_state is missing consecutive_count';
  END IF;

  SELECT * INTO v_rec FROM monitoring.alert_policy_for('totally-unmatched-alert-key');
  IF v_rec.matched_pattern IS DISTINCT FROM '%' OR v_rec.min_consecutive IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'verify: an unmatched key does not resolve to the generic % policy (got %, %)',
      v_rec.matched_pattern, v_rec.min_consecutive;
  END IF;

  SELECT * INTO v_rec FROM monitoring.alert_policy_for('tp411.anything');
  IF v_rec.matched_pattern IS DISTINCT FROM 'tp411.%' OR v_rec.min_consecutive IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'verify: tp411.% does not resolve to immediate-post (got %, %)',
      v_rec.matched_pattern, v_rec.min_consecutive;
  END IF;

  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'monitoring' AND p.proname = 'notify';
  IF v_src !~ 'alert_policy_for' THEN
    RAISE EXCEPTION 'verify: monitoring.notify() does not carry the persistence gate';
  END IF;
  IF v_src ~ 'INTERVAL ''1 hour''' THEN
    RAISE EXCEPTION 'verify: monitoring.notify() still references the old 1-hour reminder step';
  END IF;

  -- The three unchanged behaviors this migration must not disturb.
  IF v_src !~ 'monitoring\.webhook_for' THEN
    RAISE EXCEPTION 'verify: monitoring.notify() lost its routing lookup';
  END IF;
  IF v_src !~ 'monitoring\.is_tracked' THEN
    RAISE EXCEPTION 'verify: monitoring.notify() lost the Plane-tracking / quiet contract';
  END IF;

  RAISE NOTICE 'verify OK: policy rows seeded, notify() carries the persistence gate, decay is 6h/24h';
END;
$verify$;

COMMIT;

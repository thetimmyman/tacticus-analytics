-- Per-pattern cadence for monitoring.alert_state, one rollup alert naming stopped
-- monitors, and a decaying reminder (1h, 6h, daily) for alerts still firing.
-- target-db: postgres  (Tacticus Analytics / tacticusanalytics.com)
-- notify() refreshes last_seen_at on every call, so a stale row means the monitor stopped.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-411 requires database postgres, got %', current_database();
  END IF;
  IF to_regclass('monitoring.alert_state') IS NULL THEN
    RAISE EXCEPTION
      'PS-411 requires monitoring.alert_state; it does not exist on %',
      current_database();
  END IF;
END;
$guard$;

-- The longest LIKE pattern wins, so '%' is an overridable floor; ties break on text.

CREATE TABLE IF NOT EXISTS monitoring.alert_expectation (
  key_pattern       text PRIMARY KEY,
  expected_interval interval NOT NULL,
  note              text,
  added_by          text,
  added_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE monitoring.alert_expectation OWNER TO postgres;

COMMENT ON TABLE monitoring.alert_expectation IS
  'PS-411: how often each monitoring.alert_state key is expected to be written. Matched by SQL LIKE against alert_key; the longest matching key_pattern wins. Read by monitoring.stale_alerts().';
COMMENT ON COLUMN monitoring.alert_expectation.expected_interval IS
  'PS-411: a key whose last_seen_at is older than this is stale — the monitor behind it has stopped running. Cite the cadence in note; a guessed interval either pages at 03:00 or hides a dead monitor.';
COMMENT ON COLUMN monitoring.alert_expectation.note IS
  'PS-411: WHERE the cadence comes from — a file and the schedule it declares, or the runbook that sets it. Rows without provenance are how this table rots.';

-- Every row cites a schedule declared in this repo and allows one missed run.
INSERT INTO monitoring.alert_expectation
  (key_pattern, expected_interval, note, added_by)
VALUES
  ('%', INTERVAL '7 days',
   'PS-411 catch-all floor. Deliberately conservative: it exists so a key with no declared cadence is still eventually noticed, not so it is judged accurately. Give a key its own row rather than lowering this.',
   'PS-411'),
  ('tokens.%', INTERVAL '2 days',
   'Daily. supabase/migrations/20260904080000_ps200_estimator_freshness_guard.sql: pg_cron job 455 `token-invariant-monitor`, schedule `23 9 * * *`. Two days allows one missed run.',
   'PS-411'),
  ('roster.write.%', INTERVAL '2 days',
   'Daily. supabase/migrations/20260910010000_ps513_roster_write_monitor.sql schedules `guild-roster-write-monitor` at `47 9 * * *`; it writes one key per guild. Two days allows one missed run.',
   'PS-411'),
  ('deploy-drift.host.%', INTERVAL '2 days',
   'Daily. deploy/host/systemd/tacticus-deploy-drift-check.timer: `OnCalendar=*-*-* 09:20:00` (RandomizedDelaySec=5m, Persistent=true). Two days allows one missed run.',
   'PS-411')
ON CONFLICT (key_pattern) DO NOTHING;

ALTER TABLE monitoring.alert_state
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS renotify_count   integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN monitoring.alert_state.last_notified_at IS
  'PS-411: when a post for this key was last ACCEPTED by the webhook — a transition or a reminder. NULL means nothing has been delivered for this key (including a transition recorded in quiet mode), and a NULL never reminds.';
COMMENT ON COLUMN monitoring.alert_state.renotify_count IS
  'PS-411: reminders delivered since this key last changed status. Reset to 0 on every transition. Drives the decay: 0 -> next reminder 1h after last_notified_at, 1 -> 6h, 2+ -> daily.';

-- Seed the reminder clock so the apply does not page every firing alert at once.
UPDATE monitoring.alert_state
   SET last_notified_at = now()
 WHERE status = 'firing'
   AND last_notified_at IS NULL;

-- LATERAL so the matched pattern and its interval come from the same row.

CREATE OR REPLACE FUNCTION monitoring.stale_alerts()
RETURNS TABLE (
  alert_key         text,
  status            text,
  last_seen_at      timestamptz,
  expected_interval interval,
  overdue_by        interval
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT s.alert_key,
         s.status,
         s.last_seen_at,
         e.expected_interval,
         (now() - s.last_seen_at) - e.expected_interval AS overdue_by
    FROM monitoring.alert_state AS s
    CROSS JOIN LATERAL (
      SELECT x.expected_interval
        FROM monitoring.alert_expectation AS x
       WHERE s.alert_key LIKE x.key_pattern
       ORDER BY length(x.key_pattern) DESC, x.key_pattern
       LIMIT 1
    ) AS e
   WHERE s.last_seen_at < now() - e.expected_interval
   ORDER BY (now() - s.last_seen_at) - e.expected_interval DESC, s.alert_key;
$$;

ALTER FUNCTION monitoring.stale_alerts() OWNER TO postgres;

COMMENT ON FUNCTION monitoring.stale_alerts() IS
  'PS-411: every monitoring.alert_state key whose last_seen_at is older than its matched monitoring.alert_expectation. A row here means the MONITOR stopped, whatever its status says.';

-- One key; it does not exclude itself, so its count equals stale_alerts().

CREATE OR REPLACE FUNCTION monitoring.check_staleness() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  c_key  constant text    := 'monitoring.staleness';
  c_cap  constant integer := 20;
  v_n    integer := 0;
  v_body text;
BEGIN
  SELECT count(*)::integer INTO v_n FROM monitoring.stale_alerts();

  IF v_n > 0 THEN
    SELECT string_agg(
             format('%s — status %s, last seen %s ago (expected every %s, overdue by %s)',
                    t.alert_key,
                    t.status,
                    justify_interval(now() - t.last_seen_at),
                    justify_interval(t.expected_interval),
                    justify_interval(t.overdue_by)),
             E'\n')
      INTO v_body
      FROM (SELECT * FROM monitoring.stale_alerts() LIMIT c_cap) AS t;

    IF v_n > c_cap THEN
      v_body := v_body || format(E'\n…and %s more', v_n - c_cap);
    END IF;

    -- Also this sweeper's own liveness stamp: notify() writes last_seen_at on
    -- every call, including this one.
    PERFORM monitoring.notify(
      c_key, 'firing',
      format('%s monitor(s) have stopped reporting on %s', v_n, current_database()),
      format(E'A key below has not been written for longer than its monitoring.alert_expectation, which means the monitor behind it stopped running — its status says nothing about the thing it watches.\n\n%s',
             v_body));
  ELSE
    PERFORM monitoring.notify(
      c_key, 'cleared',
      format('Every monitor is reporting on %s', current_database()),
      format('%s alert_state key(s) checked; each was written inside its monitoring.alert_expectation window.',
             (SELECT count(*) FROM monitoring.alert_state)));
  END IF;

  RETURN v_n;
END;
$$;

ALTER FUNCTION monitoring.check_staleness() OWNER TO postgres;

COMMENT ON FUNCTION monitoring.check_staleness() IS
  'PS-411: sweep monitoring.alert_state for monitors that have stopped and raise ONE rollup alert on the key monitoring.staleness. Returns the number of stale keys. Callable with zero arguments — it is the scheduled command.';

-- The current body plus the reminder branch. cleared and p_quiet never remind; a
-- failed reminder does not advance last_notified_at.

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
  -- PS-411.
  prev_notified TIMESTAMPTZ;
  prev_count    integer;
  due_after     interval;
BEGIN
  IF p_status NOT IN ('firing', 'cleared') THEN
    RAISE EXCEPTION 'monitoring.notify: status must be firing|cleared, got %', p_status;
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

      webhook_url := internal.get_secret('monitoring_webhook_url');
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

-- No grant to any client role; per-role revokes defeat default privileges.

REVOKE ALL ON TABLE monitoring.alert_expectation FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.stale_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.check_staleness() FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.notify(p_alert_key text, p_status text, p_title text, p_body text, p_quiet boolean) FROM PUBLIC;

DO $acl$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE monitoring.alert_expectation FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.stale_alerts() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.check_staleness() FROM %I', r);
    END IF;
  END LOOP;
END;
$acl$;

DO $verify$
DECLARE
  v_missing text;
  v_bad     text;
  v_n       integer;
BEGIN
  -- (a) The table, its key and the conservative default.
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['key_pattern', 'expected_interval', 'note', 'added_by', 'added_at']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'monitoring' AND table_name = 'alert_expectation'
        AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.alert_expectation is missing %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'monitoring.alert_expectation'::regclass AND contype = 'p') THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.alert_expectation has no primary key on key_pattern';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM monitoring.alert_expectation
     WHERE key_pattern = '%' AND expected_interval = INTERVAL '7 days') THEN
    RAISE EXCEPTION
      'PS-411 verify: the catch-all expectation is absent or not 7 days — a key with no specific pattern would never be judged';
  END IF;

  -- Every seeded row carries its provenance.
  SELECT string_agg(key_pattern, ', ') INTO v_bad
    FROM monitoring.alert_expectation
   WHERE note IS NULL OR btrim(note) = '';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PS-411 verify: expectation row(s) without a note: %', v_bad;
  END IF;

  -- (b) The reminder columns, and the backfill that keeps the apply quiet.
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['last_notified_at', 'renotify_count']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'monitoring' AND table_name = 'alert_state'
        AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.alert_state is missing %', v_missing;
  END IF;

  SELECT count(*) INTO v_n
    FROM monitoring.alert_state
   WHERE status = 'firing' AND last_notified_at IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'PS-411 verify: % firing row(s) still have a NULL last_notified_at — the apply would page for each of them', v_n;
  END IF;

  -- (c) The three functions: exact signatures, zero-argument callability for
  --     the two the sweeper invokes, definer/owner/search_path intact.
  FOR v_bad IN
    SELECT sig FROM unnest(ARRAY[
      'monitoring.stale_alerts()',
      'monitoring.check_staleness()',
      'monitoring.notify(text, text, text, text, boolean)']) AS sig
  LOOP
    IF to_regprocedure(v_bad) IS NULL THEN
      RAISE EXCEPTION 'PS-411 verify: % does not exist with that exact signature', v_bad;
    END IF;
  END LOOP;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'monitoring'
     AND p.proname IN ('stale_alerts', 'check_staleness', 'notify')
     AND (NOT p.prosecdef
          OR pg_get_userbyid(p.proowner) <> 'postgres'
          OR NOT (p.proconfig::text[] @> ARRAY['search_path=public']));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-411 verify: % lost SECURITY DEFINER / postgres owner / pinned search_path', v_bad;
  END IF;

  -- The scheduled command is the zero-argument call.
  IF (SELECT p.pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'monitoring' AND p.proname = 'check_staleness') <> 0 THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.check_staleness() is not callable with zero arguments';
  END IF;

  -- (d) notify() kept its contract AND gained the reminder.
  SELECT p.prosrc INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'monitoring' AND p.proname = 'notify';
  IF v_bad !~ 'renotify_count' OR v_bad !~ 'last_notified_at' THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.notify has no reminder branch';
  END IF;
  IF v_bad !~ 'prev_status IS NOT DISTINCT FROM p_status' THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.notify lost the transition-only guard';
  END IF;
  IF v_bad !~ 'internal\.get_secret' THEN
    RAISE EXCEPTION 'PS-411 verify: monitoring.notify lost the in-database webhook read';
  END IF;

  -- (e) The ACL surface: nothing client-reachable.
  SELECT string_agg(probe, ', ') INTO v_bad
    FROM (
      SELECT r.rolname || ' EXECUTE ' || f.sig AS probe
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        CROSS JOIN (VALUES ('monitoring.stale_alerts()'),
                           ('monitoring.check_staleness()'),
                           ('monitoring.notify(text, text, text, text, boolean)')) AS f(sig)
       WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname)
         AND has_function_privilege(r.rolname, f.sig, 'EXECUTE')
      UNION ALL
      SELECT r.rolname || ' ' || v.priv || ' alert_expectation'
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS v(priv)
       WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname)
         AND has_table_privilege(r.rolname, 'monitoring.alert_expectation', v.priv)
      UNION ALL
      SELECT 'PUBLIC table-acl'
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
       WHERE c.oid = 'monitoring.alert_expectation'::regclass AND acl.grantee = 0
      UNION ALL
      SELECT 'PUBLIC function-acl ' || p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
       WHERE n.nspname = 'monitoring'
         AND p.proname IN ('stale_alerts', 'check_staleness', 'notify')
         AND acl.grantee = 0
    ) AS probes(probe);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PS-411 verify: client-reachable privilege on the PS-411 surface: %', v_bad;
  END IF;

  -- (f) The read actually runs, and the catch-all actually matches. A function
  --     that cannot execute is not a monitor.
  PERFORM count(*) FROM monitoring.stale_alerts();

  IF NOT EXISTS (
    SELECT 1 FROM monitoring.alert_expectation
     WHERE 'ps411.verify.probe' LIKE key_pattern) THEN
    RAISE EXCEPTION 'PS-411 verify: an arbitrary key matches no expectation pattern';
  END IF;
END;
$verify$;

COMMIT;

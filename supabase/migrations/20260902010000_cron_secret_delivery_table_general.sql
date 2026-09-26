-- Deliver pg_cron bearer values from a locked table, not world-readable, unrotatable GUCs.
-- target-db: general
-- Seeds copy the live GUCs (rotation-neutral). Never roll back after the GUCs are
-- retired: the table is then the only carrier of the live values.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'B3 General migration requires database postgres, got %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS internal AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS internal.cron_secrets (
  name       text PRIMARY KEY,
  value      text NOT NULL,
  rotated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE internal.cron_secrets OWNER TO postgres;

-- No grants and RLS with no policy: fails closed for every role but the owner.
REVOKE ALL ON TABLE internal.cron_secrets
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE internal.cron_secrets ENABLE ROW LEVEL SECURITY;

-- Sole read path; the revoke below is load-bearing (functions get PUBLIC EXECUTE).
CREATE OR REPLACE FUNCTION internal.get_secret(p_name text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
  SELECT s.value FROM internal.cron_secrets AS s WHERE s.name = p_name;
$$;
ALTER FUNCTION internal.get_secret(p_name text) OWNER TO postgres;
REVOKE ALL ON FUNCTION internal.get_secret(p_name text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ON CONFLICT DO NOTHING: a re-apply must never clobber a rotated value.

INSERT INTO internal.cron_secrets (name, value)
SELECT k.name, current_setting('app.settings.' || k.name, true)
  FROM (VALUES
         ('cron_secret'),
         ('service_role_key'),
         ('monitoring_webhook_url'),
         ('discord_webhook_url')
       ) AS k(name)
 WHERE NULLIF(current_setting('app.settings.' || k.name, true), '') IS NOT NULL
ON CONFLICT (name) DO NOTHING;

DO $seed_report$
DECLARE
  k text;
BEGIN
  FOR k IN SELECT unnest(ARRAY['cron_secret', 'service_role_key',
                               'monitoring_webhook_url', 'discord_webhook_url'])
  LOOP
    IF EXISTS (SELECT 1 FROM internal.cron_secrets WHERE name = k) THEN
      RAISE NOTICE 'B3 seed: % delivered via internal.cron_secrets', k;
    ELSE
      RAISE WARNING
        'B3 seed: no live GUC value for % (unset or empty) — row NOT seeded; the wrapper returns NULL until the runbook INSERTs it',
        k;
    END IF;
  END LOOP;
END;
$seed_report$;

-- Live bodies verbatim except the value fetch and two WARNING hints; owner/ACL asserted.

CREATE OR REPLACE FUNCTION public.get_cron_secret() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  secret TEXT;
BEGIN
  secret := internal.get_secret('cron_secret');

  IF secret IS NULL OR secret = '' THEN
    RAISE WARNING 'Cron secret not configured. Seed it via the credential-rotation runbook: INSERT INTO internal.cron_secrets (name, value) VALUES (''cron_secret'', ...);';
    RETURN NULL;
  END IF;

  RETURN secret;
END;
$$;

-- Deliberately SECURITY DEFINER with a pinned search_path; it relied on world-readable GUCs.
CREATE OR REPLACE FUNCTION public.get_service_role_key() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN internal.get_secret('service_role_key');
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

    -- Token economy audit (WI-2640 Phase 0)
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
    -- pg_cron still reports `succeeded` — the WI-6160 failure mode. The
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

  -- WI-6160: attribute the request so a later failure can name this caller.
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
          called_at     = now();
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

DO $verify$
DECLARE
  fn record;
  bad text;
BEGIN
  -- Direction 1 (the point of B3): the four rewritten readers carry NO GUC
  -- reference of any kind, and DO read the delivery path.
  FOR fn IN
    SELECT n.nspname, p.proname, p.prosrc, p.prosecdef, p.proconfig,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE (n.nspname, p.proname) IN (VALUES
             ('public', 'get_cron_secret'),
             ('public', 'get_service_role_key'),
             ('public', 'call_edge_function'),
             ('monitoring', 'notify'))
  LOOP
    IF fn.prosrc ~ 'app\.settings' OR fn.prosrc ~ 'current_setting' THEN
      RAISE EXCEPTION
        'B3 post-condition failed: %.% still references the GUC channel',
        fn.nspname, fn.proname;
    END IF;
    IF fn.prosrc !~ 'internal\.get_secret' THEN
      RAISE EXCEPTION
        'B3 post-condition failed: %.% does not read internal.get_secret',
        fn.nspname, fn.proname;
    END IF;
    IF NOT fn.prosecdef
       OR fn.owner IS DISTINCT FROM 'postgres'
       OR NOT (fn.proconfig::text[] @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION
        'B3 post-condition failed: %.% lost SECURITY DEFINER / postgres owner / pinned search_path',
        fn.nspname, fn.proname;
    END IF;
  END LOOP;

  -- Direction 2: the delivery surface is invisible to every client role.
  SELECT string_agg(probe, ', ') INTO bad
    FROM (
      SELECT r.rolname || ' schema-USAGE' AS probe
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE has_schema_privilege(r.rolname, 'internal', 'USAGE')
      UNION ALL
      SELECT r.rolname || ' table-' || v.priv
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS v(priv)
       WHERE has_table_privilege(r.rolname, 'internal.cron_secrets', v.priv)
      UNION ALL
      SELECT r.rolname || ' get_secret-EXECUTE'
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE has_function_privilege(r.rolname, 'internal.get_secret(text)', 'EXECUTE')
      UNION ALL
      -- PUBLIC (grantee 0) must hold nothing on the table or the accessor.
      SELECT 'PUBLIC ' || what
        FROM (
          SELECT 'table-acl' AS what
            FROM pg_catalog.pg_class AS c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS acl
           WHERE c.oid = 'internal.cron_secrets'::regclass AND acl.grantee = 0
          UNION ALL
          SELECT 'function-acl'
            FROM pg_catalog.pg_proc AS p
            CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
           WHERE p.oid = 'internal.get_secret(text)'::regprocedure AND acl.grantee = 0
        ) AS pub(what)
    ) AS probes(probe);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'B3 post-condition failed: client-reachable privilege on the delivery surface: %', bad;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
           WHERE oid = 'internal.cron_secrets'::regclass) THEN
    RAISE EXCEPTION 'B3 post-condition failed: internal.cron_secrets lost row security';
  END IF;

  -- Direction 3: the wrappers'' ACL surface is byte-identical to the
  -- 20260814000000 layer — service_role-only EXECUTE on the public three,
  -- owner-only on monitoring.notify, nothing for anon/authenticated/PUBLIC.
  SELECT string_agg(probe, ', ') INTO bad
    FROM (
      SELECT r.rolname || ' EXECUTE ' || f.sig AS probe
        FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
        CROSS JOIN (VALUES
          ('public.get_cron_secret()'),
          ('public.get_service_role_key()'),
          ('public.call_edge_function(text, jsonb)'),
          ('monitoring.notify(text, text, text, text, boolean)')) AS f(sig)
       WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE')
      UNION ALL
      SELECT 'service_role EXECUTE monitoring.notify'
       WHERE has_function_privilege('service_role',
               'monitoring.notify(text, text, text, text, boolean)', 'EXECUTE')
      UNION ALL
      SELECT 'service_role MISSING ' || f.sig
        FROM (VALUES
          ('public.get_cron_secret()'),
          ('public.get_service_role_key()'),
          ('public.call_edge_function(text, jsonb)')) AS f(sig)
       WHERE NOT has_function_privilege('service_role', f.sig, 'EXECUTE')
    ) AS probes(probe);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'B3 post-condition failed: wrapper ACL surface changed: %', bad;
  END IF;

  -- Direction 4: delivery consistency — wherever a row was seeded, the
  -- wrapper must serve exactly the table value.
  IF EXISTS (SELECT 1 FROM internal.cron_secrets WHERE name = 'cron_secret')
     AND public.get_cron_secret() IS DISTINCT FROM
         (SELECT value FROM internal.cron_secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION 'B3 post-condition failed: get_cron_secret() does not serve the table value';
  END IF;
  IF EXISTS (SELECT 1 FROM internal.cron_secrets WHERE name = 'service_role_key')
     AND public.get_service_role_key() IS DISTINCT FROM
         (SELECT value FROM internal.cron_secrets WHERE name = 'service_role_key') THEN
    RAISE EXCEPTION 'B3 post-condition failed: get_service_role_key() does not serve the table value';
  END IF;

  RAISE NOTICE 'B3: secret delivery moved to internal.cron_secrets; rotation is now one UPDATE per value';
END;
$verify$;

COMMIT;

-- Route each monitoring.notify() alert to a Discord channel by longest-matching
-- alert-key pattern, falling back to the legacy webhook until per-channel rows exist.
-- Any re-creation of notify() must keep its monitoring.webhook_for() call.

BEGIN;


CREATE TABLE IF NOT EXISTS monitoring.alert_route (
  pattern  text PRIMARY KEY,                      -- LIKE pattern on alert_key
  channel  text NOT NULL CHECK (channel IN ('eot', 'ta', 'homelab', 'tmos')),
  note     text
);
COMMENT ON TABLE monitoring.alert_route IS
  'Alert key -> Discord channel. Longest matching pattern wins; unmatched keys use monitoring.webhook_for() default. Owner: tmos-sentinel/alert-routing.';

-- Rows managed elsewhere are kept.
INSERT INTO monitoring.alert_route(pattern, channel, note) VALUES
  ('eot-%',                      'eot',     'eot-stack, eot-main-image-*'),
  ('eot.%',                      'eot',     NULL),
  ('guildwar.%',                 'eot',     'EOT guild-war monitors'),
  ('roster.%',                   'ta',      'roster write failures per guild/player'),
  ('tokens.%',                   'ta',      'token accrual/estimator/monitor (TA db); EOT db defaults to eot'),
  ('sync.%',                     'ta',      'sync queue drain'),
  ('apphealth.%',                'ta',      'app metrics'),
  ('%.postgres',                 'ta',      'per-database checks run against the TA db'),
  ('workqueue.deadletter',       'ta',      NULL),
  ('migration-ledger-ta.%',      'ta',      NULL),
  ('loki.%',                     'ta',      'GlobalConfig self-heal'),
  ('capacity.%',                 'homelab', NULL),
  ('steady-state.%',             'homelab', 'host steady-state: units, containers, media, UPS'),
  ('egpu.%',                     'homelab', NULL),
  ('framework.%',                'homelab', NULL),
  ('deploy-drift%',              'homelab', 'deployment integrity (host + cluster)'),
  ('migration-ledger.%',         'homelab', 'schema ledger integrity'),
  ('pgnet.%',                    'homelab', 'pg_net bridge'),
  ('edge-runtime.%',             'homelab', NULL),
  ('data-freshness.cluster',     'homelab', 'pg_cron parity'),
  ('monitoring.%',               'homelab', 'monitoring self-health (staleness)'),
  ('patroni%',                   'homelab', NULL),
  ('backup%',                    'homelab', NULL),
  ('disk%',                      'homelab', NULL),
  ('ups%',                       'homelab', NULL),
  ('network%',                   'homelab', NULL),
  ('ci-runner%',                 'homelab', NULL),
  ('waydroid-%',                 'homelab', NULL),
  ('ids.%',                      'homelab', 'router IDS'),
  ('tmos.%',                     'tmos',    NULL),
  ('sentinel.%',                 'tmos',    NULL),
  ('family.%',                   'tmos',    NULL)
ON CONFLICT (pattern) DO NOTHING;

CREATE OR REPLACE FUNCTION monitoring.alert_channel(p_alert_key text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $f$
  SELECT coalesce(
    (SELECT r.channel FROM monitoring.alert_route r
      WHERE p_alert_key LIKE r.pattern ORDER BY length(r.pattern) DESC, r.pattern LIMIT 1),
    'homelab');
$f$;

CREATE OR REPLACE FUNCTION monitoring.webhook_for(p_alert_key text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog' AS $f$
DECLARE url text;
BEGIN
  SELECT s.value INTO url FROM internal.cron_secrets s
   WHERE s.name = 'monitoring_webhook_url_' || monitoring.alert_channel(p_alert_key);
  IF url IS NULL OR url = '' THEN
    url := internal.get_secret('monitoring_webhook_url');
  END IF;
  RETURN url;
END;
$f$;

REVOKE ALL ON FUNCTION monitoring.webhook_for(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.alert_channel(text) FROM PUBLIC;
REVOKE ALL ON TABLE monitoring.alert_route FROM PUBLIC;


DO $patch$
DECLARE
  fn  regprocedure := 'monitoring.notify(text,text,text,text,boolean)'::regprocedure;
  def text := pg_get_functiondef(fn);
  new text := replace(def, 'webhook_url := internal.get_secret(''monitoring_webhook_url'')', 'webhook_url := monitoring.webhook_for(p_alert_key)');
BEGIN
  IF new <> def THEN
    EXECUTE new;
    RAISE NOTICE 'monitoring.notify: webhook lookups now routed';
  ELSIF position('monitoring.webhook_for(p_alert_key)' in def) = 0 THEN
    RAISE EXCEPTION 'monitoring.notify: expected webhook lookup not found; routing NOT applied';
  END IF;
END
$patch$;

COMMIT;

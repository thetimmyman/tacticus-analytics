-- target-db: general
-- Persisted dedup for the LOKI GlobalConfig drift-review Discord post
-- (app/api/cron/refresh-global-config/route.ts, app/lib/loki/alert-dedup.ts).
--
-- The route never writes GlobalConfig -- it alerts until a human reviews and
-- applies the change -- so the daily refresh CronJob and the EOT self-heal's
-- ALERT_FIRST path both call it again every tick while that review is
-- pending, which previously reposted the identical diff to Discord on every
-- call. This single-row table records the fingerprint of the last
-- transition actually posted, so a repeat call for the SAME unreviewed
-- drift is a no-op. Service-role only: no client ever reads or writes it.
CREATE TABLE IF NOT EXISTS public.loki_globalconfig_alert_state (
  id boolean PRIMARY KEY DEFAULT true,
  old_version text,
  new_version text,
  content_fingerprint text NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loki_globalconfig_alert_state_singleton CHECK (id)
);

ALTER TABLE public.loki_globalconfig_alert_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.loki_globalconfig_alert_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.loki_globalconfig_alert_state TO service_role;

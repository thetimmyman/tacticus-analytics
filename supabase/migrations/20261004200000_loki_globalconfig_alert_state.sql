-- target-db: general
-- Persisted dedup for the LOKI GlobalConfig drift-review Discord post
-- (app/api/cron/refresh-global-config/route.ts, app/lib/loki/alert-dedup.ts).
-- The daily refresh job and other automated callers re-check this every
-- tick while a transition is unreviewed, previously reposting the same
-- diff to Discord each time. Service-role only: no client reads/writes it.
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

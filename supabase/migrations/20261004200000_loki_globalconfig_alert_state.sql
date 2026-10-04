-- target-db: general
-- Persisted dedup for the LOKI GlobalConfig drift-review Discord post
-- (app/lib/loki/alert-dedup.ts). alerted_at is the claim time; delivered_at
-- is stamped once Discord accepts the post, so a failed post is retried
-- instead of suppressed. Service-role only: no client reads/writes it.
CREATE TABLE IF NOT EXISTS public.loki_globalconfig_alert_state (
  id boolean PRIMARY KEY DEFAULT true,
  old_version text,
  new_version text,
  content_fingerprint text NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT loki_globalconfig_alert_state_singleton CHECK (id)
);

ALTER TABLE public.loki_globalconfig_alert_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.loki_globalconfig_alert_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.loki_globalconfig_alert_state TO service_role;

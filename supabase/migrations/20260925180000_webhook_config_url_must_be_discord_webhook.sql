-- Constrain webhook_config.webhook_url to a Discord webhook URL or NULL; existing
-- non-matching URLs are cleared (and disabled) so the constraint validates.
-- target-db: general
-- The case-sensitive pattern mirrors app/lib/webhooks/validate-url.ts.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'webhook_config URL check (general) requires postgres, got %', current_database();
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

UPDATE public.webhook_config
   SET webhook_url = NULL,
       enabled = false,
       updated_at = now()
 WHERE webhook_url IS NOT NULL
   AND webhook_url !~ '^https://(discord\.com|ptb\.discord\.com|canary\.discord\.com|discordapp\.com)/api/(v[0-9]+/)?webhooks/[0-9]+/[^/?#[:space:]]+/?([?#].*)?$';

ALTER TABLE public.webhook_config
  ADD CONSTRAINT webhook_config_webhook_url_is_discord_webhook
  CHECK (
    webhook_url IS NULL
    OR webhook_url ~ '^https://(discord\.com|ptb\.discord\.com|canary\.discord\.com|discordapp\.com)/api/(v[0-9]+/)?webhooks/[0-9]+/[^/?#[:space:]]+/?([?#].*)?$'
  );

COMMIT;

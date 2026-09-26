BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Gate on the constraint: ledger rows are hand-written and their version/name split varies.
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.webhook_config'::regclass
    AND conname = 'webhook_config_webhook_url_is_discord_webhook'
    AND contype = 'c'
) AS webhook_url_check_not_applied \gset

\if :webhook_url_check_not_applied
SELECT plan(10);
SELECT * FROM skip(
  10,
  'webhook_config_webhook_url_is_discord_webhook is not installed on this database'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(10);

SELECT ok(
  (
    SELECT convalidated
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.webhook_config'::regclass
      AND conname = 'webhook_config_webhook_url_is_discord_webhook'
  ),
  'webhook_config_webhook_url_is_discord_webhook exists and is validated'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.webhook_config
    WHERE webhook_url IS NOT NULL
      AND webhook_url !~ '^https://(discord\.com|ptb\.discord\.com|canary\.discord\.com|discordapp\.com)/api/(v[0-9]+/)?webhooks/[0-9]+/[^/?#[:space:]]+/?([?#].*)?$'
  ),
  0,
  'no stored webhook_url is a non-webhook URL'
);

SELECT lives_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'https://discord.com/api/webhooks/123/PLACEHOLDER-token', false)$$,
  'a Discord webhook URL is accepted'
);

SELECT lives_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'https://canary.discord.com/api/v10/webhooks/123/PLACEHOLDER-token?thread_id=9', false)$$,
  'a versioned webhook URL with a thread_id query is accepted'
);

SELECT lives_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', NULL, false)$$,
  'a NULL webhook_url is accepted'
);

SELECT throws_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'https://discord.com/channels/111/222', false)$$,
  '23514',
  NULL,
  'a Discord channel link is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'https://example.com/api/webhooks/123/PLACEHOLDER-token', false)$$,
  '23514',
  NULL,
  'a non-Discord host is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'http://discord.com/api/webhooks/123/PLACEHOLDER-token', false)$$,
  '23514',
  NULL,
  'a plain-http URL is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'https://discord.com/API/WEBHOOKS/123/PLACEHOLDER-token', false)$$,
  '23514',
  NULL,
  'an upper-case path (which Discord 404s) is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.webhook_config (webhook_type, webhook_url, enabled)
    VALUES ('sync_status', 'https://ptb.discordapp.com/api/webhooks/123/PLACEHOLDER-token', false)$$,
  '23514',
  NULL,
  'a host outside the validate-url allow-list is rejected'
);

SELECT * FROM finish();
ROLLBACK;
\endif

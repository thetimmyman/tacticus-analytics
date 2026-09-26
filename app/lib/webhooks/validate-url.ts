// Validates Discord webhook URLs. A pasted channel URL answers POSTs with 200 and
// SPA HTML, so a naive response.ok check reports success while nothing arrives.

const DISCORD_WEBHOOK_HOSTS = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com'
])

// Unversioned only: delivery accepts only /api/webhooks/..., so a versioned URL saves but never delivers.
const DISCORD_WEBHOOK_PATH_RE = /^\/api\/webhooks\/\d+\/[^/]+\/?$/

export type WebhookUrlValidationError =
  | { ok: false; kind: 'empty'; message: string }
  | { ok: false; kind: 'channel-url'; message: string; hint: string }
  | { ok: false; kind: 'unrecognized'; message: string; hint: string }
  | { ok: false; kind: 'too-long'; message: string }

export type WebhookUrlValidationResult =
  { ok: true; url: string } | WebhookUrlValidationError

export const CHANNEL_URL_ERROR_MESSAGE =
  'This looks like a Discord CHANNEL URL (https://discord.com/channels/...), not a webhook URL.'

export const CHANNEL_URL_ERROR_HINT =
  'Webhook URLs start with https://discord.com/api/webhooks/ and come from ' +
  'the target channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL. ' +
  'A webhook URL includes a long token after the channel ID.'

const UNRECOGNIZED_URL_ERROR_MESSAGE = 'URL must be a Discord webhook URL.'

export const UNRECOGNIZED_URL_ERROR_HINT =
  'Expected format: https://discord.com/api/webhooks/<channel_id>/<token>. ' +
  'Get this from Discord → Channel settings → Integrations → Webhooks → Copy Webhook URL.'

const MAX_WEBHOOK_URL_LEN = 500

// Mirrors the webhook_config_webhook_url_is_discord_webhook CHECK and delivery,
// applied to the raw stored string: inputs the URL parser normalises (":443",
// "/./", backslashes) get a 400 here instead of a 500 from the CHECK.
const STORED_WEBHOOK_URL_RE =
  /^https:\/\/(discord\.com|ptb\.discord\.com|canary\.discord\.com|discordapp\.com)\/api\/webhooks\/[0-9]+\/[\w-]+(\?.*)?$/

// Lower-cases scheme and host only; the path is case-sensitive.
function canonicalizeAuthority(raw: string): string {
  return raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, (authority) =>
    authority.toLowerCase()
  )
}

export function validateDiscordWebhookUrl(
  value: string | null | undefined
): WebhookUrlValidationResult {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length === 0) {
    return { ok: false, kind: 'empty', message: 'Webhook URL is required.' }
  }
  if (trimmed.length > MAX_WEBHOOK_URL_LEN) {
    return {
      ok: false,
      kind: 'too-long',
      message: `Webhook URL is too long (max ${MAX_WEBHOOK_URL_LEN} chars).`
    }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return {
      ok: false,
      kind: 'unrecognized',
      message: UNRECOGNIZED_URL_ERROR_MESSAGE,
      hint: UNRECOGNIZED_URL_ERROR_HINT
    }
  }

  const isAllowedDiscordHost =
    url.protocol === 'https:' &&
    DISCORD_WEBHOOK_HOSTS.has(url.hostname.toLowerCase())
  const hasStandardAuthority =
    url.username === '' && url.password === '' && url.port === ''

  if (
    isAllowedDiscordHost &&
    hasStandardAuthority &&
    url.pathname.startsWith('/channels/')
  ) {
    return {
      ok: false,
      kind: 'channel-url',
      message: CHANNEL_URL_ERROR_MESSAGE,
      hint: CHANNEL_URL_ERROR_HINT
    }
  }

  if (
    isAllowedDiscordHost &&
    hasStandardAuthority &&
    DISCORD_WEBHOOK_PATH_RE.test(url.pathname) &&
    STORED_WEBHOOK_URL_RE.test(canonicalizeAuthority(trimmed))
  ) {
    return { ok: true, url: canonicalizeAuthority(trimmed) }
  }

  return {
    ok: false,
    kind: 'unrecognized',
    message: UNRECOGNIZED_URL_ERROR_MESSAGE,
    hint: UNRECOGNIZED_URL_ERROR_HINT
  }
}

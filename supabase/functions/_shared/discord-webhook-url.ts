/** Edge twin of app/lib/webhooks/validate-url.ts; old rows may hold a channel link (200 HTML on POST). */

const DISCORD_WEBHOOK_HOSTS = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com'
])

const DISCORD_WEBHOOK_PATH_RE = /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[^/]+\/?$/

export type DiscordWebhookUrlProblem = 'empty' | 'channel-url' | 'not-webhook'

/** Returns null when the URL is a usable Discord webhook URL, else the problem. */
export function discordWebhookUrlProblem(
  value: string | null | undefined
): DiscordWebhookUrlProblem | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return 'empty'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'not-webhook'
  }
  const discordHost =
    url.protocol === 'https:' &&
    DISCORD_WEBHOOK_HOSTS.has(url.hostname.toLowerCase()) &&
    url.username === '' &&
    url.password === '' &&
    url.port === ''
  if (!discordHost) return 'not-webhook'
  if (url.pathname.startsWith('/channels/')) return 'channel-url'
  return DISCORD_WEBHOOK_PATH_RE.test(url.pathname) ? null : 'not-webhook'
}

export function describeWebhookUrlProblem(
  problem: DiscordWebhookUrlProblem
): string {
  switch (problem) {
    case 'empty':
      return 'webhook URL is empty'
    case 'channel-url':
      return 'webhook URL is a Discord channel link (discord.com/channels/...), not a webhook URL — re-paste it from Channel settings → Integrations → Webhooks → Copy Webhook URL'
    case 'not-webhook':
      return 'webhook URL is not a Discord webhook URL (expected https://discord.com/api/webhooks/<id>/<token>)'
  }
}

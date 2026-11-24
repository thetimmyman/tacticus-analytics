const MASKED_TOKEN_SENTINEL = '••••'

// Masks the secret token segment of a Discord webhook URL so API responses never echo it.
export function maskDiscordWebhookUrl(
  value: string | null | undefined
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    const match = /^(\/api\/webhooks\/\d+\/)([^/]+)(\/?)$/.exec(parsed.pathname)
    if (match) {
      const prefix = match[1]
      const token = match[2] ?? ''
      const suffix = match[3] ?? ''
      const tail = token.length > 8 ? token.slice(-4) : ''
      return `${parsed.origin}${prefix}${MASKED_TOKEN_SENTINEL}${tail}${suffix}`
    }
  } catch {
    // Fall through to generic redaction for non-URL values.
  }

  return MASKED_TOKEN_SENTINEL
}

export function isMaskedDiscordWebhookUrl(
  value: string | null | undefined
): boolean {
  return typeof value === 'string' && value.includes(MASKED_TOKEN_SENTINEL)
}

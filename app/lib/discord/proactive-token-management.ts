export const PROACTIVE_TOKEN_MANAGEMENT_FEATURE_KEY =
  'proactive_token_management'
export const PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE = 'token_cap_notification'
export const LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE = 'token_cap_alerts'

export const PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPES = [
  PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE,
  LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE
] as const

export function isProactiveTokenManagementWebhookType(
  type: string | null | undefined
): boolean {
  return (
    type === PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE ||
    type === LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE
  )
}

export function normalizeProactiveTokenManagementWebhookType(
  type: string
): string {
  if (type === LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE) {
    return PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE
  }

  return type
}

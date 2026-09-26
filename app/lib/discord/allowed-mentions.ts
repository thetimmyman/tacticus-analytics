import type { DiscordWebhookPayload } from './types'

// No `parse` with `{ roles }`, so there is no @everyone/user auto-parsing.
export const buildAllowedMentions = (
  roleIds: string[]
): DiscordWebhookPayload['allowed_mentions'] =>
  roleIds.length > 0 ? { roles: roleIds } : { parse: [] }

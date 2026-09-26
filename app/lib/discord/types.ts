import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow
} from 'discord-api-types/v10'

export type DiscordEmbedField = {
  name: string
  value: string
  inline?: boolean
}

export type DiscordEmbedFooter = {
  text: string
  icon_url?: string
}

export type DiscordEmbed = {
  title?: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  timestamp?: string
  footer?: DiscordEmbedFooter
}

export type DiscordWebhookPayload = {
  content?: string
  embeds?: DiscordEmbed[]
  username?: string
  avatar_url?: string
  allowed_mentions?: {
    parse?: Array<'roles' | 'users' | 'everyone'>
    roles?: string[]
    users?: string[]
  }
  /** Bot driver only; an edit replaces the field wholesale, so send them on every update. */
  components?: APIActionRowComponent<APIComponentInMessageActionRow>[]
}

export type WebhookErrorType =
  'rate_limited' | 'invalid_webhook' | 'server_error' | 'network_error'

export type WebhookError = {
  type: WebhookErrorType
  message: string
  status?: number
  retryAfter?: number
}

export type WebhookPostResult = {
  ok: boolean
  status: number | null
  data?: unknown
  error?: WebhookError
  attempts: number
  responseBody?: string
}

export type WebhookPostOptions = {
  waitForResponse?: boolean
  rateLimit?: boolean
  retries?: number
  retryDelayMs?: number
  timeoutMs?: number
  guildCode?: string
  webhookType?: string
  logDelivery?: (entry: DiscordWebhookLogEntry) => Promise<void> | void
  queueOnCircuitOpen?: boolean
  threadId?: string | null
}

export type DiscordWebhookLogEntry = {
  guildCode: string
  webhookType: string
  webhookUrlHash: string
  payloadPreview?: string
  mentionedRoles?: string[]
  status: 'pending' | 'delivered' | 'failed' | 'rate_limited'
  errorMessage?: string
  retryCount?: number
  deliveredAt?: string | null
}

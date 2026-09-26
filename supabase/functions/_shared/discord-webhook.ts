import { logger } from './logger.ts'
import {
  describeWebhookUrlProblem,
  discordWebhookUrlProblem
} from './discord-webhook-url.ts'

/** DISCORD_WEBHOOKS_ENABLED=false suppresses all Discord messages (default on). */
export function isDiscordWebhooksEnabled(): boolean {
  const enabled = Deno.env.get('DISCORD_WEBHOOKS_ENABLED')
  return enabled !== 'false'
}

export interface WebhookPayload {
  content?: string
  embeds?: DiscordEmbed[]
  username?: string
  avatar_url?: string
  flags?: number
}

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: EmbedField[]
  timestamp?: string
  footer?: { text: string; icon_url?: string }
  author?: { name: string; icon_url?: string; url?: string }
  thumbnail?: { url: string }
  image?: { url: string }
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface SendWebhookOptions {
  retries?: number
  retryDelay?: number
  /** Forum-channel thread (thread_id query param). */
  threadId?: string | null
  /** Send even when disabled, for call sites that never checked the flag. */
  ignoreEnabledFlag?: boolean
}

export interface SendWebhookResult {
  success: boolean
  messageId?: string
  error?: string
  rateLimited?: boolean
  /** Discord 10015/50027: the webhook was deleted (an opt-out, not transient); stop using the URL. */
  webhookGone?: boolean
}

export interface UpdateWebhookResult {
  success: boolean
  messageId?: string
  updated?: boolean
  rateLimited?: boolean
  error?: string
  /** Discord 10008: the tracked message no longer exists. */
  messageGone?: boolean
  webhookGone?: boolean
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function parseWebhookUrl(
  webhookUrl: string
): { webhookId: string; webhookToken: string } | null {
  const match = webhookUrl.match(/webhooks\/(\d+)\/([^/?]+)/)
  if (!match) return null
  return { webhookId: match[1], webhookToken: match[2] }
}

/** Stored URLs may already carry a query (e.g. ?thread_id=), so merge params. */
function withWebhookQuery(
  webhookUrl: string,
  params: Record<string, string | null | undefined>
): string {
  const url = new URL(webhookUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

const WEBHOOK_GONE_CODES = new Set([10015, 50027])

function discordErrorCode(body: string): number | null {
  try {
    const code = (JSON.parse(body) as { code?: unknown }).code
    return typeof code === 'number' ? code : null
  } catch {
    return null
  }
}

function redactWebhookToken(text: string): string {
  return text.replace(/(webhooks\/\d+\/)[^/?\s)"']+/g, '$1<redacted>')
}

export async function sendWebhookMessage(
  webhookUrl: string,
  payload: WebhookPayload,
  options: SendWebhookOptions = {}
): Promise<SendWebhookResult> {
  if (!options.ignoreEnabledFlag && !isDiscordWebhooksEnabled()) {
    logger.info(
      'Discord webhooks disabled via DISCORD_WEBHOOKS_ENABLED=false - skipping send'
    )
    return { success: true, messageId: 'disabled' }
  }

  const { retries = 3, retryDelay = 1000, threadId } = options
  const urlProblem = discordWebhookUrlProblem(webhookUrl)
  if (urlProblem) {
    // discord.com serves a channel link as 200 HTML; never POST to it.
    const error = describeWebhookUrlProblem(urlProblem)
    logger.error(`Webhook send skipped: ${error}`)
    return { success: false, error }
  }
  const postUrl = withWebhookQuery(webhookUrl, {
    wait: 'true',
    thread_id: threadId
  })

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('application/json')) {
          // A 2xx without the ?wait=true message JSON did not reach the webhook API.
          await response.body?.cancel()
          const error = `Webhook send returned ${response.status} with non-JSON body (${contentType || 'no content-type'}) from ${new URL(postUrl).hostname} — not a Discord webhook endpoint`
          logger.error(error)
          return { success: false, error }
        }
        const data = await response.json()
        return { success: true, messageId: data.id }
      }

      if (response.status === 429) {
        const rateLimitData = await response.json()
        const retryAfter = (rateLimitData.retry_after || 1) * 1000
        logger.warn(
          `Rate limited, waiting ${retryAfter}ms (attempt ${attempt + 1}/${retries})`
        )
        await delay(retryAfter)
        continue
      }

      const errorText = await response.text()
      const code = discordErrorCode(errorText)
      if (code !== null && WEBHOOK_GONE_CODES.has(code)) {
        logger.info(`Webhook deleted in Discord (code ${code}); not retrying`)
        return { success: false, error: errorText, webhookGone: true }
      }
      logger.error(`Webhook send failed: ${response.status} - ${errorText}`)
      return { success: false, error: errorText }
    } catch (error) {
      // Deno's fetch errors embed the request URL, i.e. the webhook token.
      const message = redactWebhookToken(String(error))
      logger.error(`Webhook send exception: ${message}`)
      if (attempt < retries - 1) {
        await delay(retryDelay)
        continue
      }
      return { success: false, error: message }
    }
  }

  return {
    success: false,
    rateLimited: true,
    error: 'Max retries exceeded due to rate limiting'
  }
}

export async function updateWebhookMessage(
  webhookUrl: string,
  messageId: string,
  payload: WebhookPayload,
  options: SendWebhookOptions = {}
): Promise<UpdateWebhookResult> {
  if (!options.ignoreEnabledFlag && !isDiscordWebhooksEnabled()) {
    logger.info(
      'Discord webhooks disabled via DISCORD_WEBHOOKS_ENABLED=false - skipping update'
    )
    return { success: true, messageId, updated: false }
  }

  const { retries = 3, threadId } = options

  const parsed = parseWebhookUrl(webhookUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid webhook URL' }
  }

  const { webhookId, webhookToken } = parsed
  const updateUrl = withWebhookQuery(
    `https://discord.com/api/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`,
    { thread_id: threadId }
  )

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        return { success: true, messageId, updated: true }
      }

      if (response.status === 429) {
        const rateLimitData = await response.json()
        const retryAfter = (rateLimitData.retry_after || 1) * 1000
        logger.warn(
          `Rate limited on update, waiting ${retryAfter}ms (attempt ${attempt + 1}/${retries})`
        )
        await delay(retryAfter)
        continue
      }

      // Flag 10008 so callers recreate the message. Never return the stale
      // messageId on failure, or callers persist an update that never happened.
      const errorText = await response.text()
      const code = discordErrorCode(errorText)
      if (code !== null && WEBHOOK_GONE_CODES.has(code)) {
        logger.info(`Webhook deleted in Discord (code ${code}); not retrying`)
        return {
          success: false,
          updated: false,
          error: errorText,
          webhookGone: true
        }
      }
      logger.error(`Webhook update failed: ${response.status} - ${errorText}`)
      const messageGone = code === 10008
      return { success: false, updated: false, error: errorText, messageGone }
    } catch (error) {
      logger.error('Webhook update exception:', error)
      return { success: false, updated: false, error: String(error) }
    }
  }

  return { success: false, updated: false, rateLimited: true }
}

export async function sendOrUpdateMessage(
  webhookUrl: string,
  payload: WebhookPayload,
  existingMessageId?: string | null,
  options: SendWebhookOptions = {}
): Promise<UpdateWebhookResult> {
  if (existingMessageId && existingMessageId !== 'test_mode') {
    const updateResult = await updateWebhookMessage(
      webhookUrl,
      existingMessageId,
      payload,
      options
    )
    if (updateResult.success) {
      return updateResult
    }
    // Recreate only when the message is gone (10008); otherwise return the failure, never a duplicate.
    if (!updateResult.messageGone) {
      return updateResult
    }
    logger.info(
      `Message ${existingMessageId} no longer exists (10008), creating new message`
    )
  }

  const sendResult = await sendWebhookMessage(webhookUrl, payload, options)
  return {
    success: sendResult.success,
    messageId: sendResult.messageId,
    updated: false,
    rateLimited: sendResult.rateLimited,
    error: sendResult.error,
    webhookGone: sendResult.webhookGone
  }
}

export async function sendFollowUpMessage(
  applicationId: string,
  interactionToken: string,
  content: string,
  embeds?: DiscordEmbed[] | null,
  flags?: number | null
): Promise<void> {
  if (!isDiscordWebhooksEnabled()) {
    logger.info(
      'Discord webhooks disabled via DISCORD_WEBHOOKS_ENABLED=false - skipping follow-up'
    )
    return
  }

  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`
  const body: WebhookPayload = { content }
  if (embeds) body.embeds = embeds
  if (flags) body.flags = flags

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        'Failed to send follow-up message:',
        response.status,
        errorText
      )
      throw new Error(`Discord API error: ${response.status}`)
    }
  } catch (error) {
    logger.error('Exception sending follow-up message:', error)
    throw error
  }
}

export const EmbedColors = {
  SUCCESS: 0x00ff00,
  WARNING: 0xffff00,
  ERROR: 0xff0000,
  INFO: 0x5865f2,
  GRAY: 0x808080
} as const

import 'server-only'
import { createHash } from 'crypto'
import { createComponentLogger } from '@/app/lib/logging'
import { sleep } from '@/app/lib/utils/async-timeout'
import {
  createChannelMessage,
  editChannelMessage
} from '@/app/lib/discord/bot-rest-client'
import {
  logDiscordWebhookDelivery,
  postToWebhook
} from '@/app/lib/discord/webhook-service'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'

const logger = createComponentLogger('discord.message-tracking')

// 'bot' is primary because webhooks strip buttons. 10008 recreates once, other update
// failures never duplicate, and messageId is null on every failure.

export type MetaDeliveryDriver = 'bot' | 'webhook'

export interface DeliveryTarget {
  webhookUrl: string | null
  channelId: string | null
  threadId?: string | null
}

type SendOrUpdateOutcome = 'created' | 'updated' | 'gone-recreated' | 'failed'

export interface SendOrUpdateResult {
  outcome: SendOrUpdateOutcome
  driver: MetaDeliveryDriver
  /** Null on any failure so a stale id is never persisted. */
  messageId: string | null
  channelId: string | null
  failureReason?: string
  /** Caller should fall back to the webhook. */
  botAccessDenied?: boolean
}

export interface DeliveryLogContext {
  /** cluster_code for cluster surfaces. */
  guildCode: string
  webhookType: string
}

const WEBHOOK_UPDATE_MAX_ATTEMPTS = 3
const DISCORD_UNKNOWN_MESSAGE = 10008
const DISCORD_UNKNOWN_WEBHOOK = 10015
const DISCORD_MISSING_ACCESS = 50001
const DISCORD_MISSING_PERMISSIONS = 50013

export const hashWebhookUrl = (webhookUrl: string): string =>
  createHash('sha256').update(webhookUrl).digest('hex')

const parseErrorCode = (body: string): number | null => {
  try {
    const parsed = JSON.parse(body) as { code?: number }
    return typeof parsed.code === 'number' ? parsed.code : null
  } catch {
    return null
  }
}

const logDelivery = async (
  ctx: DeliveryLogContext,
  urlHashSource: string,
  payload: DiscordWebhookPayload,
  status: 'delivered' | 'failed' | 'rate_limited',
  errorMessage?: string,
  retryCount = 0
) => {
  let preview: string
  try {
    preview = JSON.stringify(payload).slice(0, 200)
  } catch {
    preview = '[unserializable payload]'
  }
  await logDiscordWebhookDelivery({
    guildCode: ctx.guildCode,
    webhookType: ctx.webhookType,
    webhookUrlHash: hashWebhookUrl(urlHashSource),
    payloadPreview: preview,
    status,
    errorMessage,
    retryCount,
    deliveredAt: status === 'delivered' ? new Date().toISOString() : null
  })
}

export type WebhookInfoResult =
  | { ok: true; channelId: string | null; guildId: string | null }
  | { ok: false; webhookDeleted: boolean; error: string }

/** Lets delivery be bot-authored. 404/10015 = deleted. */
export const resolveWebhookChannelId = async (
  webhookUrl: string
): Promise<WebhookInfoResult> => {
  const match = webhookUrl.match(/webhooks\/(\d+)\/([^/?]+)/)
  if (!match) {
    return { ok: false, webhookDeleted: false, error: 'invalid webhook URL' }
  }
  try {
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${match[1]}/${match[2]}`,
      { method: 'GET', signal: AbortSignal.timeout(5_000) }
    )
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        channel_id?: string
        guild_id?: string
      } | null
      return {
        ok: true,
        channelId:
          typeof body?.channel_id === 'string' ? body.channel_id : null,
        guildId: typeof body?.guild_id === 'string' ? body.guild_id : null
      }
    }
    const text = await response.text().catch(() => '')
    const code = parseErrorCode(text)
    return {
      ok: false,
      webhookDeleted:
        response.status === 404 || code === DISCORD_UNKNOWN_WEBHOOK,
      error: `webhook info ${response.status}: ${text.slice(0, 200)}`
    }
  } catch (err) {
    return {
      ok: false,
      webhookDeleted: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** A webhook can only delete its own messages; bot-authored ones need the bot DELETE. */
export const deleteWebhookMessage = async (
  webhookUrl: string,
  messageId: string
): Promise<{ ok: boolean; status: number }> => {
  const match = webhookUrl.match(/webhooks\/(\d+)\/([^/?]+)/)
  if (!match) return { ok: false, status: 0 }
  const url = `https://discord.com/api/v10/webhooks/${match[1]}/${match[2]}/messages/${messageId}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5_000)
      })
      if (response.status === 429 && attempt === 0) {
        const body = (await response.json().catch(() => null)) as {
          retry_after?: number
        } | null
        await sleep(Math.max(100, Math.floor((body?.retry_after ?? 1) * 1000)))
        continue
      }
      return { ok: response.ok, status: response.status }
    } catch {
      return { ok: false, status: 0 }
    }
  }
  return { ok: false, status: 429 }
}

interface WebhookUpdateOutcome {
  success: boolean
  messageGone: boolean
  webhookDeleted: boolean
  rateLimited: boolean
  error?: string
  attempts: number
}

const updateViaWebhook = async (
  webhookUrl: string,
  messageId: string,
  payload: DiscordWebhookPayload,
  threadId?: string | null
): Promise<WebhookUpdateOutcome> => {
  const match = webhookUrl.match(/webhooks\/(\d+)\/([^/?]+)/)
  if (!match) {
    return {
      success: false,
      messageGone: false,
      webhookDeleted: false,
      rateLimited: false,
      error: 'invalid webhook URL',
      attempts: 0
    }
  }
  const url = new URL(
    `https://discord.com/api/v10/webhooks/${match[1]}/${match[2]}/messages/${messageId}`
  )
  if (threadId) url.searchParams.set('thread_id', threadId)

  let attempts = 0
  for (let attempt = 0; attempt < WEBHOOK_UPDATE_MAX_ATTEMPTS; attempt++) {
    attempts = attempt + 1
    try {
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      })

      if (response.ok) {
        return {
          success: true,
          messageGone: false,
          webhookDeleted: false,
          rateLimited: false,
          attempts
        }
      }

      if (response.status === 429) {
        const body = (await response.json().catch(() => null)) as {
          retry_after?: number
        } | null
        const retryMs = Math.max(
          100,
          Math.floor((body?.retry_after ?? 1) * 1000)
        )
        logger.warn(
          { messageId, retryMs, attempt: attempts },
          'discord.message_tracking.webhook_update_rate_limited'
        )
        await sleep(retryMs)
        continue
      }

      const errorText = await response.text().catch(() => '')
      const code = parseErrorCode(errorText)
      return {
        success: false,
        messageGone: code === DISCORD_UNKNOWN_MESSAGE,
        webhookDeleted: code === DISCORD_UNKNOWN_WEBHOOK,
        rateLimited: false,
        error: `${response.status}: ${errorText.slice(0, 300)}`,
        attempts
      }
    } catch (err) {
      return {
        success: false,
        messageGone: false,
        webhookDeleted: false,
        rateLimited: false,
        error: err instanceof Error ? err.message : String(err),
        attempts
      }
    }
  }
  return {
    success: false,
    messageGone: false,
    webhookDeleted: false,
    rateLimited: true,
    error: 'Max retries exceeded due to rate limiting',
    attempts
  }
}

type WebhookResponseJson = unknown

const extractWebhookMessageId = (data: WebhookResponseJson): string | null => {
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: string }).id
    if (typeof id === 'string') return id
  }
  return null
}

const sendViaWebhook = async (
  target: DeliveryTarget,
  payload: DiscordWebhookPayload,
  ctx: DeliveryLogContext
): Promise<SendOrUpdateResult> => {
  if (!target.webhookUrl) {
    return {
      outcome: 'failed',
      driver: 'webhook',
      messageId: null,
      channelId: target.channelId,
      failureReason: 'no-webhook-url'
    }
  }
  try {
    // ?wait=true so Discord returns the message id.
    const result = await postToWebhook(target.webhookUrl, payload, {
      waitForResponse: true,
      threadId: target.threadId ?? null,
      guildCode: ctx.guildCode,
      webhookType: ctx.webhookType,
      logDelivery: logDiscordWebhookDelivery
    })
    if (result.ok) {
      const messageId = extractWebhookMessageId(result.data)
      if (!messageId) {
        return {
          outcome: 'failed',
          driver: 'webhook',
          messageId: null,
          channelId: target.channelId,
          failureReason: 'send succeeded but no message id in response'
        }
      }
      return {
        outcome: 'created',
        driver: 'webhook',
        messageId,
        channelId: target.channelId
      }
    }
    const code = result.responseBody
      ? parseErrorCode(result.responseBody)
      : null
    const webhookDeleted =
      code === DISCORD_UNKNOWN_WEBHOOK ||
      (result.status === 404 && code === null)
    return {
      outcome: 'failed',
      driver: 'webhook',
      messageId: null,
      channelId: target.channelId,
      failureReason: webhookDeleted
        ? 'webhook-deleted'
        : (result.error?.message ?? `webhook send failed (${result.status})`)
    }
  } catch (err) {
    // postToWebhook throws on final server/network errors; never rethrow.
    return {
      outcome: 'failed',
      driver: 'webhook',
      messageId: null,
      channelId: target.channelId,
      failureReason: err instanceof Error ? err.message : String(err)
    }
  }
}

const isBotAccessDenied = (result: {
  status: number
  errorCode: number | null
}): boolean =>
  result.status === 403 ||
  result.errorCode === DISCORD_MISSING_ACCESS ||
  result.errorCode === DISCORD_MISSING_PERMISSIONS

const createViaBot = async (
  channelId: string,
  payload: DiscordWebhookPayload,
  ctx: DeliveryLogContext,
  outcomeOnSuccess: 'created' | 'gone-recreated'
): Promise<SendOrUpdateResult> => {
  const result = await createChannelMessage(channelId, payload)
  if (result.ok && result.message?.id) {
    await logDelivery(ctx, `bot:${channelId}`, payload, 'delivered')
    return {
      outcome: outcomeOnSuccess,
      driver: 'bot',
      messageId: result.message.id,
      channelId
    }
  }
  const denied = isBotAccessDenied(result)
  const reason = denied
    ? 'bot-access-denied'
    : `bot create failed (status ${result.status}, code ${result.errorCode ?? 'n/a'})`
  await logDelivery(
    ctx,
    `bot:${channelId}`,
    payload,
    result.status === 429 ? 'rate_limited' : 'failed',
    reason
  )
  return {
    outcome: 'failed',
    driver: 'bot',
    messageId: null,
    channelId,
    failureReason: reason,
    botAccessDenied: denied
  }
}

export const sendOrUpdateEncounterMessage = async (
  driver: MetaDeliveryDriver,
  target: DeliveryTarget,
  payload: DiscordWebhookPayload,
  existingMessageId: string | null,
  ctx: DeliveryLogContext
): Promise<SendOrUpdateResult> => {
  if (driver === 'bot') {
    if (!target.channelId) {
      return {
        outcome: 'failed',
        driver,
        messageId: null,
        channelId: null,
        failureReason: 'no-channel'
      }
    }
    if (existingMessageId) {
      const edit = await editChannelMessage(
        target.channelId,
        existingMessageId,
        payload
      )
      if (edit.ok) {
        await logDelivery(ctx, `bot:${target.channelId}`, payload, 'delivered')
        return {
          outcome: 'updated',
          driver,
          messageId: existingMessageId,
          channelId: target.channelId
        }
      }
      if (edit.errorCode === DISCORD_UNKNOWN_MESSAGE) {
        logger.info(
          { messageId: existingMessageId, channelId: target.channelId },
          'discord.message_tracking.message_gone_recreating'
        )
        return createViaBot(target.channelId, payload, ctx, 'gone-recreated')
      }
      const denied = isBotAccessDenied(edit)
      const reason = denied
        ? 'bot-access-denied'
        : `bot edit failed (status ${edit.status}, code ${edit.errorCode ?? 'n/a'})`
      await logDelivery(
        ctx,
        `bot:${target.channelId}`,
        payload,
        edit.status === 429 ? 'rate_limited' : 'failed',
        reason
      )
      return {
        outcome: 'failed',
        driver,
        messageId: null,
        channelId: target.channelId,
        failureReason: reason,
        botAccessDenied: denied
      }
    }
    return createViaBot(target.channelId, payload, ctx, 'created')
  }

  if (!target.webhookUrl) {
    return {
      outcome: 'failed',
      driver,
      messageId: null,
      channelId: target.channelId,
      failureReason: 'no-webhook-url'
    }
  }
  if (existingMessageId) {
    const update = await updateViaWebhook(
      target.webhookUrl,
      existingMessageId,
      payload,
      target.threadId
    )
    if (update.success) {
      await logDelivery(
        ctx,
        target.webhookUrl,
        payload,
        'delivered',
        undefined,
        update.attempts - 1
      )
      return {
        outcome: 'updated',
        driver,
        messageId: existingMessageId,
        channelId: target.channelId
      }
    }
    if (update.webhookDeleted) {
      // Never silent: the caller alerts and stops the sync.
      logger.error(
        { messageId: existingMessageId, guildCode: ctx.guildCode },
        'discord.message_tracking.webhook_deleted'
      )
      await logDelivery(
        ctx,
        target.webhookUrl,
        payload,
        'failed',
        'webhook-deleted (Discord 10015)',
        update.attempts - 1
      )
      return {
        outcome: 'failed',
        driver,
        messageId: null,
        channelId: target.channelId,
        failureReason: 'webhook-deleted'
      }
    }
    if (!update.messageGone) {
      // Fail without creating a duplicate.
      await logDelivery(
        ctx,
        target.webhookUrl,
        payload,
        update.rateLimited ? 'rate_limited' : 'failed',
        update.error,
        update.attempts - 1
      )
      return {
        outcome: 'failed',
        driver,
        messageId: null,
        channelId: target.channelId,
        failureReason: update.error ?? 'webhook update failed'
      }
    }
    logger.info(
      { messageId: existingMessageId },
      'discord.message_tracking.message_gone_recreating'
    )
    const recreated = await sendViaWebhook(target, payload, ctx)
    return recreated.outcome === 'created'
      ? { ...recreated, outcome: 'gone-recreated' }
      : recreated
  }
  return sendViaWebhook(target, payload, ctx)
}

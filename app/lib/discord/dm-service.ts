/** Transport failures deliberately throw (callers retry); Discord-level ones return a typed result. */

import { createComponentLogger } from '@/app/lib/logging'
import {
  SERVICE_TIMEOUTS,
  withResponseBodyTimeout
} from '@/app/lib/utils/async-timeout'

const logger = createComponentLogger('discord.dm-service')

const DISCORD_API_BASE = 'https://discord.com/api/v10'

const DISCORD_CODE_CANNOT_DM_USER = 50007

export interface SendDiscordDirectMessageInput {
  discordUserId: string
  content: string
  cachedChannelId?: string | null
}

export type SendDiscordDirectMessageFailureReason =
  'no_bot_token' | 'dm_blocked' | 'rate_limited' | 'error'

export type SendDiscordDirectMessageResult =
  | { ok: true; channelId: string }
  | {
      ok: false
      reason: SendDiscordDirectMessageFailureReason
      step?: 'channel' | 'message'
      status?: number
      retryAfterMs?: number
    }

type SendFailure = Extract<SendDiscordDirectMessageResult, { ok: false }>

async function fetchDiscordApi(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    SERVICE_TIMEOUTS.DISCORD_WEBHOOK
  )

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    })
    return withResponseBodyTimeout(
      response,
      SERVICE_TIMEOUTS.DISCORD_WEBHOOK,
      'Discord API response',
      { onTimeout: () => controller.abort() }
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

async function classifyFailure(
  response: Response,
  step: 'channel' | 'message'
): Promise<SendFailure> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON body: classify on status alone.
  }
  const errorBody = (body ?? {}) as {
    code?: number
    retry_after?: number
    message?: string
  }

  logger.warn(
    { step, status: response.status, error: body },
    'Discord DM call failed'
  )

  // 'dm_blocked' strikes the recipient, so it needs recipient-specific evidence; a coded 403 is bot-side.
  if (
    errorBody.code === DISCORD_CODE_CANNOT_DM_USER ||
    (response.status === 403 && step === 'message' && errorBody.code == null)
  ) {
    return { ok: false, reason: 'dm_blocked', step, status: response.status }
  }

  if (response.status === 429) {
    let retryAfterMs: number | undefined
    if (typeof errorBody.retry_after === 'number') {
      retryAfterMs = Math.max(0, Math.round(errorBody.retry_after * 1000))
    } else if (typeof response.headers?.get === 'function') {
      const header = Number(response.headers.get('Retry-After'))
      if (Number.isFinite(header)) {
        retryAfterMs = Math.max(0, Math.round(header * 1000))
      }
    }
    return {
      ok: false,
      reason: 'rate_limited',
      step,
      status: response.status,
      retryAfterMs
    }
  }

  return { ok: false, reason: 'error', step, status: response.status }
}

async function createDmChannel(
  botToken: string,
  discordUserId: string
): Promise<{ channelId: string } | SendFailure> {
  const response = await fetchDiscordApi(
    `${DISCORD_API_BASE}/users/@me/channels`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ recipient_id: discordUserId })
    }
  )

  if (!response.ok) {
    return classifyFailure(response, 'channel')
  }

  const channel = (await response.json()) as { id: string }
  return { channelId: channel.id }
}

async function postDmMessage(
  botToken: string,
  channelId: string,
  content: string
): Promise<{ sent: true } | SendFailure> {
  const response = await fetchDiscordApi(
    `${DISCORD_API_BASE}/channels/${channelId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] }
      })
    }
  )

  if (!response.ok) {
    return classifyFailure(response, 'message')
  }

  return { sent: true }
}

export async function sendDiscordDirectMessage(
  input: SendDiscordDirectMessageInput
): Promise<SendDiscordDirectMessageResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) {
    logger.error('DISCORD_BOT_TOKEN is not configured')
    return { ok: false, reason: 'no_bot_token' }
  }

  let channelId: string
  let usedCachedChannel = false
  if (input.cachedChannelId) {
    channelId = input.cachedChannelId
    usedCachedChannel = true
  } else {
    const created = await createDmChannel(botToken, input.discordUserId)
    if ('ok' in created) return created
    channelId = created.channelId
  }

  let sendResult = await postDmMessage(botToken, channelId, input.content)
  if (
    'ok' in sendResult &&
    usedCachedChannel &&
    sendResult.reason === 'error' &&
    sendResult.status === 404
  ) {
    logger.info(
      { discordUserId: input.discordUserId, staleChannelId: channelId },
      'Cached DM channel 404ed; re-creating'
    )
    const recreated = await createDmChannel(botToken, input.discordUserId)
    if ('ok' in recreated) return recreated
    channelId = recreated.channelId
    sendResult = await postDmMessage(botToken, channelId, input.content)
  }

  if ('ok' in sendResult) return sendResult

  return { ok: true, channelId }
}

// Node port of the edge sendOrUpdateMessage/updateWebhookMessage semantics.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteWebhookMessage,
  resolveWebhookChannelId,
  sendOrUpdateEncounterMessage,
  type DeliveryLogContext,
  type DeliveryTarget
} from '@/app/lib/discord/message-tracking'
import {
  createChannelMessage,
  editChannelMessage
} from '@/app/lib/discord/bot-rest-client'
import {
  logDiscordWebhookDelivery,
  postToWebhook
} from '@/app/lib/discord/webhook-service'

vi.mock('@/app/lib/discord/bot-rest-client', () => ({
  createChannelMessage: vi.fn(),
  editChannelMessage: vi.fn(),
  deleteChannelMessage: vi.fn()
}))

vi.mock('@/app/lib/discord/webhook-service', () => ({
  postToWebhook: vi.fn(),
  logDiscordWebhookDelivery: vi.fn()
}))

vi.mock('@/app/lib/utils/async-timeout', () => ({
  sleep: vi.fn(() => Promise.resolve())
}))

const createMock = vi.mocked(createChannelMessage)
const editMock = vi.mocked(editChannelMessage)
const postMock = vi.mocked(postToWebhook)
const logMock = vi.mocked(logDiscordWebhookDelivery)

const CHANNEL_ID = '123456789012345678'
const MESSAGE_ID = '900000000000000001'
const NEW_MESSAGE_ID = '900000000000000002'
const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/token'

const ctx: DeliveryLogContext = {
  guildCode: 'TEST',
  webhookType: 'leaderboard'
}
const botTarget: DeliveryTarget = {
  webhookUrl: WEBHOOK_URL,
  channelId: CHANNEL_ID
}
const payload = { content: 'hello', embeds: [{ description: 'd' }] }

const jsonResponse = (status: number, body: Record<string, number | string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bot driver', () => {
  it('edits in place and returns updated with the SAME id', async () => {
    editMock.mockResolvedValue({
      ok: true,
      status: 200,
      errorCode: null,
      message: { id: MESSAGE_ID }
    })

    const result = await sendOrUpdateEncounterMessage(
      'bot',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('updated')
    expect(result.messageId).toBe(MESSAGE_ID)
    expect(createMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered' })
    )
  })

  it('10008 (Unknown Message) recreates exactly ONCE', async () => {
    editMock.mockResolvedValue({
      ok: false,
      status: 404,
      errorCode: 10008,
      message: null
    })
    createMock.mockResolvedValue({
      ok: true,
      status: 200,
      errorCode: null,
      message: { id: NEW_MESSAGE_ID }
    })

    const result = await sendOrUpdateEncounterMessage(
      'bot',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('gone-recreated')
    expect(result.messageId).toBe(NEW_MESSAGE_ID)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('non-10008 edit failure NEVER creates a duplicate and never returns a stale id', async () => {
    editMock.mockResolvedValue({
      ok: false,
      status: 500,
      errorCode: null,
      message: null
    })

    const result = await sendOrUpdateEncounterMessage(
      'bot',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('failed')
    expect(result.messageId).toBeNull()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('403 / 50001 flags botAccessDenied so the caller can fall back', async () => {
    createMock.mockResolvedValue({
      ok: false,
      status: 403,
      errorCode: 50001,
      message: null
    })

    const result = await sendOrUpdateEncounterMessage(
      'bot',
      botTarget,
      payload,
      null,
      ctx
    )

    expect(result.outcome).toBe('failed')
    expect(result.botAccessDenied).toBe(true)
    expect(result.failureReason).toBe('bot-access-denied')
  })
})

describe('webhook driver', () => {
  it('sends with waitForResponse (?wait=true) and returns the created id', async () => {
    postMock.mockResolvedValue({
      ok: true,
      status: 200,
      attempts: 1,
      data: { id: NEW_MESSAGE_ID }
    })

    const result = await sendOrUpdateEncounterMessage(
      'webhook',
      botTarget,
      payload,
      null,
      ctx
    )

    expect(result.outcome).toBe('created')
    expect(result.messageId).toBe(NEW_MESSAGE_ID)
    expect(postMock).toHaveBeenCalledWith(
      WEBHOOK_URL,
      payload,
      expect.objectContaining({ waitForResponse: true })
    )
  })

  it('PATCHes an existing message and retries through 429 with retry_after', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { retry_after: 0.01 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: MESSAGE_ID }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendOrUpdateEncounterMessage(
      'webhook',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('updated')
    expect(result.messageId).toBe(MESSAGE_ID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const patchUrl = String(fetchMock.mock.calls[0]![0])
    expect(patchUrl).toContain(`/messages/${MESSAGE_ID}`)
  })

  it('update 10008 recreates once via the send path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { code: 10008 }))
    )
    postMock.mockResolvedValue({
      ok: true,
      status: 200,
      attempts: 1,
      data: { id: NEW_MESSAGE_ID }
    })

    const result = await sendOrUpdateEncounterMessage(
      'webhook',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('gone-recreated')
    expect(result.messageId).toBe(NEW_MESSAGE_ID)
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('update 10015 (Unknown Webhook) is a LOUD webhook-deleted failure, never silent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { code: 10015 }))
    )

    const result = await sendOrUpdateEncounterMessage(
      'webhook',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('failed')
    expect(result.failureReason).toBe('webhook-deleted')
    expect(result.messageId).toBeNull()
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('webhook-deleted')
      })
    )
    expect(postMock).not.toHaveBeenCalled()
  })

  it('other update failures do not create duplicates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' }))
    )

    const result = await sendOrUpdateEncounterMessage(
      'webhook',
      botTarget,
      payload,
      MESSAGE_ID,
      ctx
    )

    expect(result.outcome).toBe('failed')
    expect(result.messageId).toBeNull()
    expect(postMock).not.toHaveBeenCalled()
  })

  it('maps a thrown postToWebhook (circuit-breaker path) to a failed outcome', async () => {
    postMock.mockRejectedValue(new Error('Discord webhook failed: 503'))

    const result = await sendOrUpdateEncounterMessage(
      'webhook',
      botTarget,
      payload,
      null,
      ctx
    )

    expect(result.outcome).toBe('failed')
    expect(result.messageId).toBeNull()
  })
})

describe('deleteWebhookMessage', () => {
  it('deletes via the webhook token and reports success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await deleteWebhookMessage(WEBHOOK_URL, MESSAGE_ID)).toEqual({
      ok: true,
      status: 204
    })
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      `/messages/${MESSAGE_ID}`
    )
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' })
  })

  it('surfaces the raw status so callers can treat 404 (already gone) as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { code: 10008 }))
    )
    expect(await deleteWebhookMessage('not-a-webhook-url', MESSAGE_ID)).toEqual(
      { ok: false, status: 0 }
    )
    expect(await deleteWebhookMessage(WEBHOOK_URL, MESSAGE_ID)).toEqual({
      ok: false,
      status: 404
    })
  })

  it('retries ONCE through a 429 honoring retry_after', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { retry_after: 0.01 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await deleteWebhookMessage(WEBHOOK_URL, MESSAGE_ID)).toEqual({
      ok: true,
      status: 204
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('resolveWebhookChannelId', () => {
  it('returns the channel id from unauthenticated webhook info', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { channel_id: CHANNEL_ID, guild_id: '42' })
        )
    )

    const result = await resolveWebhookChannelId(WEBHOOK_URL)
    expect(result).toEqual({ ok: true, channelId: CHANNEL_ID, guildId: '42' })
  })

  it('flags a deleted webhook (404 / 10015)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { code: 10015 }))
    )

    const result = await resolveWebhookChannelId(WEBHOOK_URL)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.webhookDeleted).toBe(true)
  })
})

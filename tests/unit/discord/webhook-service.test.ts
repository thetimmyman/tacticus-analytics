import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WebhookRateLimiter,
  postToWebhook
} from '@/app/lib/discord/webhook-service'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'

const createMockResponse = (
  status: number,
  body = '',
  headers: Record<string, string> = {}
) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (key: string) => headers[key.toLowerCase()] ?? null
  },
  text: async () => body,
  json: async () => JSON.parse(body || '{}')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('WebhookRateLimiter', () => {
  it('waits for token refill when capacity is exhausted', async () => {
    vi.useFakeTimers()
    const limiter = new WebhookRateLimiter({
      requestsPerMinute: 60,
      burstLimit: 1
    })

    await limiter.waitForSlot('test')

    let resolved = false
    const pending = limiter.waitForSlot('test').then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await pending

    expect(resolved).toBe(true)
  })
})

describe('postToWebhook', () => {
  const payload: DiscordWebhookPayload = { content: 'hello' }
  const webhookUrl = 'https://discord.com/api/webhooks/123/token'

  it('rejects invalid webhook URLs before posting', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await postToWebhook('not-a-webhook', payload, {
      rateLimit: false
    })

    expect(result.ok).toBe(false)
    expect(result.error?.type).toBe('invalid_webhook')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries on server errors and logs delivered role mentions', async () => {
    vi.useFakeTimers()
    const roleId = '123456789012345678'
    const rolePayload: DiscordWebhookPayload = {
      content: `<@&${roleId}>`,
      allowed_mentions: { roles: [roleId] }
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse(500, 'server error'))
      .mockResolvedValueOnce(createMockResponse(204))
    vi.stubGlobal('fetch', fetchMock)

    const logDelivery = vi.fn().mockResolvedValue(undefined)

    const resultPromise = postToWebhook(webhookUrl, rolePayload, {
      rateLimit: false,
      retries: 1,
      retryDelayMs: 10,
      guildCode: 'EOT',
      webhookType: 'leaderboard',
      logDelivery
    })

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedRoles: [roleId],
        status: 'delivered',
        retryCount: 1
      })
    )
  })

  it('does not attach role mentions to a failed delivery row', async () => {
    const roleId = '123456789012345678'
    const rolePayload: DiscordWebhookPayload = {
      content: `<@&${roleId}>`,
      allowed_mentions: { roles: [roleId] }
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createMockResponse(500, 'server error'))
    )
    const logDelivery = vi.fn().mockResolvedValue(undefined)

    await expect(
      postToWebhook(webhookUrl, rolePayload, {
        rateLimit: false,
        retries: 0,
        guildCode: 'EOT',
        webhookType: 'herald',
        logDelivery
      })
    ).rejects.toThrow('Discord webhook failed: server error')
    expect(logDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedRoles: undefined,
        status: 'failed'
      })
    )
  })

  it('does not infer a ping when allowed mentions suppress role text', async () => {
    const roleId = '123456789012345678'
    const textOnlyPayload: DiscordWebhookPayload = {
      content: `<@&${roleId}>`,
      allowed_mentions: { parse: [] }
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(204)))
    const logDelivery = vi.fn().mockResolvedValue(undefined)

    await postToWebhook(webhookUrl, textOnlyPayload, {
      rateLimit: false,
      retries: 0,
      guildCode: 'EOT',
      webhookType: 'herald',
      logDelivery
    })

    expect(logDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ mentionedRoles: undefined })
    )
  })

  it('captures rate limit responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createMockResponse(429, '{"retry_after":1}'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await postToWebhook(webhookUrl, payload, {
      rateLimit: false,
      retries: 0
    })

    expect(result.ok).toBe(false)
    expect(result.error?.type).toBe('rate_limited')
    expect(result.error?.retryAfter).toBe(1)
  })
})

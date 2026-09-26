import { describe, expect, it, vi } from 'vitest'
import { sendDiscordFollowupMessage } from '@/app/lib/discord/followup-message'

const createLogger = () => ({
  warn: vi.fn(),
  error: vi.fn()
})

describe('sendDiscordFollowupMessage', () => {
  it('patches the original deferred interaction response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 204 }))
    const sleepFn = vi.fn()
    const logger = createLogger()

    await sendDiscordFollowupMessage(
      'interaction-token',
      {
        content: 'Ready',
        embeds: [{ title: 'Summary' }],
        components: [{ type: 1, components: [] }],
        flags: 64
      },
      {
        applicationId: 'application-id',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger,
        sleepFn
      }
    )

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://discord.com/api/v10/webhooks/application-id/interaction-token/messages/@original',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Ready',
          embeds: [{ title: 'Summary' }],
          components: [{ type: 1, components: [] }],
          flags: 64
        })
      })
    )
    expect(sleepFn).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('retries transient network failures with the configured backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN discord.com'))
      .mockResolvedValueOnce(new Response('', { status: 204 }))
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const logger = createLogger()

    await sendDiscordFollowupMessage(
      'interaction-token',
      { content: 'Recovered' },
      {
        applicationId: 'application-id',
        backoffMs: [25],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger,
        sleepFn
      }
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledWith(25)
    expect(logger.warn).toHaveBeenCalledWith(
      {
        attempt: 0,
        error: 'getaddrinfo EAI_AGAIN discord.com'
      },
      'Discord follow-up network error, will retry'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('retries retryable HTTP statuses and gives up after the attempt budget', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('upstream error', { status: 502 }))
      .mockResolvedValueOnce(new Response('still down', { status: 503 }))
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const logger = createLogger()

    await sendDiscordFollowupMessage(
      'interaction-token',
      { content: 'Retry me' },
      {
        applicationId: 'application-id',
        backoffMs: [10, 20],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger,
        maxAttempts: 3,
        sleepFn
      }
    )

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 10)
    expect(sleepFn).toHaveBeenNthCalledWith(2, 20)
    expect(logger.warn).toHaveBeenCalledTimes(3)
    expect(logger.error).toHaveBeenCalledWith(
      { attempts: 3 },
      'Discord follow-up failed after all retries'
    )
  })

  it('honors Discord retry-after delays for rate limits', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '1.25' }
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 204 }))
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const logger = createLogger()

    await sendDiscordFollowupMessage(
      'interaction-token',
      { content: 'Retry me' },
      {
        applicationId: 'application-id',
        backoffMs: [10],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger,
        sleepFn
      }
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledWith(1250)
    expect(logger.warn).toHaveBeenCalledWith(
      {
        status: 429,
        body: 'rate limited',
        attempt: 0,
        retryDelayMs: 1250
      },
      'Discord follow-up transient HTTP failure, will retry'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('does not sleep past the interaction token retry budget', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '2.5' }
      })
    )
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const logger = createLogger()

    await sendDiscordFollowupMessage(
      'interaction-token',
      { content: 'Too late' },
      {
        applicationId: 'application-id',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger,
        maxElapsedMs: 1_000,
        sleepFn
      }
    )

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleepFn).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      {
        status: 429,
        body: 'rate limited',
        attempt: 0,
        retryDelayMs: 2500
      },
      'Discord follow-up transient HTTP failure, will retry'
    )
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 0,
        retryDelayMs: 2500
      }),
      'Discord follow-up retry delay exceeds interaction token budget'
    )
  })

  it('does not retry non-retryable client errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('expired token', { status: 404 }))
    const sleepFn = vi.fn()
    const logger = createLogger()

    await sendDiscordFollowupMessage(
      'interaction-token',
      { content: 'Expired' },
      {
        applicationId: 'application-id',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger,
        sleepFn
      }
    )

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleepFn).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      { status: 404, body: 'expired token' },
      'Discord follow-up failed (non-retryable)'
    )
  })
})

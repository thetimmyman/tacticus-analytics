/** Byte-level guard through the REAL AppError module; the route suites mock that layer. */
import { describe, it, expect, vi } from 'vitest'
import { AppError } from '@/app/lib/errors/AppError'
import { throwDiscordWebhookError } from '@/app/lib/discord/webhook-error-mapping'

type Logger = { error: ReturnType<typeof vi.fn> }

const makeLogger = (): Logger => ({ error: vi.fn() })

const makeResponse = (
  status: number,
  text: string | (() => Promise<string>),
  statusText = 'Status'
): Response =>
  ({
    status,
    statusText,
    text: typeof text === 'function' ? text : () => Promise.resolve(text)
  }) as unknown as Response

const capture = async (fn: () => Promise<never>): Promise<AppError> => {
  try {
    await fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error('expected throwDiscordWebhookError to throw')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const base = (logger: Logger, extra: Record<string, unknown> = {}) => ({
  endpoint: '/api/discord-webhooks/event-notification',
  logger: logger as any,
  logMessage: 'Discord API error',
  ...extra
})

describe('throwDiscordWebhookError', () => {
  it('maps 404 to discordWebhookInvalid (400) with default message', async () => {
    const logger = makeLogger()
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(404, '{"message":"Unknown Webhook"}'),
        base(logger)
      )
    )
    expect(err).toBeInstanceOf(AppError)
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe(
      'Discord webhook not found. Please check the webhook URL is correct.'
    )
    expect(err.metadata).toEqual({
      endpoint: '/api/discord-webhooks/event-notification',
      details: 'Webhook URL may be incorrect or webhook may have been deleted'
    })
  })

  it('honours notFoundMessage on 404', async () => {
    const logger = makeLogger()
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(404, ''),
        base(logger, {
          notFoundMessage: 'Check the webhook URL is correct in Guild Settings.'
        })
      )
    )
    expect(err.message).toBe(
      'Check the webhook URL is correct in Guild Settings.'
    )
  })

  it('maps 401 and 403 to discordWebhookInvalid (400) auth-failed', async () => {
    for (const status of [401, 403]) {
      const err = await capture(() =>
        throwDiscordWebhookError(
          makeResponse(status, 'nope'),
          base(makeLogger())
        )
      )
      expect(err.statusCode).toBe(400)
      expect(err.message).toBe(
        'Discord webhook authentication failed. The webhook may have been deleted or regenerated.'
      )
      expect(err.metadata).toMatchObject({
        details: 'Webhook authentication failed'
      })
    }
  })

  it('maps 400 with JSON body to Errors.external(400) using parsed message', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(400, '{"message":"Invalid Form Body"}'),
        base(makeLogger())
      )
    )
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Discord rejected the message: Invalid Form Body')
    expect(err.metadata).toMatchObject({
      details: 'Discord API rejected the message format'
    })
  })

  it('maps 400 with non-JSON body to the "Invalid message format" fallback', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(400, 'plain text'),
        base(makeLogger())
      )
    )
    expect(err.message).toBe(
      'Discord rejected the message: Invalid message format'
    )
  })

  it('maps 429 to rateLimit (429) with empty metadata', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(429, 'slow down'),
        base(makeLogger())
      )
    )
    expect(err.statusCode).toBe(429)
    expect(err.message).toBe('Rate limit exceeded')
    expect(JSON.parse(JSON.stringify(err.metadata ?? {}))).toEqual({})
  })

  it('uses genericStatus (502) for the generic branch when provided', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(500, '{"message":"Discord internal error"}'),
        base(makeLogger(), { genericStatus: 502 })
      )
    )
    expect(err.statusCode).toBe(502)
    expect(err.message).toBe('Discord API error (500): Discord internal error')
    expect(err.metadata).toMatchObject({
      details: 'Discord API returned status 500'
    })
  })

  it('passes the upstream status through when genericStatus is omitted', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(makeResponse(503, ''), base(makeLogger()))
    )
    expect(err.statusCode).toBe(503)
    expect(err.message).toBe('Discord API error (503): Unknown error')
  })

  it('preserves extraMeta ordering (endpoint, guild_code, details)', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(500, 'boom'),
        base(makeLogger(), { extraMeta: { guild_code: 'TEST' } })
      )
    )
    expect(Object.keys(err.metadata ?? {})).toEqual([
      'endpoint',
      'guild_code',
      'details'
    ])
    expect((err.metadata as { guild_code: string }).guild_code).toBe('TEST')
  })

  it('falls back to "Could not parse error response" when text() rejects', async () => {
    const err = await capture(() =>
      throwDiscordWebhookError(
        makeResponse(418, () => Promise.reject(new Error('read failed'))),
        base(makeLogger())
      )
    )
    expect(err.statusCode).toBe(418)
    expect(err.message).toBe(
      'Discord API error (418): Could not parse error response'
    )
  })

  it('logs status/statusText/error plus logContext under logMessage', async () => {
    const logger = makeLogger()
    await capture(() =>
      throwDiscordWebhookError(
        makeResponse(500, 'raw', 'Server Error'),
        base(logger, { logContext: { eventType: 'new_member' } })
      )
    )
    expect(logger.error).toHaveBeenCalledWith(
      {
        status: 500,
        statusText: 'Server Error',
        error: 'raw',
        eventType: 'new_member'
      },
      'Discord API error'
    )
  })
})

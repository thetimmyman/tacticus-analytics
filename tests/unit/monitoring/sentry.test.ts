import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getClient: vi.fn(() => ({})),
  startSpan: vi.fn()
}))

vi.mock('@sentry/nextjs', () => sentry)

describe('Sentry PII boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.SENTRY_DSN = 'https://public@example.test/1'
  })

  it('sanitizes capture context while preserving exceptions for beforeSend filters', async () => {
    const { captureSentryException } =
      await import('@/app/lib/monitoring/sentry')
    const requestId = 'req_223e4567-e89b-42d3-a456-426614174000'
    const userId = '123e4567-e89b-42d3-a456-426614174000'
    const error = new Error(`person@example.com failed for ${userId}`)

    captureSentryException(error, {
      tags: { guild_code: 'SECRET', requestId },
      extra: {
        playerName: 'Alice',
        nested: [{ discord_user_id: '123456789012345678' }]
      }
    })

    expect(sentry.captureException).toHaveBeenCalledTimes(1)
    const [capturedError, capturedContext] =
      sentry.captureException.mock.calls[0]
    expect(capturedError).toBe(error)
    expect(capturedContext.tags.guild_code).toBe('[Redacted]')
    expect(capturedContext.tags.requestId).toBe(requestId)
    const serialized = JSON.stringify(capturedContext)
    expect(serialized).not.toContain('SECRET')
    expect(serialized).not.toContain('Alice')
    expect(serialized).not.toContain('123456789012345678')
    expect(serialized).not.toContain(userId)
  })

  it('captures when GlitchTip is the only configured telemetry backend', async () => {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    process.env.NEXT_PUBLIC_GLITCHTIP_DSN = 'https://public@glitchtip.test/1'
    vi.resetModules()

    const { captureSentryException, isSentryEnabled } =
      await import('@/app/lib/monitoring/sentry')
    captureSentryException(new Error('Private failure'))

    expect(isSentryEnabled()).toBe(true)
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })
})

import type { Log } from '@sentry/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({
  init: vi.fn()
}))

vi.mock('@sentry/nextjs', () => sentry)

interface SentryInitOptions {
  enableLogs?: boolean
  beforeSendLog?: (log: Log) => Log | null
}

async function loadInitOptions(
  loadConfig: () => Promise<unknown>
): Promise<SentryInitOptions> {
  vi.resetModules()
  sentry.init.mockClear()
  await loadConfig()

  const options = sentry.init.mock.calls[0]?.[0]
  if (!options) throw new Error('Sentry.init was not called')
  return options as SentryInitOptions
}

function secretLog(): Log {
  const email = 'person@example.com'
  return {
    level: 'info',
    message: `login received for ${email}`,
    attributes: {
      email,
      playerName: 'Alice',
      nested: { contact: email }
    }
  }
}

describe('Sentry structured-log redaction', () => {
  beforeEach(() => {
    sentry.init.mockClear()
  })

  it('redacts server log messages and attributes', async () => {
    const options = await loadInitOptions(
      () => import('../../../sentry.server.config')
    )
    const beforeSendLog = options.beforeSendLog
    if (!beforeSendLog) throw new Error('server beforeSendLog is missing')

    const sanitized = beforeSendLog(secretLog())
    expect(options.enableLogs).toBe(true)
    expect(sanitized).not.toBeNull()
    expect(sanitized?.message).not.toContain('person@example.com')
    expect(sanitized?.attributes).toEqual({
      email: '[Redacted]',
      playerName: '[Redacted]',
      nested: { contact: '[Redacted]' }
    })
  })

  it('redacts edge log messages and attributes', async () => {
    const options = await loadInitOptions(
      () => import('../../../sentry.edge.config')
    )
    const beforeSendLog = options.beforeSendLog
    if (!beforeSendLog) throw new Error('edge beforeSendLog is missing')

    const sanitized = beforeSendLog(secretLog())
    expect(options.enableLogs).toBe(true)
    expect(sanitized).not.toBeNull()
    expect(sanitized?.message).not.toContain('person@example.com')
    expect(sanitized?.attributes).toEqual({
      email: '[Redacted]',
      playerName: '[Redacted]',
      nested: { contact: '[Redacted]' }
    })
  })

  it('drops a log when sanitization throws', async () => {
    const options = await loadInitOptions(
      () => import('../../../sentry.server.config')
    )
    const beforeSendLog = options.beforeSendLog
    if (!beforeSendLog) throw new Error('server beforeSendLog is missing')

    const throwingLog = Object.defineProperty(
      { level: 'info', attributes: {} },
      'message',
      {
        enumerable: true,
        get() {
          throw new Error('message getter failed')
        }
      }
    ) as Log

    expect(beforeSendLog(throwingLog)).toBeNull()
  })
})

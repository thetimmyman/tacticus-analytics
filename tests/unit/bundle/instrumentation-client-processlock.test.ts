import { describe, expect, it, vi } from 'vitest'
import { init } from '@sentry/nextjs'

// The module calls Sentry init() at import time.
vi.mock('@sentry/nextjs', () => ({
  addIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init: vi.fn(),
  lazyLoadIntegration: vi.fn(() => Promise.resolve(vi.fn()))
}))

import {
  isProcessLockTimeout,
  isProcessLockTimeoutEvent
} from '@/instrumentation-client'

const LOCK_TIMEOUT_MESSAGE =
  'Acquiring process lock with name "lock:tacticus-auth-token" timed out'

describe('cause-wrapped chunk telemetry', () => {
  const beforeSend = vi.mocked(init).mock.calls[0][0]?.beforeSend as (
    event: Record<string, unknown>,
    hint: { originalException: unknown }
  ) => Record<string, unknown> | null

  it.each([
    ['auto.browser.global_handlers.onunhandledrejection', 'attempted'],
    ['auto.browser.global_handlers.onerror', 'suppressed']
  ])(
    'classifies the outer global handler %s as %s',
    (mechanismType, outcome) => {
      sessionStorage.clear()
      const cause = new Error(
        'Failed to load chunk /_next/static/chunks/page.js'
      )
      cause.name = 'ChunkLoadError'
      const error = new Error('Application failed', { cause })
      const sent = beforeSend(
        {
          level: 'error',
          exception: {
            values: [
              { type: 'ChunkLoadError', value: cause.message },
              {
                type: 'Error',
                value: error.message,
                mechanism: { type: mechanismType, handled: false }
              }
            ]
          }
        },
        { originalException: error }
      )

      expect(sent?.tags).toMatchObject({ chunk_reload: outcome })
      expect(sent?.level).toBe(outcome === 'attempted' ? 'warning' : 'error')
      if (outcome === 'attempted') {
        expect(sent?.fingerprint).toEqual(['client-chunk-reload-attempted'])
      }
    }
  )
})

describe('isProcessLockTimeout', () => {
  it.each([
    ['Error', LOCK_TIMEOUT_MESSAGE, true],
    ['ProcessLockAcquireTimeoutError', '', true],
    ['processlockacquiretimeouterror', 'x', true],
    ['Error', 'Request timed out', false],
    ['Error', 'Lock wait timeout exceeded', false],
    ['TypeError', 'Cannot read properties of undefined', false],
    ['', '', false]
  ])('(%s, %s) -> %s', (name, message, expected) => {
    expect(isProcessLockTimeout(name, message)).toBe(expected)
  })
})

describe('isProcessLockTimeoutEvent', () => {
  const lockValue = { type: 'Error', value: LOCK_TIMEOUT_MESSAGE }

  it('matches when the only exception value is the lock timeout', () => {
    expect(
      isProcessLockTimeoutEvent({ exception: { values: [lockValue] } })
    ).toBe(true)
    expect(
      isProcessLockTimeoutEvent({
        exception: {
          values: [{ type: 'ProcessLockAcquireTimeoutError', value: '' }]
        }
      })
    ).toBe(true)
  })

  it('matches when EVERY value in the chain is the lock timeout', () => {
    expect(
      isProcessLockTimeoutEvent({
        exception: { values: [lockValue, lockValue] }
      })
    ).toBe(true)
  })

  it('does NOT match a real error wrapping a lock-timeout cause', () => {
    // linkedErrors puts the innermost cause at values[0]; the wrapper keeps error severity.
    expect(
      isProcessLockTimeoutEvent({
        exception: {
          values: [
            lockValue,
            { type: 'TypeError', value: 'Cannot read properties of undefined' }
          ]
        }
      })
    ).toBe(false)
  })

  it('does NOT match unrelated timeout wordings or empty events', () => {
    expect(
      isProcessLockTimeoutEvent({
        exception: { values: [{ type: 'Error', value: 'Request timed out' }] }
      })
    ).toBe(false)
    expect(
      isProcessLockTimeoutEvent({
        exception: {
          values: [{ type: 'Error', value: 'Lock wait timeout exceeded' }]
        }
      })
    ).toBe(false)
    expect(isProcessLockTimeoutEvent({})).toBe(false)
    expect(isProcessLockTimeoutEvent({ exception: { values: [] } })).toBe(false)
  })
})

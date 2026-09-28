import { describe, expect, it, vi } from 'vitest'

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

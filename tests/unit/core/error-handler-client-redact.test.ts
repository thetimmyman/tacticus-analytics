/**
 * @vitest-environment happy-dom
 *
 * createError runs in the browser, so user identifiers must not reach devtools.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)
vi.mock('@tacticus/app-core/daily-alert-summary', () => ({
  addErrorAlert: vi.fn(),
  addDatabaseAlert: vi.fn()
}))
vi.mock('../../../version.json', () => ({ default: { version: '1.0.0-test' } }))

import { createEnhancedError } from '@tacticus/app-core/error-handler'
import { legacyConsoleLogger as logger } from '@tacticus/app-core/logger'

describe('createEnhancedError client-console PII redaction (WI-1930)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not emit userId / sessionId / guildCode / clusterCode to the console', () => {
    createEnhancedError('TEST_ERR', 'Boom', 'auth', 'medium', {
      userId: 'user-123',
      sessionId: 'sess-abc',
      guildCode: 'GUILD9',
      clusterCode: 'CLUSTER1'
    })

    const call = vi.mocked(logger.error).mock.calls.at(-1)
    const ctx =
      (call?.[1] as { context?: Record<string, unknown> } | undefined)
        ?.context ?? {}

    expect(ctx.userId).toBeUndefined()
    expect(ctx.sessionId).toBeUndefined()
    expect(ctx.guildCode).toBeUndefined()
    expect(ctx.clusterCode).toBeUndefined()
    const serialized = JSON.stringify(call)
    expect(serialized).not.toContain('user-123')
    expect(serialized).not.toContain('sess-abc')
  })

  it('strips the url query string (e.g. ?code=<recovery-token>) from the console', () => {
    const w = window as unknown as {
      happyDOM?: { setURL?: (u: string) => void }
    }
    w.happyDOM?.setURL?.(
      'https://app.example/auth/reset-password?code=secret-token-xyz'
    )

    createEnhancedError('TEST_ERR', 'Boom', 'auth', 'medium', {})

    const serialized = JSON.stringify(vi.mocked(logger.error).mock.calls.at(-1))
    expect(serialized).not.toContain('secret-token-xyz')
  })
})

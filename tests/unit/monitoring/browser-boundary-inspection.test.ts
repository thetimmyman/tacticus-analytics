import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/app/components/error/ErrorBoundary'
import { isTransientBrowserBoundaryError } from '@/app/lib/monitoring/browser-boundary-filter'
import { captureSentryException } from '@/app/lib/monitoring/sentry'

vi.mock('@/app/lib/monitoring/sentry', () => ({ captureSentryException: vi.fn() }))
vi.mock('@tacticus/app-core/logger', () => import('@/tests/helpers/logger-mock'))

describe('boundary errors with inaccessible causes', () => {
  it.each([
    ['a throwing message getter', () => ({ get message(): never { throw new Error('inaccessible') } })],
    ['a revoked proxy', () => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      return proxy
    }]
  ])('preserves capture and onError for %s', (_label, makeCause) => {
    const error = new TypeError('Failed to fetch', { cause: makeCause() })
    const onError = vi.fn()
    const info = { componentStack: 'test stack' }
    const boundary = new ErrorBoundary({ children: null, onError, autoReset: false })
    boundary.setState = vi.fn()
    vi.mocked(captureSentryException).mockClear()

    expect(() => boundary.componentDidCatch(error, info)).not.toThrow()
    expect(isTransientBrowserBoundaryError(error)).toBe(false)
    expect(captureSentryException).toHaveBeenCalledOnce()
    expect(vi.mocked(captureSentryException).mock.calls[0]?.[0]).toBe(error)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[1]).toBe(info)
  })
})

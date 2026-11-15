import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import { ErrorBoundary } from '@/app/components/error/ErrorBoundary'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
// Real guard: it must share state with the window listeners and global-error.tsx.
import { handleChunkLoadError } from '@/app/lib/client/chunk-reload'

vi.mock('@tacticus/ui-kit', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  )
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@tacticus/app-core/errors', () => ({
  parseError: (error: Error) => ({
    message: error.message,
    stack: error.stack,
    code: 'UNKNOWN'
  })
}))

vi.mock('@tacticus/app-core/error-handler', () => ({
  getVersionInfo: () => ({ version: 'test' })
}))

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

vi.mock('@/app/lib/auth/config', () => ({
  authConfig: { redirects: { afterLogin: '/home' } }
}))

const ProblemChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Boom')
  }
  return <div>Safe content</div>
}

const ThrowGiven = ({ error }: { error: Error }) => {
  throw error
}

describe('ErrorBoundary', () => {
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })

  it('renders error UI and reports the error', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary onError={onError} showDetails>
        <ProblemChild shouldThrow />
      </ErrorBoundary>
    )

    expect(
      screen.getByText('++ Cogitator fault ++ The Machine Spirit faltered.')
    ).toBeInTheDocument()
    expect(onError).toHaveBeenCalled()
    expect(captureSentryException).toHaveBeenCalled()
  })

  it('captures the ORIGINAL Error instance exactly once per catch', () => {
    // Production NODE_ENV, or the once-assertion is vacuous.
    vi.stubEnv('NODE_ENV', 'production')
    const original = new Error('original instance')

    render(
      <ErrorBoundary>
        <ThrowGiven error={original} />
      </ErrorBoundary>
    )

    expect(captureSentryException).toHaveBeenCalledTimes(1)
    const [captured, context] = vi.mocked(captureSentryException).mock.calls[0]
    // The real Error, not parseError()'s plain object.
    expect(captured).toBe(original)
    expect(context?.tags).toMatchObject({ component: 'ErrorBoundary' })
    expect(context?.tags).not.toHaveProperty('chunk_reload')
  })

  it('delegates first-occurrence chunk errors to the shared guard and reloads once, without its own Sentry capture or fault flash', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'eb-build-1')
    const chunkError = new Error('Loading chunk 123 failed')
    chunkError.name = 'ChunkLoadError'

    const { container } = render(
      <ErrorBoundary>
        <ThrowGiven error={chunkError} />
      </ErrorBoundary>
    )

    expect(container).toBeEmptyDOMElement()
    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('tacticus_chunk_reload_eb-build-1')).toBe('1')
    expect(captureSentryException).not.toHaveBeenCalled()
  })

  it.each([
    [
      'native DOMException AbortError',
      new DOMException('The operation was aborted.', 'AbortError')
    ],
    ['Chrome fetch network TypeError', new TypeError('Failed to fetch')],
    ['WebKit fetch network TypeError', new TypeError('Load failed')],
    [
      'Firefox fetch network TypeError',
      new TypeError('NetworkError when attempting to fetch resource.')
    ],
    [
      'fail-closed access wrapper with transient transport cause',
      new Error('Unable to verify account access', {
        cause: new TypeError('fetch failed')
      })
    ]
  ])(
    'renders fallback UI without reporting %s to Sentry',
    (_label, transientError) => {
      render(
        <ErrorBoundary>
          <ThrowGiven error={transientError} />
        </ErrorBoundary>
      )

      expect(
        screen.getByText('++ Cogitator fault ++ The Machine Spirit faltered.')
      ).toBeInTheDocument()
      expect(captureSentryException).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      'HTTP 403 wrapper around TypeError(Failed to fetch)',
      Object.assign(new Error('Request failed'), {
        status: 403,
        cause: new TypeError('Failed to fetch')
      })
    ],
    [
      'SQL 42501 wrapper around TypeError(Failed to fetch)',
      Object.assign(new Error('Query failed'), {
        code: '42501',
        cause: new TypeError('Failed to fetch')
      })
    ],
    [
      'TypeError(Failed to fetch) with SQL cause',
      new TypeError('Failed to fetch', {
        cause: Object.assign(new Error('permission denied'), { code: '42501' })
      })
    ]
  ])(
    'still reports %s to Sentry when actionable metadata exists in the cause chain',
    (_label, actionableError) => {
      render(
        <ErrorBoundary>
          <ThrowGiven error={actionableError} />
        </ErrorBoundary>
      )

      expect(captureSentryException).toHaveBeenCalledTimes(1)
      expect(vi.mocked(captureSentryException).mock.calls[0]?.[0]).toBe(
        actionableError
      )
    }
  )

  it('does not reload again, and tags chunk_reload: suppressed, when the shared guard already recovered this build via a window-level reload', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'eb-build-2')

    const firstOccurrence = new Error('Loading chunk 9 failed')
    firstOccurrence.name = 'ChunkLoadError'
    expect(handleChunkLoadError(firstOccurrence)).toBe('attempted')
    expect(reloadMock).toHaveBeenCalledTimes(1)
    reloadMock.mockClear()
    vi.mocked(captureSentryException).mockClear()

    const secondOccurrence = new Error('Loading chunk 9 failed')
    secondOccurrence.name = 'ChunkLoadError'

    render(
      <ErrorBoundary>
        <ThrowGiven error={secondOccurrence} />
      </ErrorBoundary>
    )

    expect(reloadMock).not.toHaveBeenCalled()

    expect(captureSentryException).toHaveBeenCalledTimes(1)
    const [captured, context] = vi.mocked(captureSentryException).mock.calls[0]
    expect(captured).toBe(secondOccurrence)
    expect(context?.tags).toMatchObject({
      component: 'ErrorBoundary',
      chunk_reload: 'suppressed'
    })
  })

  it('resets when resetKeys change', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={[0]}>
        <ProblemChild shouldThrow />
      </ErrorBoundary>
    )

    expect(
      screen.getByText('++ Cogitator fault ++ The Machine Spirit faltered.')
    ).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKeys={[1]}>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })

  it('resets after clicking Try Again', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>
    )

    expect(
      screen.getByText('++ Cogitator fault ++ The Machine Spirit faltered.')
    ).toBeInTheDocument()

    rerender(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })

  it('schedules only one automatic reset while the boundary remains errored', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    const { rerender } = render(
      <ErrorBoundary showDetails>
        <ProblemChild shouldThrow />
      </ErrorBoundary>
    )

    const scheduledResets = () =>
      timeoutSpy.mock.calls.filter(([, delay]) => delay === 30000).length
    expect(scheduledResets()).toBe(1)

    rerender(
      <ErrorBoundary showDetails={false}>
        <ProblemChild shouldThrow />
      </ErrorBoundary>
    )

    expect(scheduledResets()).toBe(1)
    timeoutSpy.mockRestore()
  })

  it('lets a rendered fallback reset the canonical boundary', () => {
    const Fallback = ({
      resetErrorBoundary
    }: {
      resetErrorBoundary: () => void
    }) => <button onClick={resetErrorBoundary}>Recover section</button>

    const { rerender } = render(
      <ErrorBoundary fallbackRender={Fallback}>
        <ProblemChild shouldThrow />
      </ErrorBoundary>
    )

    rerender(
      <ErrorBoundary fallbackRender={Fallback}>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Recover section' }))

    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })
})

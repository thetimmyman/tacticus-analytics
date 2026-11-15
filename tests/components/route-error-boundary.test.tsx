/**
 * @vitest-environment happy-dom
 */
import vm from 'node:vm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { captureSentryException } = vi.hoisted(() => ({
  captureSentryException: vi.fn()
}))
vi.mock('@/app/lib/monitoring/sentry', () => ({ captureSentryException }))

import RouteError from '@/app/error'

describe('app/error.tsx route boundary', () => {
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
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('reports the error to Sentry and shows the digest as an Error ID', async () => {
    const err = Object.assign(new Error('boom'), { digest: 'abc123def' })
    render(<RouteError error={err} reset={() => {}} />)

    await waitFor(() =>
      expect(captureSentryException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          tags: expect.objectContaining({
            component: 'app-error',
            source: 'react.error-boundary'
          })
        })
      )
    )
    expect(reloadMock).not.toHaveBeenCalled()
    expect(screen.getByText(/abc123def/)).toBeInTheDocument()
  })

  it('does not reload on runtime JSON.parse SyntaxError thrown inside a Next chunk and reports app-error', async () => {
    let jsonErr: Error | undefined
    try {
      vm.runInThisContext("JSON.parse('<html>invalid response</html>')", {
        filename: 'https://app.example/_next/static/chunks/auth.js'
      })
    } catch (error) {
      jsonErr = error as Error
    }
    expect(jsonErr).toBeInstanceOf(SyntaxError)

    render(<RouteError error={jsonErr!} reset={() => {}} />)

    await waitFor(() =>
      expect(captureSentryException).toHaveBeenCalledWith(
        jsonErr,
        expect.objectContaining({
          tags: expect.objectContaining({
            component: 'app-error',
            source: 'react.error-boundary'
          })
        })
      )
    )
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('triggers guarded once-per-build reload on a genuine ChunkLoadError without reporting app-error', async () => {
    const chunkErr = new Error('Loading chunk 42 failed')
    chunkErr.name = 'ChunkLoadError'

    render(<RouteError error={chunkErr} reset={() => {}} />)

    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1))
    expect(captureSentryException).toHaveBeenCalledTimes(1)
    expect(captureSentryException).toHaveBeenCalledWith(chunkErr, {
      tags: { chunk_reload: 'attempted' }
    })
  })
})

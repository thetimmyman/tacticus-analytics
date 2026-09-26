import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import GlobalError from '@/app/global-error'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import {
  handleChunkLoadError,
  isChunkLoadError
} from '@/app/lib/client/chunk-reload'

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

vi.mock('@/app/lib/client/chunk-reload', () => ({
  handleChunkLoadError: vi.fn(),
  isChunkLoadError: vi.fn()
}))

const reset = vi.fn()

describe('GlobalError (PS-346 chunk-reload wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the normal fallback UI and reports non-chunk errors once', () => {
    vi.mocked(isChunkLoadError).mockReturnValue(false)
    vi.mocked(handleChunkLoadError).mockReturnValue('ignored')
    const error = Object.assign(new Error('Something else broke'), {
      digest: 'abc123'
    })

    render(<GlobalError error={error} reset={reset} />)

    expect(
      screen.getByText(
        '++ Machine Spirit displeased ++ A grave fault has occurred.'
      )
    ).toBeInTheDocument()
    expect(handleChunkLoadError).toHaveBeenCalledWith(error)
    expect(captureSentryException).toHaveBeenCalledWith(error)
    expect(captureSentryException).toHaveBeenCalledTimes(1)
  })

  it('renders nothing and does not double-report when a reload was attempted', () => {
    vi.mocked(isChunkLoadError).mockReturnValue(true)
    vi.mocked(handleChunkLoadError).mockReturnValue('attempted')
    const error = Object.assign(new Error('Loading chunk 3 failed'), {
      name: 'ChunkLoadError'
    })

    const { container } = render(<GlobalError error={error} reset={reset} />)

    expect(container).toBeEmptyDOMElement()
    expect(handleChunkLoadError).toHaveBeenCalledWith(error)
    // handleChunkLoadError already reports to Sentry.
    expect(captureSentryException).not.toHaveBeenCalled()
  })

  it('falls through to the normal error UI when a reload was already suppressed', () => {
    vi.mocked(isChunkLoadError).mockReturnValue(true)
    vi.mocked(handleChunkLoadError).mockReturnValue('suppressed')
    const error = Object.assign(new Error('Loading chunk 3 failed'), {
      name: 'ChunkLoadError'
    })

    render(<GlobalError error={error} reset={reset} />)

    expect(
      screen.getByText(
        '++ Machine Spirit displeased ++ A grave fault has occurred.'
      )
    ).toBeInTheDocument()
    expect(handleChunkLoadError).toHaveBeenCalledWith(error)
    expect(captureSentryException).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { captureSentryException } = vi.hoisted(() => ({
  captureSentryException: vi.fn()
}))
vi.mock('@/app/lib/monitoring/sentry', () => ({ captureSentryException }))

import RouteError from '@/app/error'

describe('app/error.tsx route boundary (WI-1930)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports the error to Sentry and shows the digest as an Error ID', async () => {
    const err = Object.assign(new Error('boom'), { digest: 'abc123def' })
    render(<RouteError error={err} reset={() => {}} />)

    await waitFor(() =>
      expect(captureSentryException).toHaveBeenCalledWith(err)
    )
    expect(screen.getByText(/abc123def/)).toBeInTheDocument()
  })
})

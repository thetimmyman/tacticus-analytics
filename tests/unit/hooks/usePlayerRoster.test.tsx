import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { usePlayerRoster } from '@/app/lib/hooks/shared/usePlayerRoster'

// Force 0 retries (the hook sets `retry: 1`) so a failed fetch surfaces at once.
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryDelay: 0,
        gcTime: 0
      }
    }
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('usePlayerRoster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('does not request private roster data while disabled', async () => {
    const { result } = renderHook(() => usePlayerRoster(false), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.current.heroes).toEqual([])
    expect(result.current.machinesOfWar).toEqual([])
  })

  it('surfaces the inner error.message from the standardized error envelope on a 502', async () => {
    const innerMessage =
      'Failed to fetch player data from Tacticus API. Please verify your API key is valid.'
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: {
          code: 4001,
          message: innerMessage,
          retryable: true,
          statusCode: 502,
          requestId: 'req-test-123'
        }
      })
    } as unknown as Response)

    const { result } = renderHook(() => usePlayerRoster(), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.error).toBeTruthy(), {
      timeout: 3000
    })

    const message = (result.current.error as Error).message
    expect(message).toBe(innerMessage)
    expect(message).not.toBe('[object Object]')
    expect(message).not.toBe('Failed to fetch roster')
  })

  it('falls back to a bare string error when the response uses the legacy shape', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Player API key not configured' })
    } as unknown as Response)

    const { result } = renderHook(() => usePlayerRoster(), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.error).toBeTruthy(), {
      timeout: 3000
    })
    expect((result.current.error as Error).message).toBe(
      'Player API key not configured'
    )
  })

  it('falls back to the generic message when no usable error is present', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    } as unknown as Response)

    const { result } = renderHook(() => usePlayerRoster(), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.error).toBeTruthy(), {
      timeout: 3000
    })
    expect((result.current.error as Error).message).toBe(
      'Failed to fetch roster'
    )
  })
})

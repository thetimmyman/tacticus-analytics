import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import SeasonSelector from '@/app/components/SeasonSelector'
import { useClusterContext } from '@/app/hooks/useClusterContext'

const mockSearchParams = vi.hoisted(() => ({
  value: 'season=81'
}))
const mockSeasonAbortSignal = vi.hoisted(() => vi.fn())
const mockDbClient = vi.hoisted(() => vi.fn())

mockSeasonAbortSignal.mockResolvedValue({
  data: ['81', '80', '79'],
  error: null
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: mockDbClient
}))

vi.mock('@/app/hooks/useClusterContext', () => ({
  useClusterContext: vi.fn(() => ({
    guildCode: 'TESTGUILD',
    clusterCode: 'TESTCLUSTER',
    isLoading: false,
    userId: null,
    role: null,
    displayName: null,
    themePreference: null
  }))
}))

const mockUseClusterContext = vi.mocked(useClusterContext)

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn()
  }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(mockSearchParams.value)
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('SeasonSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbClient.mockReturnValue({
      rpc: vi.fn(() => ({ abortSignal: mockSeasonAbortSignal }))
    })
    mockSeasonAbortSignal.mockResolvedValue({
      data: ['81', '80', '79'],
      error: null
    })
    mockSearchParams.value = 'season=81'
  })

  const renderWithQueryClient = (ui: ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    return render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    )
  }

  it('renders with current season', async () => {
    renderWithQueryClient(<SeasonSelector currentSeason="81" />)

    await waitFor(() => {
      expect(screen.getByLabelText('Season:')).toBeInTheDocument()
    })
    expect(mockSeasonAbortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('aborts an in-flight season query before a hard navigation', async () => {
    let resolveQuery:
      ((value: { data: null; error: Error }) => void) | undefined
    mockSeasonAbortSignal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve
        })
    )

    const view = renderWithQueryClient(<SeasonSelector currentSeason="81" />)
    await waitFor(() => expect(mockSeasonAbortSignal).toHaveBeenCalled())
    const signal = mockSeasonAbortSignal.mock.calls[0]?.[0] as AbortSignal

    window.dispatchEvent(new Event('beforeunload'))
    expect(signal.aborted).toBe(true)
    resolveQuery?.({ data: null, error: new Error('aborted') })
    view.unmount()
  })

  it('displays loading state initially', () => {
    mockUseClusterContext.mockReturnValueOnce({
      guildCode: 'TESTGUILD',
      clusterCode: 'TESTCLUSTER',
      isLoading: true,
      userId: null,
      role: null,
      displayName: null,
      themePreference: null
    })

    renderWithQueryClient(<SeasonSelector currentSeason="81" />)
    expect(screen.getByText('Season:')).toBeInTheDocument()
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('allows selecting a different season', async () => {
    renderWithQueryClient(<SeasonSelector currentSeason="81" />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '80' } })

    expect(mockPush).toHaveBeenCalled()
  })

  it('calls onSeasonChange callback when provided', async () => {
    const onSeasonChange = vi.fn()

    renderWithQueryClient(
      <SeasonSelector currentSeason="81" onSeasonChange={onSeasonChange} />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '80' } })

    expect(onSeasonChange).toHaveBeenCalledWith(80)
  })

  it('uses selectedSeason prop when provided', async () => {
    renderWithQueryClient(
      <SeasonSelector currentSeason="81" selectedSeason={79} />
    )

    await waitFor(() => {
      const select = screen.getByRole('combobox')
      expect(select).toHaveValue('79')
    })
  })

  it('handles null season change callback', async () => {
    const onSeasonChange = vi.fn()

    renderWithQueryClient(
      <SeasonSelector currentSeason="81" onSeasonChange={onSeasonChange} />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'invalid' } })

    expect(onSeasonChange).toHaveBeenCalledWith(null)
  })

  it('compact selector has stable width and no text-clip', async () => {
    renderWithQueryClient(<SeasonSelector currentSeason="81" compact />)

    await waitFor(() => {
      const select = screen.getByRole('combobox')
      expect((select as HTMLSelectElement).style.width).toBe('')
      expect((select as HTMLSelectElement).style.minWidth).toBe('')
      expect(select).toHaveClass('h-7')
      expect(select).toHaveClass('text-sm')
      expect(select).toHaveClass('font-semibold')
      expect(select).toHaveClass('shrink-0')
      expect(select).not.toHaveClass('text-clip')
    })
  })

  it('three-digit season value is visible without dynamic width', async () => {
    renderWithQueryClient(
      <SeasonSelector currentSeason="100" selectedSeason={100} compact />
    )

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select).toHaveValue('100')
      expect(select.style.width).toBe('')
    })
  })

  it('keeps current season visible when missing from fetched season options', async () => {
    renderWithQueryClient(
      <SeasonSelector currentSeason="150" selectedSeason={150} compact />
    )

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select).toHaveValue('150')
      expect(screen.getByRole('option', { name: '150' })).toBeInTheDocument()
    })
  })
})

describe('SeasonSelector request diagnostics at the SDK boundary', () => {
  const clients: QueryClient[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.value = 'season=81'
    mockUseClusterContext.mockReturnValue({
      guildCode: 'SYNTHETIC',
      clusterCode: null,
      isLoading: false,
      userId: null,
      role: null,
      displayName: null,
      themePreference: null
    })
  })

  afterEach(() => {
    cleanup()
    for (const client of clients.splice(0)) client.clear()
    vi.restoreAllMocks()
  })

  function renderWithTransport(transport: typeof fetch) {
    // Real SDK builders and real logger; only the fetch transport is synthetic.
    mockDbClient.mockReturnValue(
      createSupabaseClient('https://synthetic.invalid', 'synthetic-public', {
        accessToken: async () => 'synthetic-access',
        global: { fetch: transport }
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    clients.push(client)
    return render(
      <QueryClientProvider client={client}>
        <SeasonSelector currentSeason="81" />
      </QueryClientProvider>
    )
  }

  it('preserves the measured HTTP refusal category and code while redacting the original SDK error', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: '42501',
          message: 'SYNTHETIC-PRIVATE-CANARY',
          details: 'synthetic details',
          hint: 'synthetic hint'
        },
        { status: 403 }
      )
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithTransport(transport)
    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1))
    expect(consoleError.mock.calls[0]).toEqual([
      '[components.SeasonSelector]',
      'Error fetching seasons:',
      {
        err: '[Redacted]',
        operation: 'season_list',
        request_category: 'http-result-error',
        status_code: 403,
        reported_error_name: 'other',
        error_code: '42501',
        error_code_bytes: 5,
        error_code_size: 'within-bound',
        query_aborted: false,
        navigation_aborted: false
      }
    ])
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('CANARY')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('keeps successful season options and emits no failure diagnostic', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(['81', '80']))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithTransport(transport)

    await waitFor(() =>
      expect(screen.getByRole('option', { name: '80' })).toBeInTheDocument()
    )
    expect(consoleError).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('preserves a recognized service code without retrying the RPC', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: 'PGRST000', message: 'SYNTHETIC-SERVICE-CANARY' },
          { status: 503 }
        )
      )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithTransport(transport)

    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1))
    expect(consoleError.mock.calls[0]?.[2]).toMatchObject({
      err: '[Redacted]',
      request_category: 'http-result-error',
      status_code: 503,
      error_code: 'PGRST000',
      error_code_bytes: 8,
      query_aborted: false,
      navigation_aborted: false
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('CANARY')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each(['AbortError', 'TypeError', 'FetchError', 'Error'])(
    'labels the SDK-reported %s without claiming a navigation abort',
    async (name) => {
      const failure = new Error('SYNTHETIC-TRANSPORT-CANARY', {
        cause: {
          code: 'SYNTHETIC-CAUSE-CANARY',
          message: 'synthetic cause details'
        }
      })
      failure.name = name
      const transport = vi.fn<typeof fetch>().mockRejectedValue(failure)
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      renderWithTransport(transport)

      await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1))
      expect(consoleError.mock.calls[0]?.[2]).toMatchObject({
        err: '[Redacted]',
        request_category: 'transport-result-error',
        status_code: 0,
        reported_error_name: name,
        error_code: 'none',
        error_code_bytes: 0,
        query_aborted: false,
        navigation_aborted: false
      })
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('CANARY')
      expect(transport).toHaveBeenCalledTimes(1)
    }
  )

  it('distinguishes a malformed success body while keeping its contents private', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('SYNTHETIC-MALFORMED-CANARY', { status: 200 })
      )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithTransport(transport)

    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1))
    expect(consoleError.mock.calls[0]?.[2]).toMatchObject({
      err: '[Redacted]',
      request_category: 'success-result-error',
      status_code: 200,
      reported_error_name: 'other',
      error_code: 'none'
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('CANARY')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      code: 'SYNTHETIC-CODE-CANARY',
      bytes: 21,
      size: 'within-bound',
      label: 'other'
    },
    {
      code: 'x'.repeat(8192),
      bytes: 8192,
      size: 'within-bound',
      label: 'other'
    },
    {
      code: 'é'.repeat(4096),
      bytes: 8192,
      size: 'within-bound',
      label: 'other'
    },
    { code: 'é'.repeat(4097), bytes: null, size: 'oversized', label: 'other' },
    { code: 'x'.repeat(8193), bytes: null, size: 'oversized', label: 'other' },
    {
      code: { private: 'SYNTHETIC-NONSTRING-CANARY' },
      bytes: null,
      size: 'absent',
      label: 'none'
    }
  ])(
    'emits only a bounded category for an unrecognized code ($size, $bytes bytes)',
    async ({ code, bytes, size, label }) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code,
            message: 'SYNTHETIC-MESSAGE-CANARY',
            details: 'SYNTHETIC-DETAILS-CANARY',
            hint: 'https://synthetic.invalid/SYNTHETIC-HINT-CANARY'
          },
          { status: 400 }
        )
      )
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      renderWithTransport(transport)

      await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1))
      expect(consoleError.mock.calls[0]?.[2]).toMatchObject({
        err: '[Redacted]',
        status_code: 400,
        reported_error_name: 'other',
        error_code: label,
        error_code_bytes: bytes,
        error_code_size: size
      })
      const emitted = JSON.stringify(consoleError.mock.calls)
      expect(emitted).not.toContain('CANARY')
      expect(emitted).not.toContain('synthetic.invalid')
      expect(emitted.length).toBeLessThan(600)
      expect(transport).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['beforeunload', 'pagehide', 'unmount'])(
    'keeps %s cancellation silent through the actual SDK signal',
    async (event) => {
      let fetchSignal: AbortSignal | null | undefined
      let rejected = false
      const transport = vi
        .fn<typeof fetch>()
        .mockImplementation((_input, init) => {
          fetchSignal = init?.signal
          return new Promise((_resolve, reject) => {
            fetchSignal?.addEventListener(
              'abort',
              () => {
                rejected = true
                reject(new DOMException('SYNTHETIC-ABORT-CANARY', 'AbortError'))
              },
              { once: true }
            )
          })
        })
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const view = renderWithTransport(transport)
      await waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
      expect(fetchSignal?.aborted).toBe(false)

      await act(async () => {
        if (event === 'unmount') view.unmount()
        else window.dispatchEvent(new Event(event))
      })

      expect(fetchSignal?.aborted).toBe(true)
      expect(rejected).toBe(true)
      await waitFor(() => expect(clients[0]?.isFetching()).toBe(0))
      expect(consoleError).not.toHaveBeenCalled()
      expect(transport).toHaveBeenCalledTimes(1)
    }
  )

  it('retires navigation listeners after a completed refusal', async () => {
    let fetchSignal: AbortSignal | null | undefined
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_input, init) => {
        fetchSignal = init?.signal
        return Response.json(
          { code: '42501', message: 'synthetic refusal' },
          { status: 403 }
        )
      })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithTransport(transport)
    await waitFor(() =>
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    )
    expect(consoleError).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('beforeunload'))
    window.dispatchEvent(new Event('pagehide'))

    expect(fetchSignal?.aborted).toBe(false)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })
})

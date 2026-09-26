import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import SeasonSelector from '@/app/components/SeasonSelector'
import { useClusterContext } from '@/app/hooks/useClusterContext'

const mockSearchParams = vi.hoisted(() => ({
  value: 'season=81'
}))
const mockSeasonAbortSignal = vi.hoisted(() => vi.fn())

mockSeasonAbortSignal.mockResolvedValue({
  data: ['81', '80', '79'],
  error: null
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => ({
    rpc: vi.fn(() => ({ abortSignal: mockSeasonAbortSignal }))
  }))
}))

vi.mock('@/app/hooks/useClusterContext', () => ({
  useClusterContext: vi.fn(() => ({
    guildCode: 'TESTGUILD',
    clusterCode: 'TESTCLUSTER',
    isLoading: false
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
      isLoading: true
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { SyncStatusPanel } from '@/app/components/ui/SyncStatusPanel'
import {
  CornerDockProvider,
  useCornerDock
} from '@/app/providers/CornerDockContext'

const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastWarning = vi.fn()
let mockGuildCode = ''

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({
    toast: {
      success: mockToastSuccess,
      error: mockToastError,
      warning: mockToastWarning
    }
  })
}))

vi.mock('@/app/hooks/useClusterContext', () => ({
  useGuildCode: () => mockGuildCode
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    warn: vi.fn(),
    error: vi.fn()
  })
}))

/** `current` under 2h, `overdue` over 6h against a 1-hour cadence. */
function freshnessResponse(ageSeconds: number | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      feeds: [{ key: 'raid', ageSeconds, cadenceSeconds: 3600 }],
      guildCode: 'GUILD'
    })
  }
}

const syncFailed = {
  ok: false,
  status: 500,
  json: async () => ({ error: 'Sync failed' })
}

const syncOk = {
  ok: true,
  status: 200,
  json: async () => ({ success: true, battles_synced: 0 })
}

/** Routes by URL so the ingest feed and manual sync can disagree. */
function mockFetch(options: {
  freshness?: unknown
  sync?: unknown
}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    if (String(url).includes('/api/sync/freshness')) {
      return options.freshness ?? freshnessResponse(null)
    }
    return options.sync ?? syncFailed
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function RegisteredDockProbe() {
  const { dockActive, registerDock } = useCornerDock()

  useEffect(() => registerDock(), [registerDock])

  return <div>{dockActive ? 'dock active' : 'dock inactive'}</div>
}

async function expandPanel() {
  const sys = await screen.findByText('SYS')
  fireEvent.click(sys)
}

describe('SyncStatusPanel', () => {
  beforeEach(() => {
    mockGuildCode = ''
    mockToastError.mockClear()
    mockToastSuccess.mockClear()
    mockToastWarning.mockClear()

    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true
    })

    mockFetch({})
  })

  it('renders collapsed indicator after mount', async () => {
    render(<SyncStatusPanel />)

    expect(await screen.findByText('SYS')).toBeInTheDocument()
    expect(screen.queryByText('MACHINE SPIRIT')).toBeNull()
  })

  it('hides the floating SYS chip while a corner dock is active', async () => {
    render(
      <CornerDockProvider>
        <RegisteredDockProbe />
        <SyncStatusPanel />
      </CornerDockProvider>
    )

    expect(await screen.findByText('dock active')).toBeInTheDocument()
    expect(screen.queryByText('SYS')).toBeNull()
  })

  it('expands and triggers manual sync', async () => {
    mockGuildCode = 'GUILD'
    const fetchMock = mockFetch({})

    render(<SyncStatusPanel />)
    await expandPanel()

    const syncButton = await screen.findByTitle('Click to sync guild data')
    fireEvent.click(syncButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/guild/trigger-sync',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ guild_code: 'GUILD', use_stored_key: true })
        })
      )
    )
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
  })

  it('aborts an IN-FLIGHT freshness poll before a hard navigation', async () => {
    mockGuildCode = 'GUILD'
    const fetchMock = vi.fn(
      () => new Promise(() => {}) as unknown as Promise<Response>
    )
    global.fetch = fetchMock as unknown as typeof fetch

    render(<SyncStatusPanel />)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sync/freshness',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    const init = fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal }
    window.dispatchEvent(new Event('beforeunload'))

    expect(init.signal.aborted).toBe(true)
  })

  it('reports a stopped ingest feed even while offering a sync', async () => {
    mockGuildCode = 'GUILD'
    mockFetch({ freshness: freshnessResponse(5 * 24 * 60 * 60) })

    render(<SyncStatusPanel />)
    await expandPanel()

    expect(await screen.findByText('INGEST_STOPPED')).toBeInTheDocument()
    expect(screen.getByText('FEED_STOPPED')).toBeInTheDocument()
    expect(screen.getByText('5 days ago')).toBeInTheDocument()
  })

  it('does not let a successful button press claim the feed is healthy', async () => {
    mockGuildCode = 'GUILD'
    // A successful sync press is not evidence about ingest.
    mockFetch({
      freshness: freshnessResponse(5 * 24 * 60 * 60),
      sync: syncOk
    })

    render(<SyncStatusPanel />)
    await expandPanel()

    fireEvent.click(await screen.findByTitle('Click to sync guild data'))

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())
    expect(await screen.findByText('SYNC SUCCESSFUL')).toBeInTheDocument()
    expect(screen.getByText('INGEST_STOPPED')).toBeInTheDocument()
    expect(screen.getByText('FEED_STOPPED')).toBeInTheDocument()
  })

  it('never claims API degradation the way the old panel did on a healthy feed', async () => {
    mockGuildCode = 'GUILD'
    mockFetch({ freshness: freshnessResponse(120) })

    render(<SyncStatusPanel />)
    await expandPanel()

    expect(await screen.findByText('INGEST_OK')).toBeInTheDocument()
    expect(screen.getByText('OPERATIONAL')).toBeInTheDocument()
    expect(screen.queryByText(/^API_/)).toBeNull()
  })

  it('surfaces a failed manual sync without touching the ingest verdict', async () => {
    mockGuildCode = 'GUILD'
    mockFetch({ freshness: freshnessResponse(120), sync: syncFailed })

    render(<SyncStatusPanel />)
    await expandPanel()

    fireEvent.click(await screen.findByTitle('Click to sync guild data'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(await screen.findByText('SYNC_FAILED')).toBeInTheDocument()
    expect(screen.getByText('INGEST_OK')).toBeInTheDocument()
    expect(screen.queryByText('SYNC SUCCESSFUL')).toBeNull()
  })
})

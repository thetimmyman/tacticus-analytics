import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within
} from '@testing-library/react'
import GRAvailability from '@/app/components/GRAvailability'

const createJsonResponse = (
  data: unknown,
  ok = true,
  status = ok ? 200 : 400
) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'Bad Request',
  headers: {
    get: (key: string) =>
      key.toLowerCase() === 'content-type' ? 'application/json' : null
  },
  json: async () => data,
  text: async () => JSON.stringify(data)
})

vi.mock('@tacticus/ui-kit', () => ({
  DataTable: ({
    rows,
    columns
  }: {
    rows: any[]
    columns: Array<{ key: string; render: (row: any) => ReactNode }>
  }) => (
    <table data-testid="data-table">
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column.key}>{column.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  Card: ({ children }: { children: ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    ...props
  }: {
    children: ReactNode
    [key: string]: unknown
  }) => <button {...props}>{children}</button>,
  ConnectionStatus: ({ status }: { status: string }) => (
    <span data-testid={`connection-${status}`} />
  ),
  StatusDot: ({ status }: { status: string }) => (
    <span data-testid={`status-dot-${status}`} />
  ),
  StatusLabel: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  Skeleton: () => <div data-testid="skeleton" />
}))

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null })
  })
}))

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
    }
  })
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('GRAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an error when guild code is missing', async () => {
    global.fetch = vi.fn(async () =>
      createJsonResponse({ hasApiKey: false })
    ) as any

    render(<GRAvailability guildCode="" season="12" />)

    expect(
      await screen.findByText(
        'Guild code is required to load availability data'
      )
    ).toBeInTheDocument()
  })

  it('shows the curated officer/leader guidance on a 403 AppError envelope (pin)', async () => {
    // The fallback ladder relies on the withErrorHandler envelope.
    global.fetch = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.startsWith('/api/guild-tokens?')) {
        return createJsonResponse(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Insufficient permissions',
              statusCode: 403
            }
          },
          false,
          403
        )
      }
      return createJsonResponse({})
    }) as any

    render(<GRAvailability guildCode="EOT" season="12" />)

    expect(
      await screen.findByText(/You need officer or leader permissions/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Insufficient permissions/)
    ).not.toBeInTheDocument()
  })

  it('renders player availability summary and details', async () => {
    const players = [
      {
        player_id: 'p1',
        display_name: 'Alice',
        tokens_available: 3,
        bombs_available: 1,
        api_key_is_valid: true,
        data_source: 'live',
        token_cooldown: null,
        bomb_cooldown: null,
        time_to_next_token: 3600,
        last_sync_at: '2024-01-01T00:00:00Z',
        last_battle_time: '2024-01-02T00:00:00Z',
        battles_with_damage: 2
      },
      {
        player_id: 'p2',
        display_name: 'Bob',
        tokens_available: 1,
        bombs_available: 0,
        api_key_is_valid: true,
        data_source: 'mystery',
        token_cooldown: null,
        bomb_cooldown: '1h',
        time_to_next_token: 3600,
        last_battle_time: null,
        battles_with_damage: 0
      }
    ]

    global.fetch = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.startsWith('/api/guild-tokens?')) {
        return createJsonResponse({ players, summary: {} })
      }
      if (url === '/api/player-api-key') {
        return createJsonResponse({ hasApiKey: false })
      }
      if (url === '/api/guild-tokens/sync') {
        return createJsonResponse({
          message: 'Guild sync completed',
          failedCount: 0
        })
      }
      return createJsonResponse({})
    }) as any

    render(<GRAvailability guildCode="ABCD" season="12" />)

    expect(
      await screen.findByText('Guild Raid Availability')
    ).toBeInTheDocument()
    const detailsToggle = await screen.findByText('Show Details')

    // The header renders during loading, so wait for a data-dependent control.
    expect(await screen.findByText('Show Details')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show Details'))

    const table = screen.getByTestId('data-table')
    expect(table).toBeInTheDocument()
    expect(within(table).getByText('Alice')).toBeInTheDocument()
    expect(within(table).getByText('Bob')).toBeInTheDocument()
    expect(within(table).getAllByText('1h').length).toBeGreaterThan(0)
    expect(screen.getByTestId('status-dot-warning')).toBeInTheDocument()
    expect(screen.getByTestId('connection-connected')).toBeInTheDocument()
    expect(screen.getByTestId('connection-disconnected')).toBeInTheDocument()

    fireEvent.click(screen.getByText('How Token Tracking Works'))
    expect(
      screen.getByText(/Tokens regenerate 1 every 12 hours/)
    ).toBeInTheDocument()

    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.some(([input]) =>
          String(input).startsWith('/api/guild-tokens?')
        )
    ).toBe(true)
  })

  it('uses seeded token rows without repeating the initial guild-token fetch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.startsWith('/api/guild-tokens?')) {
        throw new Error(`Unexpected guild-token fetch: ${url}`)
      }
      if (url === '/api/player-api-key') {
        return createJsonResponse({ hasApiKey: false })
      }
      return createJsonResponse({})
    })
    global.fetch = fetchMock as any

    render(
      <GRAvailability
        guildCode="ABCD"
        season="12"
        initialTokenRows={[
          {
            player_id: 'p1',
            display_name: 'Seeded Alice',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            bomb_next_in_seconds: null,
            api_key_is_valid: true,
            data_source: 'live',
            token_cooldown: '1h',
            bomb_cooldown: null,
            last_sync_at: '2024-01-01T00:00:00Z',
            last_battle_time: '2024-01-02T00:00:00Z',
            battles_with_damage: 3
          }
        ]}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Guild Raid Availability')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('/api/player-api-key')
    })

    fireEvent.click(screen.getByText('Show Details'))

    expect(
      within(screen.getByTestId('data-table')).getByText('Seeded Alice')
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith('/api/guild-tokens?')
      )
    ).toBe(false)
  })

  it('applies refreshed seeded token rows for the same guild and season', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.startsWith('/api/guild-tokens?')) {
        throw new Error(`Unexpected guild-token fetch: ${url}`)
      }
      if (url === '/api/player-api-key') {
        return createJsonResponse({ hasApiKey: false })
      }
      return createJsonResponse({})
    })
    global.fetch = fetchMock as any

    const initialRow = {
      player_id: 'p1',
      display_name: 'Seeded Alice',
      tokens_available: 1,
      token_next_in_seconds: 3600,
      bombs_available: 1,
      bomb_next_in_seconds: null,
      api_key_is_valid: true,
      data_source: 'live',
      token_cooldown: '1h',
      bomb_cooldown: null,
      last_sync_at: '2024-01-01T00:00:00Z',
      last_battle_time: '2024-01-02T00:00:00Z',
      battles_with_damage: 3
    }

    const { rerender } = render(
      <GRAvailability
        guildCode="ABCD"
        season="12"
        initialTokenRows={[initialRow]}
      />
    )

    fireEvent.click(await screen.findByText('Show Details'))
    expect(
      within(screen.getByTestId('data-table')).getByText('Seeded Alice')
    ).toBeInTheDocument()

    rerender(
      <GRAvailability
        guildCode="ABCD"
        season="12"
        initialTokenRows={[
          {
            ...initialRow,
            display_name: 'Fresh Alice',
            tokens_available: 3,
            token_cooldown: null
          }
        ]}
      />
    )

    await waitFor(() => {
      expect(
        within(screen.getByTestId('data-table')).getByText('Fresh Alice')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Seeded Alice')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith('/api/guild-tokens?')
      )
    ).toBe(false)
  })

  it('copies the full-details export to the clipboard from the Copy dropdown (extraction pin)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.startsWith('/api/guild-tokens?')) {
        throw new Error(`Unexpected guild-token fetch: ${url}`)
      }
      if (url === '/api/player-api-key') {
        return createJsonResponse({ hasApiKey: false })
      }
      return createJsonResponse({})
    })
    global.fetch = fetchMock as any

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } })

    try {
      render(
        <GRAvailability
          guildCode="ABCD"
          season="12"
          initialTokenRows={[
            {
              player_id: 'p1',
              display_name: 'Seeded Alice',
              tokens_available: 2,
              token_next_in_seconds: 3600,
              bombs_available: 1,
              bomb_next_in_seconds: null,
              api_key_is_valid: true,
              data_source: 'live',
              token_cooldown: '1h',
              bomb_cooldown: null,
              last_sync_at: '2024-01-01T00:00:00Z',
              last_battle_time: '2024-01-02T00:00:00Z',
              battles_with_damage: 3
            }
          ]}
        />
      )

      fireEvent.click(await screen.findByText('Show Details'))
      fireEvent.click(screen.getByText('Copy'))
      fireEvent.click(screen.getByText('Full Details'))

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledTimes(1)
      })
      const copied = writeTextMock.mock.calls[0][0] as string
      expect(copied).toContain('**GR Availability - S12**')
      expect(copied).toContain('Seeded Alice')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

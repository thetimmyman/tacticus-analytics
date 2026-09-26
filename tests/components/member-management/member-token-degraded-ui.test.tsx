import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemberData } from '@/app/(dashboard)/guild-management/members/components/hooks/useMemberData'
import { MemberAvailabilitySummary } from '@/app/(dashboard)/guild-management/members/components/MemberAvailabilitySummary'
import { MemberListTable } from '@/app/(dashboard)/guild-management/members/components/MemberListTable'
import type { ExtendedMember } from '@/app/(dashboard)/guild-management/members/components/types'

const mockFrom = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({
    from: mockFrom
  })
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}))

vi.mock('@tacticus/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tacticus/ui-kit')>()),
  Button: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    [key: string]: unknown
  }) => <button {...props}>{children}</button>
}))

vi.mock('@tacticus/ui-kit/radix-dropdown', () => ({
  RadixDropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RadixDropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  RadixDropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RadixDropdownMenuItem: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    [key: string]: unknown
  }) => <button {...props}>{children}</button>,
  RadixDropdownMenuSeparator: () => <hr />,
  RadixDropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@tacticus/ui-kit/radix-tooltip', () => ({
  RadixTooltip: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RadixTooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  RadixTooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RadixTooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

const member = {
  player_id: 'player-1',
  display_name: 'Alice',
  role: 'member',
  guild_code: 'TEST',
  user_id: null,
  api_key_is_valid: true,
  tacticus_api_key_encrypted: 'encrypted-key'
} as ExtendedMember

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('member token degraded UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'boss_mapping') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes non-OK token usage responses as tokenDataError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/members/token-usage?')) {
          return {
            ok: false,
            json: async () => ({
              error: { message: 'Token usage data temporarily unavailable' }
            })
          }
        }
        if (url.startsWith('/api/members/boss-performance?')) {
          return {
            ok: true,
            json: async () => ({})
          }
        }
        throw new Error(`Unexpected fetch: ${url}`)
      })
    )

    const { result } = renderHook(
      () =>
        useMemberData({
          userGuildCode: 'TEST',
          selectedSeason: '45'
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(result.current.tokenDataError).toBe(
        'Token usage data temporarily unavailable'
      )
    )
    expect(result.current.tokenData).toEqual({})
  })

  it('renders a retryable summary alert for token-data failures', () => {
    const retry = vi.fn()

    render(
      <MemberAvailabilitySummary
        members={[member]}
        tokenData={{}}
        selectedSeason="45"
        tokenDataError="Token usage data temporarily unavailable"
        onRetryTokenData={retry}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Token availability is temporarily unavailable'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('shows token cells as unavailable instead of no-battle empty data', () => {
    render(
      <MemberListTable
        members={[member]}
        tokenData={{}}
        tokenDataError="Token usage data temporarily unavailable"
        bossPerformanceData={{}}
        metaTeams={[]}
        selectedSeason="45"
        sortConfig={{ column: 'player', direction: 'asc' }}
        onSort={vi.fn()}
        onOpenAction={vi.fn()}
        canEditMember={() => false}
      />
    )

    expect(
      screen.getAllByText('Availability unavailable').length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Token data service error').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText('No battles this season')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BattleLog from '@/app/components/BattleLog'

const mockHeroCatalog = vi.hoisted(() => ({
  getById: vi.fn(() => null)
}))

const mockBossCatalog = vi.hoisted(() => ({
  getByName: vi.fn(() => null)
}))

const mockSupabase = vi.hoisted(() => {
  const battleEntries: unknown[] = []
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = []

  const resolveTableData = (table: string) => {
    if (table === 'EOT_GR_data') {
      return {
        data: battleEntries,
        error: null,
        count: battleEntries.length
      }
    }
    if (table === 'player_mapping') {
      return { data: [], error: null }
    }
    if (table === 'player_avatar_frames') {
      return { data: [], error: null }
    }
    if (table === 'meta_teams') {
      return { data: [], error: null }
    }
    return { data: [], error: null }
  }

  const createQueryBuilder = (table: string) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        eqCalls.push({ table, column, value })
        return builder
      }),
      in: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lt: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(() =>
        Promise.resolve({
          data: battleEntries,
          error: null,
          count: battleEntries.length
        })
      ),
      single: vi.fn(() =>
        Promise.resolve({
          data:
            table === 'guild_config' ? { cluster_code: 'TESTCLUSTER' } : null,
          error: null
        })
      )
    } as {
      select: () => unknown
      eq: (column: string, value: unknown) => unknown
      in: () => unknown
      gt: () => unknown
      gte: () => unknown
      lt: () => unknown
      or: () => unknown
      order: () => unknown
      range: () => Promise<unknown>
      single: () => Promise<unknown>
      then?: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise<unknown>
    }

    builder.then = (onFulfilled, onRejected) =>
      Promise.resolve(resolveTableData(table)).then(onFulfilled, onRejected)

    return builder
  }

  const from = vi.fn((table: string) => createQueryBuilder(table))
  const rpc = vi.fn((funcName: string) => {
    if (funcName === 'get_guild_boss_averages') {
      return Promise.resolve({ data: [], error: null })
    }
    if (funcName === 'get_cluster_boss_averages') {
      return Promise.resolve({ data: [], error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })

  return { from, rpc, battleEntries, eqCalls }
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => mockSupabase)
}))

vi.mock('@/app/lib/catalogs/rarity-set', () => ({
  getBossLevelFromSetAndRarity: vi.fn(() => 'L4')
}))

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ bossName }: { bossName: string }) => <span>{bossName}</span>
}))

vi.mock('@/app/lib/utils/avatar', () => ({
  buildAvatarFrameMap: vi.fn(() => new Map()),
  getDatamineAvatarUrl: vi.fn(() => '/avatar.png'),
  getUserAvatar: vi.fn(() => '/user-avatar.png'),
  resolveAvatarIconUrl: vi.fn(() => null)
}))

vi.mock('@tacticus/app-core', () => ({
  formatDamage: vi.fn((v) => `${(v / 1000000).toFixed(1)}M`),
  getRarityPrefix: vi.fn((r) => r.charAt(0)),
  normalizeRarity: vi.fn((r) => r),
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/app/components/MultipleCategoryBadges', () => ({
  default: () => <div data-testid="category-badges" />
}))

vi.mock('@tacticus/ui-kit', () => ({
  EmptyState: ({
    title,
    description
  }: {
    title: string
    description: string
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  ),
  TableSkeleton: () => <div data-testid="table-skeleton" />
}))

vi.mock('@/app/lib/catalogs', () => ({
  useBossCatalog: vi.fn(() => ({ data: mockBossCatalog })),
  useHeroCatalog: vi.fn(() => ({ data: mockHeroCatalog })),
  loadHeroCatalog: vi.fn(() => Promise.resolve(mockHeroCatalog))
}))

vi.mock('@/app/lib/utils/damage-comparison', () => ({
  calculateDamagePercentage: vi.fn(() => 0),
  formatDamagePercentage: vi.fn(() => '0%'),
  getDamagePercentageColor: vi.fn(() => 'text-green-500')
}))

const killingBlowEntry = {
  id: 'entry-1',
  displayName: 'RenamedPlayer',
  Name: 'Szarekh',
  damageDealt: 12000000,
  damageType: 'Battle',
  tier: 1,
  set: 0,
  rarity: 'Legendary',
  loopIndex: 0,
  completedOn: '2026-01-01T12:00:00Z',
  remainingHp: 0,
  maxHp: 50000000,
  encounterId: 0
}

describe('BattleLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.battleEntries.length = 0
    mockSupabase.eqCalls.length = 0
  })

  it('renders loading state initially', () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)
    expect(screen.getByText('Loading battle log...')).toBeInTheDocument()
  })

  it('renders empty state when no entries', async () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(
        screen.getByText('Try adjusting your search or filters')
      ).toBeInTheDocument()
    })
  })

  it('renders filter buttons', async () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByText('Bosses')).toBeInTheDocument()
      expect(screen.getByText('Prime 1')).toBeInTheDocument()
      expect(screen.getByText('Prime 2')).toBeInTheDocument()
    })
  })

  it('toggles show type filter', async () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      const bossesButton = screen.getByText('Bosses')
      fireEvent.click(bossesButton)
    })

    expect(screen.getByText('Bosses')).toBeInTheDocument()
  })

  it('handles search input', async () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText(/search/i)
      fireEvent.change(searchInput, { target: { value: 'TestPlayer' } })
    })
  })

  it('handles damage filter change', async () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument()
    })
  })

  it('renders with different guild codes', async () => {
    const { rerender } = render(
      <BattleLog selectedGuild="GUILD1" selectedSeason="81" />
    )

    await waitFor(() => {
      expect(
        screen.getByText('Try adjusting your search or filters')
      ).toBeInTheDocument()
    })

    rerender(<BattleLog selectedGuild="GUILD2" selectedSeason="81" />)

    await waitFor(() => {
      expect(
        screen.getByText('Try adjusting your search or filters')
      ).toBeInTheDocument()
    })
  })

  it('renders with different seasons', async () => {
    const { rerender } = render(
      <BattleLog selectedGuild="TESTGUILD" selectedSeason="80" />
    )

    await waitFor(() => {
      expect(
        screen.getByText('Try adjusting your search or filters')
      ).toBeInTheDocument()
    })

    rerender(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(
        screen.getByText('Try adjusting your search or filters')
      ).toBeInTheDocument()
    })
  })

  it('restricts the avatar lookup to current player_mapping rows', async () => {
    mockSupabase.battleEntries.push(killingBlowEntry)

    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(
        mockSupabase.eqCalls.filter((call) => call.table === 'player_mapping')
      ).toEqual([
        { table: 'player_mapping', column: 'guild_code', value: 'TESTGUILD' },
        { table: 'player_mapping', column: 'is_current', value: true }
      ])
    })
  })

  it('renders entries through the shared battle-log row treatment', async () => {
    mockSupabase.battleEntries.push(killingBlowEntry)

    const { container } = render(
      <BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />
    )

    await waitFor(() => {
      expect(container.querySelector('.border-red-600')).not.toBeNull()
    })

    const row = container.querySelector('.border-red-600') as HTMLElement
    expect(row).toHaveClass('bg-red-900/30')
    expect(row).toHaveClass('hover:border-red-500')
    expect(row.querySelectorAll('.text-red-400').length).toBeGreaterThan(0)
  })

  it('keeps the desktop grid reachable through group-level horizontal scrolling', async () => {
    mockSupabase.battleEntries.push(killingBlowEntry)

    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    const scrollRegion = await screen.findByTestId('battle-log-group-scroll')
    expect(scrollRegion).toHaveClass('overflow-x-auto')
    expect(scrollRegion.firstElementChild).toHaveClass('sm:min-w-[1020px]')
  })

  it('handles killing blows filter toggle', async () => {
    render(<BattleLog selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      const killingBlowsToggle = screen.queryByRole('checkbox')
      if (killingBlowsToggle) {
        fireEvent.click(killingBlowsToggle)
      }
    })
  })
})

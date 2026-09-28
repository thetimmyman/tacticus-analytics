import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlayerBattleLog from '@/app/components/PlayerBattleLog'

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                ilike: vi.fn(() => ({
                  order: vi.fn(() => ({
                    range: vi.fn(() =>
                      Promise.resolve({ data: [], error: null })
                    )
                  }))
                })),
                order: vi.fn(() => ({
                  range: vi.fn(() => Promise.resolve({ data: [], error: null }))
                }))
              })),
              ilike: vi.fn(() => ({
                order: vi.fn(() => ({
                  range: vi.fn(() => Promise.resolve({ data: [], error: null }))
                }))
              })),
              order: vi.fn(() => ({
                range: vi.fn(() => Promise.resolve({ data: [], error: null }))
              }))
            })),
            in: vi.fn(() => Promise.resolve({ data: [], error: null }))
          }))
        }))
      }))
    })),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null }))
  }))
}))

vi.mock('@/app/hooks/useClusterContext', () => ({
  useClusterContext: vi.fn(() => ({
    clusterCode: 'TEST-CLUSTER',
    isLoading: true
  }))
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
  TableSkeleton: () => <div data-testid="table-skeleton">Loading...</div>
}))

vi.mock('@/app/components/MultipleCategoryBadges', () => ({
  default: ({ categories }: { categories: string[] }) => (
    <div data-testid="category-badges">{categories.join(', ')}</div>
  )
}))

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@tacticus/app-core', () => ({
  formatDamage: (val: number) => val.toLocaleString(),
  logger: { error: vi.fn() }
}))

vi.mock('@/app/lib/catalogs/rarity-set', () => ({
  getBossLevelFromSetAndRarity: (set: number, rarity: string) => `L${set}`
}))

vi.mock('@/app/lib/utils/damage-comparison', () => ({
  calculateDamagePercentage: () => 100,
  formatDamagePercentage: () => '100%',
  getDamagePercentageColor: () => 'text-green-400'
}))

describe('PlayerBattleLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    expect(screen.getByText('Loading battle log...')).toBeInTheDocument()
  })

  it('renders with player name in heading', async () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    expect(screen.getByText("TestPlayer's Battle Log")).toBeInTheDocument()
  })

  it('renders search input', () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    expect(
      screen.getByPlaceholderText('Search boss names...')
    ).toBeInTheDocument()
  })

  it('renders filter buttons', () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Battles/i })).toBeInTheDocument()
  })

  it('changes filter when button clicked', async () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    const battlesButton = screen.getByRole('button', { name: /Battles/i })
    fireEvent.click(battlesButton)

    await waitFor(() => {
      expect(battlesButton).toHaveClass('bg-primary-wh40k')
    })
  })

  it('renders page size selector', () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    expect(screen.getByText('Per page:')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders with showAllGuilds heading', () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        showAllGuilds={true}
      />
    )

    expect(screen.getByText('Complete Battle Log')).toBeInTheDocument()
  })

  it('accepts legacy guild/season props', () => {
    render(
      <PlayerBattleLog guild="LEGACY" season="S2" playerName="LegacyPlayer" />
    )

    expect(screen.getByText("LegacyPlayer's Battle Log")).toBeInTheDocument()
  })

  it('handles search input changes', async () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    const searchInput = screen.getByPlaceholderText('Search boss names...')
    fireEvent.change(searchInput, { target: { value: 'Mortarion' } })

    expect(searchInput).toHaveValue('Mortarion')
  })

  it('handles page size change', async () => {
    render(
      <PlayerBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        playerName="TestPlayer"
      />
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '50' } })

    expect(select).toHaveValue('50')
  })
})

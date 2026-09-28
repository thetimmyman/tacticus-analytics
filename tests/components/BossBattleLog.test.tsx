import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BossBattleLog from '@/app/components/BossBattleLog'

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                gt: vi.fn(() => ({
                  order: vi.fn(() => ({
                    order: vi.fn(() => ({
                      range: vi.fn(() =>
                        Promise.resolve({ data: [], error: null })
                      )
                    }))
                  }))
                })),
                order: vi.fn(() => ({
                  order: vi.fn(() => ({
                    range: vi.fn(() =>
                      Promise.resolve({ data: [], error: null })
                    )
                  }))
                }))
              })),
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
              in: vi.fn(() => Promise.resolve({ data: [], error: null })),
              single: vi.fn(() =>
                Promise.resolve({ data: { cluster_code: 'TEST' }, error: null })
              )
            }))
          }))
        }))
      }))
    })),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null }))
  }))
}))

vi.mock('@/app/lib/catalogs/rarity-set', () => ({
  parseLevelString: (level: string) => {
    const match = level.match(/([LM])(\d)/)
    if (!match) return null
    return {
      rarity: match[1] === 'L' ? 'Legendary' : 'Mythic',
      set: parseInt(match[2])
    }
  }
}))

vi.mock('@tacticus/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tacticus/ui-kit')>()),
  MechanicusEmptyState: ({
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

vi.mock('@/app/lib/utils/damage-comparison', () => ({
  calculateDamagePercentage: () => 100,
  formatDamagePercentage: () => '100%',
  getDamagePercentageColor: () => 'text-green-400'
}))

describe('BossBattleLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    expect(screen.getByText('Loading battle history...')).toBeInTheDocument()
  })

  it('renders heading with level and boss name', () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    expect(
      screen.getByText('Battle History - L1 Mortarion')
    ).toBeInTheDocument()
  })

  it('renders filter buttons', () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bosses' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Primes' })).toBeInTheDocument()
  })

  it('changes filter when clicking Bosses button', async () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    const bossesButton = screen.getByRole('button', { name: 'Bosses' })
    fireEvent.click(bossesButton)

    await waitFor(() => {
      expect(bossesButton).toHaveClass('bg-primary-wh40k')
    })
  })

  it('changes filter when clicking Primes button', async () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    const primesButton = screen.getByRole('button', { name: 'Primes' })
    fireEvent.click(primesButton)

    await waitFor(() => {
      expect(primesButton).toHaveClass('bg-accent-wh40k')
    })
  })

  it('renders page size selector', () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    expect(screen.getByText('Per page:')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('handles page size change', async () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName="Mortarion"
      />
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '50' } })

    expect(select).toHaveValue('50')
  })

  it('renders with different level formats', () => {
    const { rerender } = render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="M2"
        bossName="Abaddon"
      />
    )

    expect(screen.getByText('Battle History - M2 Abaddon')).toBeInTheDocument()

    rerender(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L3"
        bossName="Ghazghkull"
      />
    )

    expect(
      screen.getByText('Battle History - L3 Ghazghkull')
    ).toBeInTheDocument()
  })

  it('renders empty boss name gracefully', () => {
    render(
      <BossBattleLog
        selectedGuild="TEST"
        selectedSeason="S1"
        level="L1"
        bossName=""
      />
    )

    expect(screen.getByText(/Battle History - L1/)).toBeInTheDocument()
  })
})

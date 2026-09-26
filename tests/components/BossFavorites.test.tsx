import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import BossFavorites from '@/app/components/BossFavorites'

const mockBossMappings = [
  { id: 1, boss_type: 'Mortarion', encounter_index: 0, boss_name: 'Mortarion' },
  { id: 2, boss_type: 'Mortarion', encounter_index: 1, boss_name: 'Typhus' },
  { id: 3, boss_type: 'Abaddon', encounter_index: 0, boss_name: 'Abaddon' },
  // The collapse prefix would fold the prime onto "Belisarius Cawl"; it must render its own name.
  {
    id: 4,
    boss_type: 'BelisariusRW',
    encounter_index: 1,
    boss_name: 'Belisarius Prime'
  }
]

const mockPlayerPreferences = {
  boss_preferences: {
    main_Mortarion: 'preferred',
    side_Typhus: 'avoid'
  }
}

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'boss_mapping') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() =>
              Promise.resolve({ data: mockBossMappings, error: null })
            )
          }))
        }
      }
      if (table === 'player_mapping') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: mockPlayerPreferences,
                      error: null
                    })
                  )
                }))
              }))
            }))
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null }))
              }))
            }))
          }))
        }
      }
      return {
        select: vi.fn(() => Promise.resolve({ data: [], error: null }))
      }
    })
  }))
}))

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('BossFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    render(<BossFavorites playerId="player1" guildCode="TEST" />)

    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders with required props', () => {
    render(<BossFavorites playerId="player1" guildCode="TEST" />)

    expect(document.querySelector('.card-wh40k')).toBeInTheDocument()
  })

  it('accepts currentPreferences prop', () => {
    const prefs = { main_Abaddon: 'preferred' }
    render(
      <BossFavorites
        playerId="player1"
        guildCode="TEST"
        currentPreferences={prefs}
      />
    )

    expect(document.querySelector('.card-wh40k')).toBeInTheDocument()
  })

  it('accepts onUpdate callback', () => {
    const onUpdate = vi.fn()
    render(
      <BossFavorites playerId="player1" guildCode="TEST" onUpdate={onUpdate} />
    )

    expect(document.querySelector('.card-wh40k')).toBeInTheDocument()
  })

  it('renders skeleton while loading', () => {
    render(<BossFavorites playerId="player1" guildCode="TEST" />)

    const pulseElements = document.querySelectorAll('.animate-pulse')
    expect(pulseElements.length).toBeGreaterThan(0)
  })

  it('handles empty playerId', () => {
    render(<BossFavorites playerId="" guildCode="TEST" />)

    expect(document.querySelector('.card-wh40k')).toBeInTheDocument()
  })

  it('handles empty guildCode', () => {
    render(<BossFavorites playerId="player1" guildCode="" />)

    expect(document.querySelector('.card-wh40k')).toBeInTheDocument()
  })

  it('accepts empty preferences object', () => {
    render(
      <BossFavorites
        playerId="player1"
        guildCode="TEST"
        currentPreferences={{}}
      />
    )

    expect(document.querySelector('.card-wh40k')).toBeInTheDocument()
  })

  it('resolves a raw main boss_type to its curated name and does not collapse a prime name onto its main', async () => {
    render(<BossFavorites playerId="player1" guildCode="TEST" />)

    expect(await screen.findByText('Belisarius Cawl')).toBeInTheDocument()

    expect(screen.getByText('Belisarius Prime')).toBeInTheDocument()

    expect(screen.queryByText('BelisariusRW')).not.toBeInTheDocument()
  })
})

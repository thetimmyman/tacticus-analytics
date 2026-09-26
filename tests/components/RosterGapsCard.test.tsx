import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RosterGapsCard } from '@/app/components/playerstats/RosterGapsCard'

const mockSupabase = vi.hoisted(() => {
  const builder: {
    select: () => typeof builder
    not: () => Promise<{ data: unknown[] }>
  } = {
    select: vi.fn(() => builder),
    not: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            unit_id: 'alpha',
            display_name: 'Alpha',
            web_icon_url: '/alpha.png'
          }
        ]
      })
    )
  }
  return { from: vi.fn(() => builder) }
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => mockSupabase)
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

describe('RosterGapsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when there are no roster gaps', async () => {
    const { container } = render(<RosterGapsCard rosterGaps={[]} />)
    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalled()
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders hero cards and summary when roster gaps exceed six', async () => {
    const rosterGaps = [
      {
        hero_name: 'Alpha',
        appears_in_meta_teams: 3,
        damage_boost_potential: 12,
        boss_types: ['Boss A', 'Boss B', 'Boss C', 'Boss D']
      },
      {
        hero_name: 'Beta',
        appears_in_meta_teams: 2,
        damage_boost_potential: 8,
        boss_types: ['Boss E']
      },
      {
        hero_name: 'Gamma',
        appears_in_meta_teams: 1,
        damage_boost_potential: 4,
        boss_types: ['Boss F']
      },
      {
        hero_name: 'Delta',
        appears_in_meta_teams: 5,
        damage_boost_potential: 15,
        boss_types: ['Boss G']
      },
      {
        hero_name: 'Epsilon',
        appears_in_meta_teams: 2,
        damage_boost_potential: 6,
        boss_types: ['Boss H']
      },
      {
        hero_name: 'Zeta',
        appears_in_meta_teams: 1,
        damage_boost_potential: 3,
        boss_types: ['Boss I']
      },
      {
        hero_name: 'Eta',
        appears_in_meta_teams: 1,
        damage_boost_potential: 2,
        boss_types: ['Boss J']
      }
    ]

    render(<RosterGapsCard rosterGaps={rosterGaps} />)

    expect(await screen.findByAltText('Alpha')).toBeInTheDocument()
    expect(
      screen.getByText("Heroes You're Missing in Meta Teams")
    ).toBeInTheDocument()
    expect(
      screen.getByText('+1 more heroes appear in top meta teams')
    ).toBeInTheDocument()
  })
})

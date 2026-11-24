import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ZoneManagement from '@/app/(dashboard)/wars/_components/ZoneManagement'

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null })
      })
    })
  })
}))

vi.mock('@/app/lib/data/guild-roster', () => ({
  guildRosterQuery: () => ({
    order: () => Promise.resolve({ data: [], error: null })
  })
}))

vi.mock('@/app/(dashboard)/wars/_hooks/useWarZoneData', () => ({
  useActiveWar: () => ({ data: null }),
  useLiveZoneAssignments: () => ({
    data: [
      {
        zone_id: 'LIVE-1',
        zone_number: 1,
        zone_type: 'main',
        zone_status: 'active',
        assigned_players: [],
        war_id: 'WAR-1',
        updated_at: ''
      }
    ]
  }),
  useWarParticipation: () => ({ data: [] })
}))

vi.mock('@/app/(dashboard)/wars/_hooks/useWarLineups', () => ({
  useAvatarFrames: () => ({ data: [] })
}))

vi.mock('@/app/(dashboard)/wars/_components/BattlefieldSelectorPanel', () => ({
  default: () => <div />
}))
vi.mock('@/app/(dashboard)/wars/_components/ZonePlanningBoard', () => ({
  default: () => <div />
}))
vi.mock('@/app/(dashboard)/wars/_components/LiveVsPlannedComparison', () => ({
  default: () => <div />
}))

const ZONE = {
  zoneId: 'ZONE-1',
  zoneName: 'Zone 1',
  visualId: 'trenches',
  row: 1,
  column: 1,
  score: 1,
  canBeMoved: false,
  difficulty: 'frontline' as const,
  baseRarity: 'common' as const,
  rarityByBattlefield: {},
  recommendedPower: 1000
}

describe('ZoneManagement live layout toggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts unpressed, then presses and fills when activated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ zones: [ZONE] })
        })
      )
    )

    render(<ZoneManagement guildCode="TEST1" userRole="leader" />)

    const toggle = await screen.findByRole('button', {
      name: /live layout/i
    })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle.className).not.toContain('bg-accent-wh40k')
    expect(toggle).toHaveAttribute(
      'title',
      'Reposition the planning grid to match live zone numbers'
    )

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle.className).toContain('bg-accent-wh40k')
  })
})

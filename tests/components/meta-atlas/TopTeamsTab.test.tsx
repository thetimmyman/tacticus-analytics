import type { HTMLAttributes, ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  BossData,
  BossRecommendation
} from '@/app/(dashboard)/meta-atlas/types'

vi.mock('@tacticus/ui-kit', () => ({
  Card: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  LoadingSpinner: () => null
}))

vi.mock('@/app/components/error/DataErrorBoundary', () => ({
  DataErrorBoundary: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@/app/components/ui/BossPortrait', () => ({
  BossPortrait: ({
    bossName,
    className
  }: {
    bossName: string
    className?: string
  }) => <div className={className}>{bossName} portrait</div>
}))

vi.mock('@/app/(dashboard)/meta-atlas/components/MetaFilterBar', () => ({
  MetaFilterBar: () => null
}))

import { TopTeamsTab } from '@/app/(dashboard)/meta-atlas/components/TopTeamsTab'

const recommendation: BossRecommendation = {
  team_hash: 'team-1',
  team_composition:
    'Hero One, Hero Two, Hero Three, Hero Four, Hero Five + War Machine',
  meta_team: "Neuro / Z'Kar",
  rarity_set: 'L1',
  sub_boss_name: null,
  encounter_index: 0,
  damage_p90: 1_250_000,
  damage_p75: 90,
  damage_max: 120,
  damage_avg: 80,
  attack_count: 142,
  season: '106'
}

const bossData: BossData = {
  boss_type: 'avatar',
  boss_name: 'Avatar',
  boss_lookup_name: 'avatar',
  rarity_set: 'L1',
  encounter_index: 0,
  recommendations: [recommendation],
  loading: false,
  error: null
}

function renderTab() {
  return render(
    <TopTeamsTab
      filters={null}
      filtersLoading={false}
      recsLoading={false}
      heroMappings={
        new Map([
          [
            'Hero One',
            {
              unit_id: 'hero-one',
              display_name: 'Hero One',
              web_icon_url: '/hero-one.png'
            }
          ]
        ])
      }
      groupedByRaritySet={[
        {
          key: 'L1|avatar',
          raritySet: 'L1',
          bossName: 'Avatar',
          bossType: 'avatar',
          main: bossData,
          prime1: null,
          prime2: null
        }
      ]}
      displayBossCount={1}
      availableMetaTeams={["Neuro / Z'Kar"]}
      availableRaritySets={['L1']}
      filterControls={{
        bossFilter: '',
        onBossFilterChange: vi.fn(),
        showAllBosses: false,
        onToggleShowAll: vi.fn(),
        selectedRaritySets: new Set(['L1']),
        onToggleRaritySet: vi.fn(),
        onSelectAllRaritySets: vi.fn(),
        onClearRaritySets: vi.fn(),
        selectedMetaTeams: new Set<string>(),
        onToggleMetaTeam: vi.fn(),
        onClearMetaTeams: vi.fn(),
        displayBossCount: 1
      }}
      currentSeason="106"
    />
  )
}

describe('TopTeamsTab compact mobile rows', () => {
  it('lets portraits, compositions, and badges wrap without widening the card', () => {
    const { container } = renderTab()

    const card = container.querySelector('[data-boss-type="avatar"]')
    expect(card?.className).toContain('min-w-0')
    expect(card?.className).toContain('overflow-hidden')

    const encounter = screen.getByText('Main').parentElement
    expect(encounter?.className).toContain('min-w-0')

    const teamRow = screen.getByRole('group', {
      name: 'Top team composition'
    })
    expect(teamRow.className).toContain('min-w-0')
    expect(teamRow.className).toContain('flex-wrap')

    const portraitStrip = screen.getByAltText('Hero One').parentElement
    expect(portraitStrip?.className).toContain('min-w-0')
    expect(portraitStrip?.className).toContain('flex-wrap')
  })

  it('renders hero tiles that scale up from a 320px-safe floor', () => {
    renderTab()

    // Mapped and unmapped tiles share the size ladder, or the strip goes ragged.
    const mapped = screen.getByAltText('Hero One')
    const unmapped = screen.getByTitle('Hero Two')

    for (const tile of [mapped, unmapped]) {
      expect(tile.className).toContain('h-9 w-9')
      expect(tile.className).toContain('sm:h-10 sm:w-10')
      expect(tile.className).toContain('xl:h-12 xl:w-12')
    }
  })

  it('surfaces P90 damage and sample size on each encounter', () => {
    renderTab()

    const encounter = screen.getByText('Main').closest('div')
      ?.parentElement as HTMLElement
    expect(within(encounter).getByText('1.25M')).toBeTruthy()

    const chip = screen.getByTitle('142 attacks — High confidence')
    expect(chip.textContent).toContain('142')
  })
})

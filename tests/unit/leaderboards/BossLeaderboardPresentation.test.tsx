import type { PropsWithChildren, ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import type { HeroMapping } from '@/app/lib/utils/battle-log-helpers'
import type {
  BossLeaderboardEntry,
  BossLeaderboardTableRow,
  BossSummary
} from '@/app/(dashboard)/leaderboards/components/boss-leaderboards/model'

vi.mock('@tacticus/ui-kit', () => ({
  ClientDate: ({ date }: { date: string }) => <span>{date}</span>,
  DataTable: ({
    rows,
    columns
  }: {
    rows: BossLeaderboardTableRow[]
    columns: Array<{
      key: string
      header: ReactNode
      sortable?: boolean
      render?: (row: BossLeaderboardTableRow) => ReactNode
    }>
  }) => (
    <table data-testid="desktop-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              data-sortable={String(column.sortable ?? false)}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.rank}>
            {columns.map((column) => (
              <td key={column.key}>
                {column.render ? column.render(row) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}))

vi.mock('@tacticus/ui-kit/radix-tabs', () => ({
  RadixTabs: ({
    children,
    onValueChange
  }: PropsWithChildren<{ onValueChange: (value: string) => void }>) => (
    <div>
      <button onClick={() => onValueChange('M2')}>Choose M2</button>
      {children}
    </div>
  ),
  RadixTabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  RadixTabsTrigger: ({
    children,
    value
  }: PropsWithChildren<{ value: string }>) => (
    <button data-level={value}>{children}</button>
  )
}))

vi.mock('@/app/components/filters/RarityFilterControls', () => ({
  RarityFilterControls: ({
    onChange,
    onReset
  }: {
    onChange: (rarities: Rarity[]) => void
    onReset: () => void
  }) => (
    <div>
      <button onClick={() => onChange(['Mythic'])}>Only Mythic</button>
      <button onClick={onReset}>Reset rarities</button>
    </div>
  )
}))

vi.mock('@/app/components/ui/BossLevelWrapper', () => ({
  BossLevelBadge: ({ level }: { level: string }) => <span>{level}</span>
}))

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/app/components/MultipleCategoryBadges', () => ({
  default: ({ categories }: { categories: string[] }) => (
    <span>{categories.join(', ')}</span>
  )
}))

import { BossLeaderboardResults } from '@/app/(dashboard)/leaderboards/components/boss-leaderboards/BossLeaderboardResults'
import { BossLeaderboardsCalculationsFAQ } from '@/app/(dashboard)/leaderboards/components/boss-leaderboards/BossLeaderboardsCalculationsFAQ'
import { BossSelectionControls } from '@/app/(dashboard)/leaderboards/components/boss-leaderboards/BossSelectionControls'

afterEach(cleanup)

const selectedBoss: BossSummary = {
  Name: 'MainBoss',
  tier: 7,
  set: 0,
  rarity: 'Legendary',
  encounterId: 0
}

const entry: BossLeaderboardEntry = {
  displayName: 'Player One',
  userId: 'player-1',
  Guild: 'guild-1',
  damageDealt: 1_234_567,
  tier: 7,
  set: 0,
  loopIndex: 2,
  encounterId: 0,
  completedOn: '2026-08-01T12:00:00Z',
  heroDetails: JSON.stringify([{ unitId: 'hero-1' }]),
  machineOfWarDetails: JSON.stringify({ unitId: 'mow-1' }),
  Name: 'MainBoss',
  rarity: 'Legendary',
  categories: ['AdMech'],
  avgDamage: 1_000_000,
  avgBattleCount: 3
}

describe('boss leaderboard presentation boundaries', () => {
  it('opens and closes the calculations FAQ', async () => {
    const user = userEvent.setup()
    render(<BossLeaderboardsCalculationsFAQ />)

    expect(screen.queryByText('Boss Leaderboards Overview')).toBeNull()
    await user.click(
      screen.getByRole('button', {
        name: /How Boss Leaderboards Work - Detailed Calculations/
      })
    )
    expect(screen.getByText('Boss Leaderboards Overview')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: /How Boss Leaderboards Work - Detailed Calculations/
      })
    )
    expect(screen.queryByText('Boss Leaderboards Overview')).toBeNull()
  })

  it('forwards rarity, level, and boss selections', async () => {
    const user = userEvent.setup()
    const onRaritiesChange = vi.fn()
    const onRaritiesReset = vi.fn()
    const onBossSelect = vi.fn()
    const mythicBoss: BossSummary = {
      ...selectedBoss,
      Name: 'MythicBoss',
      rarity: 'Mythic',
      set: 1
    }
    const leftPrime: BossSummary = {
      ...selectedBoss,
      Name: 'PrimeBoss',
      encounterId: 1
    }

    render(
      <BossSelectionControls
        contextLabel="Cluster: TEST"
        season="106"
        bossCount={3}
        availableRarities={['Mythic', 'Legendary']}
        selectedRarities={['Legendary']}
        defaultRarities={['Legendary']}
        rarityCounts={{ Mythic: 1, Legendary: 2 }}
        onRaritiesChange={onRaritiesChange}
        onRaritiesReset={onRaritiesReset}
        levels={['M2', 'L1']}
        activeLevel="L1"
        bossesByLevel={{ M2: [mythicBoss], L1: [selectedBoss, leftPrime] }}
        selectedBossId="Legendary-0-0-MainBoss"
        onBossSelect={onBossSelect}
      />
    )

    expect(
      screen.getByText('Cluster: TEST | Season: 106 | Bosses Found: 3')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Only Mythic' }))
    expect(onRaritiesChange).toHaveBeenCalledWith(['Mythic'])
    await user.click(screen.getByRole('button', { name: 'Reset rarities' }))
    expect(onRaritiesReset).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Choose M2' }))
    expect(onBossSelect).toHaveBeenCalledWith('Mythic-1-0-MythicBoss')
    await user.click(screen.getByRole('button', { name: /PrimeBoss/ }))
    expect(onBossSelect).toHaveBeenCalledWith('Legendary-0-1-PrimeBoss')
  })

  it('renders mobile and desktop results and forwards rank mode changes', async () => {
    const user = userEvent.setup()
    const onRankByChange = vi.fn()
    const heroMappings = new Map<string, HeroMapping>([
      [
        'hero-1',
        {
          unit_id: 'hero-1',
          display_name: 'Hero One',
          web_icon_url: '/hero-one.png'
        }
      ]
    ])

    render(
      <BossLeaderboardResults
        activeLevel="L1"
        selectedBoss={selectedBoss}
        rankBy="max"
        onRankByChange={onRankByChange}
        loading={false}
        entries={[entry]}
        heroMappings={heroMappings}
        guildLabels={{ 'guild-1': 'Guild One' }}
        userGuild="guild-1"
      />
    )

    expect(screen.getByText(/Top 20 Damage Dealers/)).toBeInTheDocument()
    expect(screen.getAllByText('Player One')).toHaveLength(2)
    expect(screen.getAllByText('Guild One')).toHaveLength(2)
    expect(screen.getAllByAltText('Hero One')).toHaveLength(2)
    expect(screen.getByText('mow-1')).toBeInTheDocument()
    expect(screen.getByText('MoW')).toBeInTheDocument()
    expect(screen.getAllByText('AdMech')).toHaveLength(2)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      '#',
      'Player',
      'Guild',
      'Max Damage',
      'Avg Damage',
      'Category',
      'Team',
      'Level',
      'Loop',
      'Date'
    ])
    expect(headers.every((header) => header.dataset.sortable === 'false')).toBe(
      true
    )

    await user.click(screen.getByRole('button', { name: 'Avg Damage' }))
    expect(onRankByChange).toHaveBeenCalledWith('avg')
  })

  it('keeps the five-row loading skeleton boundary', () => {
    const { container } = render(
      <BossLeaderboardResults
        activeLevel="M1"
        selectedBoss={null}
        rankBy="max"
        onRankByChange={vi.fn()}
        loading
        entries={[]}
        heroMappings={new Map()}
        guildLabels={{}}
        userGuild=""
      />
    )

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5)
    expect(screen.queryByTestId('desktop-table')).toBeNull()
  })
})

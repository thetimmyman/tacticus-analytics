/** Header order, first row, Mythic/Diamond tint, and a no-sort-button tripwire. */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RecommendedTeam } from '@tacticus/app-core/meta-analysis.types'
import { RecommendedTeamsPanel } from '@/app/(dashboard)/leaderboards/meta-analysis/_components/RecommendedTeamsPanel'
import { SKELETON_ROW_IDS } from '@/app/(dashboard)/leaderboards/meta-analysis/_constants'

vi.mock('@/app/lib/resolvers/boss-identity', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/resolvers/boss-identity')>()
  return {
    ...actual,
    getBossDisplayName: (bossName: string) => bossName
  }
})

vi.mock('@/app/components/TeamCompositionDisplay', () => ({
  default: () => <div data-testid="team-composition" />
}))

function team(overrides: Partial<RecommendedTeam> = {}): RecommendedTeam {
  return {
    rarity: 'Mythic',
    set: 1,
    levelString: 'M1',
    bossName: 'HiveTyrantKronos',
    rank: 1,
    composition: {
      compositionKey: 'comp-1',
      compositionDisplay: 'comp-1',
      heroNames: [],
      heroDetails: null,
      machineOfWarDetails: null,
      battlesCount: 12,
      minDamage: 1,
      maxDamage: 2,
      avgDamage: 150000,
      medianDamage: 150000,
      standardDeviation: 0,
      coefficientOfVariation: 0,
      stabilityScore: 80,
      stabilityRank: 'High',
      playerCount: 4,
      guildCount: 2,
      playerNames: [],
      guildCodes: [],
      rarity: 'Mythic',
      set: 1,
      season: '103',
      category: 'Burst'
    },
    ...overrides
  }
}

function renderPanel(
  recommendedTeams: RecommendedTeam[],
  levelFilter = 'all',
  recommendedLoading = false,
  extra: Partial<
    Pick<Parameters<typeof RecommendedTeamsPanel>[0], 'source' | 'onRetry'>
  > = {}
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  return render(
    <QueryClientProvider client={qc}>
      <RecommendedTeamsPanel
        recommendedTeams={recommendedTeams}
        recommendedLoading={recommendedLoading}
        levelFilter={levelFilter}
        selectedMetaTeams={new Set()}
        {...extra}
      />
    </QueryClientProvider>
  )
}

describe('RecommendedTeamsPanel — desktop table', () => {
  it('renders headers in order and the first row', () => {
    renderPanel([team()])

    const table = screen.getByRole('table')
    const headerCells = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headerCells).toEqual([
      'Boss',
      'Category',
      'Team Composition',
      'Battles',
      'Avg Damage',
      'Stability',
      'Players',
      'Guilds'
    ])

    // Scoped to the table: happy-dom renders the mobile cards too, repeating the heading.
    expect(within(table).getByText('M1 HiveTyrantKronos')).toBeTruthy()
  })

  it('tints Mythic rows orange and non-Mythic rows cyan (the unblocked rowClassName hook)', () => {
    renderPanel([
      team({ bossName: 'MythicBoss', rarity: 'Mythic' }),
      team({
        bossName: 'DiamondBoss',
        rarity: 'Legendary',
        composition: { ...team().composition, compositionKey: 'comp-2' }
      })
    ])

    const table = screen.getByRole('table')
    const mythicRow = within(table).getByText('M1 MythicBoss').closest('tr')!
    const diamondRow = within(table).getByText('M1 DiamondBoss').closest('tr')!
    // Side-specific border-l-*: an all-sides colour would race the border-b separator.
    expect(mythicRow.className).toContain('border-l-orange-500')
    expect(mythicRow.className).toContain('bg-orange-900/10')
    expect(diamondRow.className).toContain('border-l-cyan-400')
    expect(diamondRow.className).toContain('bg-cyan-900/10')
  })

  it('has no sort controls — every column is static', () => {
    renderPanel([team()])
    expect(screen.queryAllByRole('button', { name: /Sort/ })).toHaveLength(0)
  })

  it('keeps canonical DataTable headers and chrome while loading', () => {
    const loaded = renderPanel([team()])
    const loadedTable = loaded.container.querySelector('table')!
    const loadedHeaders = Array.from(loadedTable.querySelectorAll('th')).map(
      (header) => header.textContent
    )
    const loadedHeaderChrome = loadedTable.querySelector('thead')!.className
    const loadedTableChrome = loadedTable.className
    loaded.unmount()

    const loading = renderPanel([], 'all', true)
    const loadingTable = loading.container.querySelector('table')!
    const loadingHeaders = Array.from(loadingTable.querySelectorAll('th')).map(
      (header) => header.textContent
    )

    expect(loadingHeaders).toEqual(loadedHeaders)
    expect(loadingTable.querySelector('thead')!.className).toBe(
      loadedHeaderChrome
    )
    expect(loadingTable.className).toBe(loadedTableChrome)
    expect(loadingTable.querySelectorAll('tbody tr')).toHaveLength(
      SKELETON_ROW_IDS.length
    )
  })

  it('renders no team data (no fallback message) when the filter matches nothing', () => {
    // DataTable always renders one placeholder row, so assert on content, not row count.
    renderPanel(
      [team({ levelString: 'M2', bossName: 'FilteredOutBoss' })],
      'M1'
    )
    const table = screen.getByRole('table')
    expect(within(table).queryByText(/FilteredOutBoss/)).toBeNull()
    expect(screen.queryByText(/No data available/)).toBeNull()
  })
})

describe('RecommendedTeamsPanel — fallback-error state', () => {
  // Both routes return 200 empty on no-data and on failure; the panel tells them apart via `source`.

  it('renders the empty state when source is meta-atlas-rpc (genuinely no data)', () => {
    renderPanel([], 'all', false, { source: 'meta-atlas-rpc' })
    expect(screen.getByText('No recommended teams found')).toBeTruthy()
    expect(screen.queryByText(/couldn.t load meta analysis/i)).toBeNull()
  })

  it('renders a distinguishable error state and retry button when source is fallback-error', () => {
    const onRetry = vi.fn()
    renderPanel([], 'all', false, { source: 'fallback-error', onRetry })

    expect(
      screen.getByText(/couldn.t load meta analysis right now\. try again\./i)
    ).toBeTruthy()
    expect(screen.queryByText('No recommended teams found')).toBeNull()

    const retryButton = screen.getByRole('button', { name: /retry/i })
    retryButton.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders a disabled-state message when source is fallback-disabled', () => {
    renderPanel([], 'all', false, { source: 'fallback-disabled' })
    expect(screen.getByText('Meta analysis is currently disabled')).toBeTruthy()
    expect(screen.queryByText('No recommended teams found')).toBeNull()
    expect(screen.queryByText(/couldn.t load meta analysis/i)).toBeNull()
  })

  it('defaults to the empty state when source is not provided (back-compat)', () => {
    renderPanel([])
    expect(screen.getByText('No recommended teams found')).toBeTruthy()
  })
})

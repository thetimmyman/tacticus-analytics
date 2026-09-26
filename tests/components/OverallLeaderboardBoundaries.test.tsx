import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { OverallLeaderboardCalculationsFAQ } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/OverallLeaderboardCalculationsFAQ'
import { OverallLeaderboardControls } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/OverallLeaderboardControls'
import { OverallLeaderboardDesktopTable } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/OverallLeaderboardDesktopTable'
import { OverallLeaderboardMobileCards } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/OverallLeaderboardMobileCards'
import { OverallLeaderboardPagination } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/OverallLeaderboardPagination'
import type {
  EnhancedPlayerStats,
  ScoringPresentation
} from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/types'
import type { UserDataContext } from '@/app/lib/utils/data-access'

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const PLAYER: EnhancedPlayerStats = {
  displayName: 'Alpha',
  Guild: 'AAA',
  userId: 'alpha-id',
  stableKey: 'alpha-key',
  totalDamage: 1_500_000,
  battleCount: 10,
  avgDamage: 150_000,
  battleDamageTotal: 1_500_000,
  bombsUsed: 2,
  bossesKilled: 3,
  allBattleCount: 12,
  allBossesKilled: 4,
  percentVsCluster: 12.5,
  currentRank: 2,
  priorSeasonRank: 5,
  rankChange: 3,
  fiveSeasonAvgRank: 4.4,
  battleWeightedPercent: 12.5,
  tokenWeightedPercent: 8,
  tokenRatioApplied: 0.96,
  performanceValue: 12.5,
  scoreRank: 1
}

const SCORING: ScoringPresentation = {
  hasAnyTokenMode: true,
  isTokenModeActive: false,
  performanceMode: 'battle-weighted',
  tokenWeightingMode: 'max',
  tokenMaxAvailable: true,
  tokenAverageAvailable: false,
  label: 'Battle Weighted',
  tableLabel: 'Battle Weighted',
  statusMessage: 'Battle efficiency vs overall cluster averages.'
}

const CONTEXT: UserDataContext = {
  clusterCode: 'C1',
  guildCode: 'AAA',
  guildLabel: 'Alpha Guild',
  hasClusterAccess: true,
  hasGuildAccess: true,
  accessLevel: 'cluster'
}

describe('OverallLeaderboard extracted presentation boundaries', () => {
  it('keeps desktop DataTable sorting controlled by the leaderboard', () => {
    const onSortChange = vi.fn()

    render(
      <OverallLeaderboardDesktopTable
        rows={[PLAYER]}
        userGuild="AAA"
        guildLabels={{ AAA: 'Alpha Guild' }}
        scoringBasisLabel="Token Weighted (Avg)"
        scoringBasisTableLabel="Tkn Wgt'd (Avg)"
        sortField="percentVsCluster"
        sortDirection="desc"
        onSortChange={onSortChange}
      />
    )

    expect(
      screen.getByRole('columnheader', { name: /Tkn Wgt'd \(Avg\)/ })
    ).toHaveAttribute('title', 'Token Weighted (Avg)')
    expect(screen.getByText('Alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Player' }))
    expect(onSortChange).toHaveBeenCalledWith({
      key: 'name',
      direction: 'desc'
    })
  })

  it('renders the mobile scoring, history, aggregate, and guild fields', () => {
    render(
      <OverallLeaderboardMobileCards
        players={[PLAYER]}
        userGuild="AAA"
        guildLabels={{ AAA: 'Alpha Guild' }}
        scoringBasisLabel="Token Weighted (Max)"
      />
    )

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Alpha Guild')).toBeInTheDocument()
    expect(screen.getByText('5-Season: #4')).toBeInTheDocument()
    expect(screen.getByText('Score (Token Weighted (Max))')).toBeInTheDocument()
    expect(screen.getByText('12 / 2')).toBeInTheDocument()
    expect(screen.getByText('Kills: 4')).toBeInTheDocument()
  })

  it('preserves both mobile and desktop pagination navigation', () => {
    function Harness() {
      const [page, setPage] = useState(4)
      return (
        <OverallLeaderboardPagination
          currentPage={page}
          totalPages={7}
          setCurrentPage={setPage}
        />
      )
    }

    render(<Harness />)

    expect(screen.getByText('Page 4 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 5 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Last' }))
    expect(screen.getByText('Page 7 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    expect(screen.getByText('Page 1 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '2' })[0]!)
    expect(screen.getByText('Page 2 of 7')).toBeInTheDocument()
  })

  it('keeps the calculations FAQ interactive and collapsed by default', () => {
    render(<OverallLeaderboardCalculationsFAQ />)

    expect(
      screen.queryByText('Performance Efficiency Algorithm')
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'How Overall Leaderboard Works - Detailed Calculations'
      })
    )
    expect(
      screen.getByText('Performance Efficiency Algorithm')
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'How Overall Leaderboard Works - Detailed Calculations'
      })
    )
    expect(
      screen.queryByText('Performance Efficiency Algorithm')
    ).not.toBeInTheDocument()
  })

  it('keeps scoring availability and guild filtering wired to callbacks', () => {
    const onScoringModeChange = vi.fn()
    const onGuildChange = vi.fn()

    render(
      <OverallLeaderboardControls
        season="106"
        context={CONTEXT}
        contextGuildLabel="Alpha Guild"
        totalPlayers={1}
        scoring={SCORING}
        searchTerm=""
        selectedGuild="all"
        uniqueGuilds={['AAA']}
        guildLabels={{ AAA: 'Alpha Guild' }}
        onScoringModeChange={onScoringModeChange}
        onSearchChange={() => {}}
        onGuildChange={onGuildChange}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Token Weighted (Avg)' })
    ).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Token Weighted (Max)' })
    )
    expect(onScoringModeChange).toHaveBeenCalledWith('token-max')

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'AAA' }
    })
    expect(onGuildChange).toHaveBeenCalledWith('AAA')
  })
})

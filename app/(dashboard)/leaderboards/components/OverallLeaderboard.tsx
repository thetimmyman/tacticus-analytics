'use client'

import { useCallback, useState } from 'react'
import { Skeleton } from '@tacticus/ui-kit/loading'
import { useDataContext } from '@/app/lib/hooks/useDataContext'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'
import { OverallLeaderboardCalculationsFAQ } from './overall-leaderboard/OverallLeaderboardCalculationsFAQ'
import { OverallLeaderboardControls } from './overall-leaderboard/OverallLeaderboardControls'
import { OverallLeaderboardDesktopTable } from './overall-leaderboard/OverallLeaderboardDesktopTable'
import { OverallLeaderboardMobileCards } from './overall-leaderboard/OverallLeaderboardMobileCards'
import { OverallLeaderboardPagination } from './overall-leaderboard/OverallLeaderboardPagination'
import type { OverallLeaderboardProps } from './overall-leaderboard/types'
import { useOverallLeaderboardData } from './overall-leaderboard/useOverallLeaderboardData'
import { useOverallLeaderboardViewModel } from './overall-leaderboard/useOverallLeaderboardViewModel'

export default function OverallLeaderboard({
  season,
  userGuild
}: OverallLeaderboardProps) {
  const { context, loading: contextLoading } = useDataContext()
  const contextGuildLabel = useGuildDisplayLabel(context.guildCode)
  const [currentPage, setCurrentPage] = useState(1)
  const resetPage = useCallback(() => setCurrentPage(1), [])
  const { players, loading, rpcTokenStats, uniqueGuilds, guildLabels } =
    useOverallLeaderboardData({
      season,
      userGuild,
      context,
      contextLoading,
      onPlayersLoaded: resetPage
    })
  const viewModel = useOverallLeaderboardViewModel({
    players,
    rpcTokenStats,
    currentPage,
    setCurrentPage
  })

  if (!contextLoading && context.accessLevel === 'none') {
    return (
      <div className="p-8 text-center">
        <div className="text-red-500 text-lg font-bold mb-2">Access Denied</div>
        <div className="text-secondary-wh40k">
          You must be a member of a guild to view the leaderboard
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <OverallLeaderboardControls
        season={season}
        context={context}
        contextGuildLabel={contextGuildLabel}
        totalPlayers={viewModel.totalPlayers}
        scoring={viewModel.scoring}
        searchTerm={viewModel.searchTerm}
        selectedGuild={viewModel.selectedGuild}
        uniqueGuilds={uniqueGuilds}
        guildLabels={guildLabels}
        onScoringModeChange={viewModel.handleScoringModeChange}
        onSearchChange={viewModel.handleSearchChange}
        onGuildChange={viewModel.handleGuildChange}
      />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ) : (
        <>
          <OverallLeaderboardMobileCards
            players={viewModel.currentPlayers}
            userGuild={userGuild}
            guildLabels={guildLabels}
            scoringBasisLabel={viewModel.scoring.label}
          />
          <OverallLeaderboardDesktopTable
            rows={viewModel.currentPlayers}
            userGuild={userGuild}
            guildLabels={guildLabels}
            scoringBasisLabel={viewModel.scoring.label}
            scoringBasisTableLabel={viewModel.scoring.tableLabel}
            sortField={viewModel.sortField}
            sortDirection={viewModel.sortDirection}
            onSortChange={viewModel.handleSortChange}
          />
          <OverallLeaderboardPagination
            currentPage={currentPage}
            totalPages={viewModel.totalPages}
            setCurrentPage={setCurrentPage}
          />
        </>
      )}

      <div className="mt-8 bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg p-6">
        <OverallLeaderboardCalculationsFAQ />
      </div>
    </div>
  )
}

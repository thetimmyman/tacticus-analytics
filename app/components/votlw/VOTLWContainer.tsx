'use client'

import { Spinner } from '@tacticus/ui-kit'

import { lazy, Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { UserRole } from '@tacticus/app-core/types'
import { useVOTLWData } from './hooks/useVOTLWData'
import VOTLWWinnerCard from './VOTLWWinnerCard'
import VOTLWRunnerUpCard from './VOTLWRunnerUpCard'
import VOTLWGuildSettingsPanel from './VOTLWGuildSettingsPanel'

const VOTLWIndividualAwards = lazy(
  () => import(/* webpackPrefetch: true */ './VOTLWIndividualAwards')
)
const VOTLWBattlefieldHonors = lazy(
  () => import(/* webpackPrefetch: true */ './VOTLWBattlefieldHonors')
)
const VOTLWLeaderboard = lazy(
  () => import(/* webpackPrefetch: true */ './VOTLWLeaderboard')
)
const VOTLWSeasonStats = lazy(
  () => import(/* webpackPrefetch: true */ './VOTLWSeasonStats')
)
const VOTLWCalculationsFAQ = lazy(
  () => import(/* webpackPrefetch: true */ './VOTLWCalculationsFAQ')
)

const Skeleton = ({ height = '400px' }: { height?: string }) => (
  <div
    className={`animate-pulse bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)]`}
    style={{ height }}
  >
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-4 h-12 w-12 text-primary" />
        <p className="text-[var(--text-secondary)]">Loading section...</p>
      </div>
    </div>
  </div>
)

const SeasonStatsSkeleton = () => (
  <div className="space-y-6">
    {/* Death Dealer & Demolition Expert Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {[1, 2].map((i) => (
        <div
          key={`skeleton-dealer-${i}`}
          className="animate-pulse bg-gradient-to-br from-black via-gray-900 to-black rounded-xl p-6 border-2 border-[var(--card-border)]"
        >
          <div className="text-center space-y-4">
            <div className="h-6 bg-[var(--card-bg)] rounded mx-auto w-48"></div>
            <div className="h-3 bg-[var(--card-bg)] rounded mx-auto w-32"></div>
            <div className="bg-black/60 rounded-lg p-4">
              <div className="h-12 bg-[var(--card-bg)] rounded mx-auto w-20 mb-2"></div>
              <div className="h-3 bg-[var(--card-bg)] rounded mx-auto w-24 mb-3"></div>
              <div className="h-8 bg-[var(--card-bg)] rounded mx-auto w-36"></div>
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* Honorable Mentions */}
    <div className="bg-gradient-to-br from-black via-amber-950/20 to-black rounded-lg border-2 border-amber-900/50 p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-amber-900/30 rounded mx-auto w-48"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={`skeleton-mention-${i}`}
              className="bg-gradient-to-br from-amber-700/20 to-amber-800/20 rounded-lg p-4 border border-amber-800/50"
            >
              <div className="space-y-3">
                <div className="h-4 bg-amber-800/50 rounded w-24 ml-auto"></div>
                <div className="h-5 bg-amber-700/50 rounded w-32"></div>
                <div className="border-t border-amber-900/30 pt-3">
                  <div className="h-8 bg-amber-700/50 rounded w-16 mb-1"></div>
                  <div className="h-3 bg-amber-800/50 rounded w-20"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
)

const LeaderboardSkeleton = () => (
  <div className="bg-gradient-to-br from-yellow-950/20 via-black to-yellow-950/20 rounded-lg border-2 border-yellow-700/30 p-6">
    <div className="animate-pulse space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <div className="h-8 bg-yellow-700/30 rounded w-48 mb-1"></div>
          <div className="h-3 bg-yellow-800/30 rounded w-32"></div>
        </div>
        <div className="h-10 bg-yellow-900/30 rounded-lg w-32"></div>
      </div>

      {/* Top 3 */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={`skeleton-top-${i}`}
            className="bg-gradient-to-br from-black/80 to-yellow-950/30 rounded-lg border-2 border-yellow-600/50 p-4"
          >
            <div className="flex justify-between items-center mb-2">
              <div className="h-5 bg-yellow-600/30 rounded w-32 ml-6"></div>
              <div className="h-6 bg-yellow-600/30 rounded w-20"></div>
            </div>
            <div className="flex gap-3">
              {[1, 2, 3, 4].map((j) => (
                <div
                  key={j}
                  className="h-6 bg-yellow-800/30 rounded w-12"
                ></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)

const IndividualAwardsSkeleton = () => (
  <div className="bg-gradient-to-br from-indigo-950/20 via-black to-purple-950/20 rounded-lg border-2 border-purple-700/30 p-6">
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-purple-700/30 rounded mx-auto w-48"></div>
      <div className="overflow-x-auto">
        <div className="min-w-full">
          {/* Table Header */}
          <div className="flex border-b border-purple-700/50 pb-2 mb-4">
            {[
              'Boss Level',
              'Gold',
              'Silver',
              'Bronze',
              'Most Damage',
              'Biggest Hit'
            ].map((label) => (
              <div
                key={label}
                aria-label={label}
                className="flex-1 h-4 bg-purple-700/30 rounded mx-1"
              ></div>
            ))}
          </div>
          {/* Table Rows */}
          {[1, 2, 3, 4].map((i) => (
            <div
              key={`skeleton-row-${i}`}
              className="flex py-3 border-b border-purple-900/20"
            >
              {[1, 2, 3, 4, 5, 6].map((j) => (
                <div
                  key={j}
                  className="flex-1 h-4 bg-purple-800/20 rounded mx-1"
                ></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
)

const BattlefieldHonorsSkeleton = () => (
  <div className="bg-gradient-to-br from-amber-950/20 via-black to-amber-950/20 rounded-lg border-2 border-amber-700/30 p-6">
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-amber-700/30 rounded mx-auto w-48"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={`skeleton-honor-${i}`}
            className="bg-gradient-to-br from-amber-700/20 to-amber-800/20 rounded-lg p-4 border border-amber-800/50"
          >
            <div className="space-y-3">
              <div className="h-4 bg-amber-800/50 rounded w-24 ml-auto"></div>
              <div className="h-5 bg-amber-700/50 rounded w-32"></div>
              <div className="border-t border-amber-900/30 pt-3">
                <div className="h-8 bg-amber-700/50 rounded w-16 mb-1"></div>
                <div className="h-3 bg-amber-800/50 rounded w-20"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)

interface VOTLWContainerProps {
  selectedGuild: string
  selectedSeason: string
  userRole?: UserRole
}

export default function VOTLWContainer({
  selectedGuild,
  selectedSeason,
  userRole = 'member'
}: VOTLWContainerProps) {
  const queryClient = useQueryClient()

  const {
    loading,
    veteran,
    runnerUp,
    playerPoints,
    setWinners,
    seasonAwards,
    offenderThreshold,
    abuserThreshold,
    applyTokenOffenderFiltering,
    error
  } = useVOTLWData(selectedGuild, selectedSeason)

  if (loading) {
    return (
      <div className="w-full py-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Spinner
              size="lg"
              className="mx-auto mb-4 h-12 w-12 text-primary"
            />
            <p className="text-[var(--text-secondary)]">
              Calculating VOTLW standings...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full py-6">
        <div className="bg-red-900/20 border border-red-600 rounded-lg p-4">
          <p className="text-red-400">Error loading VOTLW data: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full py-6 space-y-6">
      {/* Winner and Runner-up Cards - Always visible (above the fold) */}
      <div className="grid grid-cols-1 gap-6">
        <VOTLWWinnerCard veteran={veteran} />
        <VOTLWRunnerUpCard runnerUp={runnerUp} />
      </div>

      {/* Season Elite Awards - Lazy loaded */}
      <Suspense fallback={<SeasonStatsSkeleton />}>
        <VOTLWSeasonStats seasonAwards={seasonAwards} />
      </Suspense>

      {/* Player Rankings/Leaderboard - Lazy loaded */}
      <Suspense fallback={<LeaderboardSkeleton />}>
        <VOTLWLeaderboard playerPoints={playerPoints} />
      </Suspense>

      {/* Individual Awards Table - Lazy loaded */}
      <Suspense fallback={<IndividualAwardsSkeleton />}>
        <VOTLWIndividualAwards setWinners={setWinners} />
      </Suspense>

      {/* Battlefield Honors - Lazy loaded */}
      <Suspense fallback={<BattlefieldHonorsSkeleton />}>
        <VOTLWBattlefieldHonors seasonAwards={seasonAwards} />
      </Suspense>

      {/* Calculations FAQ - Lazy loaded */}
      <Suspense fallback={<Skeleton height="100px" />}>
        <VOTLWCalculationsFAQ
          offenderThreshold={offenderThreshold}
          tokenFilteringEnabled={applyTokenOffenderFiltering}
        />
      </Suspense>

      {/* Officer/Leader controls — gated inside the panel */}
      {selectedGuild && (
        <VOTLWGuildSettingsPanel
          guildCode={selectedGuild}
          userRole={userRole}
          initialApplyTokenOffenderFiltering={applyTokenOffenderFiltering}
          initialOffenderThreshold={offenderThreshold}
          initialAbuserThreshold={abuserThreshold}
          onSettingsSaved={() => {
            queryClient.invalidateQueries({
              queryKey: ['votlw-data', selectedGuild, selectedSeason]
            })
          }}
        />
      )}
    </div>
  )
}

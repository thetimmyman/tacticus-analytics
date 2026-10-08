'use client'

import { useState, useMemo, memo } from 'react'
import { logRender } from '@tacticus/app-core/performance-monitor'
import GRAvailability from '@/app/components/GRAvailability'
import {
  usePerformance,
  useAsyncPerformance,
  useMemoryMonitor
} from '@/app/hooks/usePerformance'
import {
  MechanicusEmptyState as EmptyState,
  TableSkeleton
} from '@tacticus/ui-kit/loading'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import type { Rarity } from '@/app/lib/config'

import {
  SummaryStats,
  BossDistributionChart,
  PlayerTokenChart,
  BurnedTokensChart,
  RarityDistributionChart,
  HistoricalChart,
  TokenUsageStats,
  TokenUsageCalculationsFAQ,
  CapWasteBanner,
  BombsSubTable,
  SeasonFeasibilityCard,
  useTokenUsageData,
  DEFAULT_RARITIES,
  type SortOption
} from './token-usage'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { cappedAvailable } from '@/app/lib/calculations/token-burn'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'
import { CachedTokenAvailability } from './token-usage/CachedTokenAvailability'

interface TokenUsagePageProps {
  selectedGuild: string
  selectedSeason: string
  /** Gates forecast surfaces (server-resolved `proactive_token_management` flag). */
  showForecast?: boolean
}

function TokenUsage({
  selectedGuild,
  selectedSeason,
  showForecast = false
}: TokenUsagePageProps) {
  usePerformance('TokenUsage', { threshold: 50, trackRerenders: true })
  useAsyncPerformance()
  useMemoryMonitor('TokenUsage', 70)
  const guildDisplayLabel = useGuildDisplayLabel(selectedGuild)
  const desktop = process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop'

  if (process.env.NODE_ENV === 'development') {
    logRender('TokenUsage')
  }

  const [sortBy, setSortBy] = useState<SortOption>('total')
  const [selectedRarities, setSelectedRarities] =
    useState<Rarity[]>(DEFAULT_RARITIES)
  const [view, setView] = useState<'usage' | 'forecast'>('usage')

  const normalizedGuild = useMemo(
    () => normalizeGuildIdentifier(selectedGuild),
    [selectedGuild]
  )

  const {
    players,
    bossDistribution,
    totalStats,
    forecast,
    outlook,
    availabilityRows,
    loading,
    refetch,
    error,
    computedAt
  } = useTokenUsageData({
    guildCode: normalizedGuild,
    season: selectedSeason,
    selectedRarities,
    enableForecast: showForecast
  })

  const totalBurned = useMemo(
    () =>
      players.reduce(
        (sum, p) => sum + Math.max(0, p.burnedTokensUsage ?? 0),
        0
      ),
    [players]
  )

  // Guild sum of overcapped tokens (full 12h cycles at cap); distinct from "Behind pace".
  const totalOvercapped = useMemo(
    () =>
      players.reduce((sum, p) => sum + Math.max(0, p.overcappedTokens ?? 0), 0),
    [players]
  )

  const totalTokensAvailable = useMemo(
    () =>
      players.reduce((sum, p) => sum + cappedAvailable(p.tokensAvailable), 0),
    [players]
  )

  if (loading) {
    return (
      <div className="p-6">
        <TableSkeleton rows={6} columns={6} />
      </div>
    )
  }

  if (!players || players.length === 0) {
    return (
      <EmptyState
        title={error ? 'Token usage unavailable' : 'No Token Usage Data'}
        description={
          desktop
            ? error
              ? 'Saved token data could not be read. Your stored data is preserved. Reopen the app or retry.'
              : `No saved token usage for ${guildDisplayLabel} in Season ${selectedSeason}. Import raid history through API access and sync.`
            : `We haven't collected any token usage for ${guildDisplayLabel} in Season ${selectedSeason} yet. Once members sync their data, you'll see the breakdown here.`
        }
        action={
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-sm border border-(--card-border) bg-(--card-bg) px-4 py-2 text-sm font-medium text-primary-wh40k transition hover:bg-(--bg-tertiary)"
          >
            {desktop ? 'Retry saved data' : 'Retry sync'}
          </button>
        }
      />
    )
  }

  const forecastView = showForecast && view === 'forecast'

  return (
    <div className="container-modern py-6 space-y-6">
      {desktop && error && (
        <p role="alert">
          Saved data could not be refreshed. Showing the previous saved
          calculation; retry or reopen the app.
        </p>
      )}
      {showForecast && (
        <div
          className="flex w-fit overflow-hidden rounded-lg border border-(--card-border)"
          role="tablist"
          aria-label="Token view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!forecastView}
            onClick={() => setView('usage')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              !forecastView
                ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent)'
                : 'text-secondary-wh40k hover:bg-(--bg-tertiary)'
            }`}
          >
            Usage
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={forecastView}
            onClick={() => setView('forecast')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              forecastView
                ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent)'
                : 'text-secondary-wh40k hover:bg-(--bg-tertiary)'
            }`}
          >
            Forecast
          </button>
        </div>
      )}

      {forecastView ? (
        forecast ? (
          <>
            <SeasonFeasibilityCard forecast={forecast} outlook={outlook} />
            <BombsSubTable forecast={forecast} />
            <CapWasteBanner
              forecast={forecast}
              outlook={outlook}
              guildCode={normalizedGuild}
              season={selectedSeason}
            />
          </>
        ) : (
          <EmptyState
            title="Forecast unavailable"
            description={`We couldn't build a season forecast for ${guildDisplayLabel} in Season ${selectedSeason} yet. It appears once members have synced recent token activity.`}
          />
        )
      ) : (
        <>
          <SummaryStats
            totalStats={totalStats}
            totalTokensAvailable={totalTokensAvailable}
            totalBurned={totalBurned}
            totalOvercapped={totalOvercapped}
            players={players}
            showBurned
          />

          <div className="bg-gray-800/50 backdrop-blur-xs rounded-lg p-4">
            <RarityFilterControls
              selectedRarities={selectedRarities}
              defaultRarities={DEFAULT_RARITIES}
              onChange={setSelectedRarities}
              availableRarities={[
                'Common',
                'Uncommon',
                'Rare',
                'Epic',
                'Legendary',
                'Mythic'
              ]}
              label="Filter Token Usage by Rarity"
            />
          </div>

          {desktop ? (
            <CachedTokenAvailability
              rows={availabilityRows}
              computedAt={computedAt}
              refresh={() => {
                void refetch()
              }}
            />
          ) : (
            <GRAvailability
              guildCode={normalizedGuild}
              season={selectedSeason}
              initialTokenRows={availabilityRows}
            />
          )}
          <BossDistributionChart bossDistribution={bossDistribution} />

          <PlayerTokenChart
            players={players}
            sortBy={sortBy}
            onSortChange={setSortBy}
            showForecast={showForecast}
          />
          <RarityDistributionChart players={players} />
          <BurnedTokensChart players={players} />
          <HistoricalChart players={players} />
          <TokenUsageStats players={players} totalStats={totalStats} />
          <TokenUsageCalculationsFAQ />
        </>
      )}
    </div>
  )
}

export default memo(TokenUsage)

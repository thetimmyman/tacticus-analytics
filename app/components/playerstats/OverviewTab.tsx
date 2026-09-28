import type { ReactNode } from 'react'
import {
  useGuildComparisonOverlay,
  VS_GUILD_NA
} from './hooks/useGuildComparisonOverlay'
import {
  formatDamage,
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import type { PlayerStats, TokenAvailability, BossStatDetail } from './types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { SectionLabel } from '@/app/components/ui'
import { BossDetailSection } from './BossDetailSection'
import {
  usePlayerEconomyBudget,
  type PlayerCapBudget
} from './hooks/usePlayerCapBudget'
import {
  CAP_STATUS_LABEL,
  formatCapClock
} from '@/app/lib/calculations/cap-budget'
import { MAX_TOKENS } from '@/app/lib/calculations/token-calculation'

export { HistoricalPerformanceSection } from './HistoricalPerformanceSection'

interface PlayerOverviewProps {
  playerStats: PlayerStats
  tokenAvailability: TokenAvailability | null
  hasValidCluster: boolean
  selectedSeason: string
  playerName: string
  guildCode?: string
  userGuildCode?: string
  userGuildName?: string
  guildName?: string
}

export function PlayerOverview({
  playerStats,
  tokenAvailability,
  hasValidCluster,
  selectedSeason,
  playerName,
  guildCode,
  userGuildCode = '',
  userGuildName = '',
  guildName = ''
}: PlayerOverviewProps) {
  const {
    isCompareToUserGuild,
    setCompareToUserGuild,
    canCompare,
    isLoadingUserGuildAverages,
    effectiveStats,
    comparisonGuildLabel
  } = useGuildComparisonOverlay({
    playerStats,
    playerGuildCode: guildCode ?? '',
    userGuildCode,
    userGuildName,
    playerGuildName: guildName,
    season: selectedSeason
  })

  const guildComparisonLabel = `vs ${comparisonGuildLabel}`
  const playerGuildLabel =
    guildName || formatGuildDisplayLabel(null, guildCode || 'Player Guild')
  const userGuildLabel =
    userGuildName ||
    formatGuildDisplayLabel(null, userGuildCode || 'Your Guild')

  const seasonEntry = playerStats.historicalPerformance?.[selectedSeason]

  const effectiveVsGuild =
    typeof effectiveStats.vsGuildAvg === 'number' &&
    effectiveStats.vsGuildAvg !== 0
      ? effectiveStats.vsGuildAvg
      : (seasonEntry?.vsGuild ?? effectiveStats.vsGuildAvg ?? 0)

  const effectiveVsCluster =
    typeof playerStats.vsClusterAvg === 'number' &&
    playerStats.vsClusterAvg !== 0
      ? playerStats.vsClusterAvg
      : (seasonEntry?.vsCluster ?? playerStats.vsClusterAvg ?? 0)

  const effectiveClusterRank =
    playerStats.clusterRanking && playerStats.clusterRanking > 0
      ? playerStats.clusterRanking
      : seasonEntry?.clusterRank

  const effectiveClusterTotal =
    playerStats.totalPlayersInCluster && playerStats.totalPlayersInCluster > 0
      ? playerStats.totalPlayersInCluster
      : seasonEntry?.totalPlayersInCluster

  const effectiveGuildRank =
    playerStats.guildRanking && playerStats.guildRanking > 0
      ? playerStats.guildRanking
      : seasonEntry?.guildRank

  const effectiveGuildTotal =
    playerStats.totalPlayersInGuild && playerStats.totalPlayersInGuild > 0
      ? playerStats.totalPlayersInGuild
      : seasonEntry?.totalPlayersInGuild

  // Two RPCs count the season (by userId and by displayName); userId survives renames
  // and collisions, so it wins. Resolved once so tile and budget agree.
  const tokensUsed =
    tokenAvailability?.tokensUsed ?? playerStats.tokensUsed ?? 0
  // No bomb equivalent in the guild-tokens payload.
  const bombsUsed = playerStats.bombsUsed ?? 0
  const sweeps = playerStats.sweeps ?? 0
  const oneShots = playerStats.oneShots ?? 0

  const { tokens: capBudget, bombs: bombBudget } = usePlayerEconomyBudget(
    tokenAvailability,
    selectedSeason,
    { tokens: tokensUsed, bombs: bombsUsed }
  )

  const tokenDataSourceLabel = !tokenAvailability
    ? null
    : tokenAvailability.dataSource === 'live' ||
        tokenAvailability.dataSource === 'api'
      ? 'Live'
      : tokenAvailability.dataSource === 'calculated'
        ? 'Est.'
        : 'Default'

  // The regen clock pauses at cap, so only count down below it.
  const nextTokenCountdown =
    capBudget?.status === 'regenerating' && capBudget.nextRegenSeconds != null
      ? `+1 in ${formatCapClock(capBudget.nextRegenSeconds)}`
      : null

  const tokenAvailabilityCaption =
    [tokenDataSourceLabel, nextTokenCountdown].filter(Boolean).join(' · ') ||
    undefined

  const nextBombCountdown =
    bombBudget?.status === 'regenerating' && bombBudget.nextRegenSeconds != null
      ? `+1 in ${formatCapClock(bombBudget.nextRegenSeconds)}`
      : null

  const bombAvailabilityCaption =
    [tokenDataSourceLabel, nextBombCountdown].filter(Boolean).join(' · ') ||
    undefined

  // Green while accruing, amber one short of cap, red at cap (tokens being lost).
  const tokenStatus = !capBudget
    ? null
    : capBudget.status === 'season_ended'
      ? {
          label: CAP_STATUS_LABEL.season_ended,
          tone: 'text-secondary-wh40k',
          dot: 'bg-(--text-secondary)'
        }
      : capBudget.status === 'at_cap'
        ? {
            label: CAP_STATUS_LABEL.at_cap,
            tone: 'text-red-400',
            dot: 'bg-red-400'
          }
        : capBudget.bankNow >= MAX_TOKENS - 1
          ? { label: 'Near cap', tone: 'text-amber-300', dot: 'bg-amber-300' }
          : {
              label: CAP_STATUS_LABEL.regenerating,
              tone: 'text-green-400',
              dot: 'bg-green-400'
            }

  // Bank of 1: no "near cap" state.
  const bombStatus = !bombBudget
    ? null
    : bombBudget.status === 'season_ended'
      ? {
          label: CAP_STATUS_LABEL.season_ended,
          tone: 'text-secondary-wh40k',
          dot: 'bg-(--text-secondary)'
        }
      : bombBudget.status === 'at_cap'
        ? {
            label: 'In hand — burning',
            tone: 'text-red-400',
            dot: 'bg-red-400'
          }
        : {
            label: 'On cooldown',
            tone: 'text-green-400',
            dot: 'bg-green-400'
          }

  // Under an hour of slack is still actionable; zero means the next regen is forfeit.
  const burnToneClass = (budget: PlayerCapBudget | null): string =>
    budget?.capBudgetSeconds == null
      ? ''
      : budget.capBudgetSeconds <= 0
        ? 'text-red-400'
        : budget.status === 'at_cap' && budget.capBudgetSeconds < 3600
          ? 'text-amber-300'
          : 'text-primary-wh40k'

  const capBudgetToneClass = burnToneClass(capBudget)
  const bombBudgetToneClass = burnToneClass(bombBudget)

  const capBudgetCaption = !capBudget
    ? undefined
    : capBudget.status === 'at_cap'
      ? 'burning — spend a token to stop the clock'
      : capBudget.status === 'season_ended'
        ? 'season is over'
        : 'frozen — only runs at 3/3'

  const bombBudgetCaption = !bombBudget
    ? undefined
    : bombBudget.status === 'at_cap'
      ? 'burning — drop the bomb to stop the clock'
      : bombBudget.status === 'season_ended'
        ? 'season is over'
        : 'frozen — only runs at 1/1'

  // score = 1 + vsGuildAvg/100, tokens-weighted over mains and primes (like
  // `weightedScore`). With `isCompareToUserGuild` the baseline is the viewer's guild.
  const avgScoreTile = (() => {
    const allEntries: BossStatDetail[] = [
      ...Object.values(effectiveStats.bossStats ?? {}),
      ...Object.values(effectiveStats.primeStats ?? {})
    ]
    let num = 0
    let den = 0
    allEntries.forEach((stats) => {
      const tokens = stats.tokens ?? stats.totalTokens ?? 0
      if (tokens <= 0) return
      if (stats.vsGuildAvg === VS_GUILD_NA) return
      const score = 1 + (stats.vsGuildAvg ?? 0) / 100
      if (!Number.isFinite(score)) return
      num += score * tokens
      den += tokens
    })
    return den > 0 ? num / den : null
  })()

  return (
    <div className="space-y-6">
      {/* Performance Summary */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-secondary-wh40k uppercase tracking-wider">
          Performance Summary
        </h3>

        <div className="space-y-4">
          {/* Rank leads, delta supports; two compact cards keep the rest above the fold. */}
          <div>
            <SectionLabel withDivider={false}>Standing</SectionLabel>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <StandingTile
                label={guildComparisonLabel}
                delta={formatPercentageDiff(effectiveVsGuild, 0)}
                positive={effectiveVsGuild >= 0}
                rank={effectiveGuildRank}
                total={effectiveGuildTotal}
                scope="in guild"
              />
              {hasValidCluster && (
                <StandingTile
                  label="vs Cluster Avg"
                  delta={formatPercentageDiff(effectiveVsCluster ?? 0, 0)}
                  positive={(effectiveVsCluster ?? 0) >= 0}
                  rank={effectiveClusterRank}
                  total={effectiveClusterTotal}
                  scope="in cluster"
                />
              )}
            </div>
          </div>

          <div>
            <SectionLabel withDivider={false}>Damage</SectionLabel>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {/* Total Damage sums battles and bombs; Avg Damage/Hit is battles-only, sans sweeps and 0-damage. */}
              <SummaryStat
                label="Total Damage"
                value={formatDamage(playerStats.totalDamage, 2)}
                caption="battles + bombs"
              />
              <SummaryStat
                label="Avg Damage/Hit"
                value={formatNumber(playerStats.avgDamagePerHit)}
                caption="battles only, excl. sweeps & 0-dmg"
              />
              <SummaryStat
                label="Avg Score"
                value={avgScoreTile !== null ? avgScoreTile.toFixed(2) : '--'}
                className={
                  avgScoreTile === null
                    ? ''
                    : avgScoreTile >= 1
                      ? 'text-green-400'
                      : 'text-red-400'
                }
              />
              <SummaryStat
                label="One-Shots"
                value={formatNumber(oneShots)}
                caption="killed at full HP"
              />
              <SummaryStat
                label="Sweeps"
                value={formatNumber(sweeps)}
                caption="killed below full HP"
              />
            </div>
          </div>

          <div>
            <SectionLabel withDivider={false}>Economy</SectionLabel>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <SummaryStat
                label="Tokens Used"
                value={
                  capBudget
                    ? `${formatNumber(tokensUsed)}/${capBudget.seasonMax}`
                    : formatNumber(tokensUsed)
                }
                caption={capBudget ? 'of the season cap' : undefined}
              />
              <SummaryStat
                label="Tokens Available"
                value={
                  // The bank is aged to now, so the tile flips 2/3 → 3/3 as the countdown crosses zero.
                  capBudget
                    ? `${capBudget.bankNow}/3`
                    : tokenAvailability
                      ? `${tokenAvailability.tokens}/3`
                      : '--'
                }
                caption={
                  tokenStatus ? (
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${tokenStatus.dot}`}
                      />
                      <span className={tokenStatus.tone}>
                        {tokenStatus.label}
                      </span>
                      {tokenAvailabilityCaption && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{tokenAvailabilityCaption}</span>
                        </>
                      )}
                    </span>
                  ) : (
                    tokenAvailabilityCaption
                  )
                }
              />
              <SummaryStat
                label="Still Reachable"
                value={
                  capBudget?.stillReachable != null
                    ? `${capBudget.stillReachable}/${capBudget.seasonMax}`
                    : '--'
                }
                className={
                  capBudget?.stillReachable != null &&
                  capBudget.stillReachable < capBudget.seasonMax
                    ? 'text-amber-300'
                    : ''
                }
                caption={
                  capBudget?.stillReachable != null
                    ? capBudget.stillReachable < capBudget.seasonMax
                      ? `${capBudget.seasonMax - capBudget.stillReachable} already out of reach`
                      : 'full season still on the table'
                    : undefined
                }
              />
              <SummaryStat
                label="Burn Timer"
                value={
                  capBudget ? formatCapClock(capBudget.capBudgetSeconds) : '--'
                }
                className={capBudgetToneClass}
                caption={capBudgetCaption}
              />
            </div>
            {/* Bombs get their own row, mirroring the token row. */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <SummaryStat
                label="Bombs Used"
                value={
                  bombBudget
                    ? `${formatNumber(bombsUsed)}/${bombBudget.seasonMax}`
                    : formatNumber(bombsUsed)
                }
                caption={bombBudget ? 'of the season cap' : undefined}
              />
              <SummaryStat
                label="Bombs Available"
                value={
                  bombBudget
                    ? `${bombBudget.bankNow}/1`
                    : tokenAvailability
                      ? `${tokenAvailability.bombs}/1`
                      : '--'
                }
                caption={
                  bombStatus ? (
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${bombStatus.dot}`}
                      />
                      <span className={bombStatus.tone}>
                        {bombStatus.label}
                      </span>
                      {bombAvailabilityCaption && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{bombAvailabilityCaption}</span>
                        </>
                      )}
                    </span>
                  ) : (
                    bombAvailabilityCaption
                  )
                }
              />
              <SummaryStat
                label="Bombs Reachable"
                value={
                  bombBudget?.stillReachable != null
                    ? `${bombBudget.stillReachable}/${bombBudget.seasonMax}`
                    : '--'
                }
                className={
                  bombBudget?.stillReachable != null &&
                  bombBudget.stillReachable < bombBudget.seasonMax
                    ? 'text-amber-300'
                    : ''
                }
                caption={
                  bombBudget?.stillReachable != null
                    ? bombBudget.stillReachable < bombBudget.seasonMax
                      ? `${bombBudget.seasonMax - bombBudget.stillReachable} already out of reach`
                      : 'full season still on the table'
                    : undefined
                }
              />
              <SummaryStat
                label="Bomb Burn Timer"
                value={
                  bombBudget
                    ? formatCapClock(bombBudget.capBudgetSeconds)
                    : '--'
                }
                className={bombBudgetToneClass}
                caption={bombBudgetCaption}
              />
            </div>
            {capBudget && (
              <p className="mt-3 text-xs text-secondary-wh40k">
                <span className="text-primary-wh40k">Burn timer</span> is the
                total time still affordable at a full bank across the rest of
                the season — the regeneration clock pauses when you are full, so
                every minute there pushes future tokens back until one slips
                past the season deadline. At zero, one is gone and the timer
                resets to a full interval. Bombs work identically: the 18h
                cooldown only runs once the bomb is spent, so a bomb sitting in
                hand is burning the same way 3/3 tokens are.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Cross-Guild Comparison Toggle */}
      {canCompare && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-secondary-wh40k">Compare against:</span>
          <div className="flex items-center gap-0.5 bg-(--card-bg) border border-(--card-border) rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setCompareToUserGuild(false)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !isCompareToUserGuild
                  ? 'bg-primary-wh40k text-white'
                  : 'text-secondary-wh40k hover:text-primary-wh40k'
              }`}
            >
              {playerGuildLabel || 'Their Guild'}
            </button>
            <button
              type="button"
              onClick={() => setCompareToUserGuild(true)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isCompareToUserGuild
                  ? 'bg-primary-wh40k text-white'
                  : 'text-secondary-wh40k hover:text-primary-wh40k'
              }`}
            >
              {userGuildLabel || 'Your Guild'}
            </button>
          </div>
          {isLoadingUserGuildAverages && (
            <span className="text-secondary-wh40k animate-pulse">
              Loading averages...
            </span>
          )}
        </div>
      )}

      {/* Boss Detail */}
      <BossDetailSection
        bossStats={effectiveStats.bossStats ?? {}}
        primeStats={effectiveStats.primeStats ?? {}}
        hasValidCluster={hasValidCluster}
        playerName={playerName}
        guildCode={guildCode}
        season={selectedSeason}
        guildLabel={guildComparisonLabel}
      />
    </div>
  )
}

interface StandingTileProps {
  label: string
  delta: string
  positive: boolean
  rank?: number
  total?: number
  scope: string
}

// Rank headline with the vs-avg delta as support; delta when no rank.
function StandingTile({
  label,
  delta,
  positive,
  rank,
  total,
  scope
}: StandingTileProps) {
  const hasRank = Boolean(rank && total)
  const deltaClass = positive ? 'text-green-400' : 'text-red-400'
  return (
    <div className="rounded-lg border border-(--card-border) border-l-2 border-l-(--accent) bg-(--card-bg) px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-secondary-wh40k">{label}</div>
        {hasRank && (
          <div className={`text-sm font-semibold ${deltaClass}`}>{delta}</div>
        )}
      </div>
      {hasRank ? (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-(--accent)">#{rank}</span>
          <span className="text-sm text-secondary-wh40k">
            of {total} {scope}
          </span>
        </div>
      ) : (
        <div className={`mt-1 text-3xl font-bold ${deltaClass}`}>{delta}</div>
      )}
    </div>
  )
}

interface SummaryStatProps {
  label: string
  value: string
  className?: string
  accent?: boolean
  emphasis?: boolean
  /** Line under the value: source, countdown, status pip. */
  caption?: ReactNode
  captionClassName?: string
}

function SummaryStat({
  label,
  value,
  className = '',
  accent,
  emphasis,
  caption,
  captionClassName = ''
}: SummaryStatProps) {
  return (
    <div>
      <div className="text-sm text-secondary-wh40k">{label}</div>
      <div
        className={[
          'text-xl font-bold',
          accent ? 'text-(--accent)' : 'text-primary-wh40k',
          emphasis ? 'text-(--primary)' : '',
          className
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </div>
      {caption && (
        <div
          className={[
            'text-xs mt-1',
            captionClassName || 'text-secondary-wh40k'
          ].join(' ')}
        >
          {caption}
        </div>
      )}
    </div>
  )
}

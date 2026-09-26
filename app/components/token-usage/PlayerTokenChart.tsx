'use client'

import { memo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { getRarityColors } from '@tacticus/charting/theme'
import type { PlayerTokens, SortOption } from './types'
import { cappedAvailable } from '@/app/lib/calculations/token-burn'

const RARITY_COLORS = getRarityColors()

interface PlayerTokenChartProps {
  players: PlayerTokens[]
  sortBy: SortOption
  onSortChange: (sort: SortOption) => void
  /** @deprecated Use showForecast. */
  isAlpha?: boolean
  /** Forecast gate: exposes the projectedBySeasonEnd sort and projection overlay. */
  showForecast?: boolean
}

function PlayerTokenChart({
  players,
  sortBy,
  onSortChange,
  isAlpha = false,
  showForecast = false
}: PlayerTokenChartProps) {
  const forecastEnabled = showForecast || isAlpha
  const showProjectionOverlay =
    forecastEnabled &&
    sortBy === 'projectedBySeasonEnd' &&
    players.some((p) => p.projection)

  const sortedPlayers = [...players].sort((a, b) => {
    switch (sortBy) {
      case 'efficiency':
        return b.efficiency - a.efficiency
      case 'avgPerLoop':
        return b.avgTokensPerLoop - a.avgTokensPerLoop
      case 'historical':
        if (a.historicalAvg && b.historicalAvg) {
          return b.historicalAvg - a.historicalAvg
        } else if (a.historicalAvg && !b.historicalAvg) {
          return -1
        } else if (!a.historicalAvg && b.historicalAvg) {
          return 1
        }
        return b.totalTokens - a.totalTokens
      case 'projectedBySeasonEnd': {
        // Unprojected players last; otherwise tokens_at_season_end desc, tie-broken on
        // tokens_will_regen so active capped players rank above stuck ones.
        const aProj = a.projection
        const bProj = b.projection
        if (aProj && !bProj) return -1
        if (!aProj && bProj) return 1
        if (!aProj && !bProj) return b.totalTokens - a.totalTokens
        if (aProj && bProj) {
          if (bProj.tokens_at_season_end !== aProj.tokens_at_season_end) {
            return bProj.tokens_at_season_end - aProj.tokens_at_season_end
          }
          return bProj.tokens_will_regen - aProj.tokens_will_regen
        }
        return 0
      }
      case 'total':
      default:
        return b.totalTokens - a.totalTokens
    }
  })

  const maxTokens = Math.max(...sortedPlayers.map((p) => p.totalTokens), 1)

  return (
    <div className="card-wh40k p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <h3 className="heading-wh40k text-base sm:text-lg">
          Token Usage by Player
        </h3>

        <label htmlFor="sort-select" className="sr-only">
          Sort players by
        </label>
        <select
          id="sort-select"
          name="sort-by"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="input-wh40k text-xs sm:text-sm px-2 py-1"
          aria-label="Sort players by different criteria"
        >
          <option value="total">Total Tokens</option>
          <option value="efficiency">Efficiency</option>
          <option value="avgPerLoop">Avg/Loop</option>
          <option value="historical">Historical</option>
          {forecastEnabled && (
            <option value="projectedBySeasonEnd">
              Projected by Season End
            </option>
          )}
        </select>
      </div>
      <p
        className="text-[10px] sm:text-xs italic text-amber-300/80 mb-3"
        role="note"
      >
        If player API keys have not been entered for each player these will be
        calculated using an imperfect battle history formula.
      </p>

      <div className="relative -mx-3 sm:mx-0">
        <div className="flex gap-1 sm:gap-2 overflow-x-auto px-3 sm:px-0 pb-3 sm:pb-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          {sortedPlayers.map((player, index) => {
            const barHeightPercent =
              maxTokens > 0 ? (player.totalTokens / maxTokens) * 100 : 0

            const segments = [
              'common',
              'uncommon',
              'rare',
              'epic',
              'legendary',
              'mythic'
            ]
              .map((rarity) => ({
                rarity,
                count:
                  player.tokensByRarity[
                    rarity as keyof typeof player.tokensByRarity
                  ]
              }))
              .filter((seg) => seg.count > 0)

            const proj = player.projection
            const showOverlay = showProjectionOverlay && proj
            const overlayLabel = showOverlay
              ? `${proj.tokens_at_season_end} (+${proj.tokens_will_regen})`
              : null
            const overlayClass = showOverlay
              ? proj.will_cap
                ? 'text-[var(--warning)]'
                : 'text-[var(--text-primary)]'
              : ''
            const overlayTitle = showOverlay
              ? proj.will_cap
                ? `~${proj.estimated_cap_waste} tokens projected lost to the cap by season end`
                : `Projected: ${proj.tokens_at_season_end} tokens by season end (${proj.tokens_now} now + ${proj.tokens_will_regen} regen)`
              : undefined

            return (
              <div
                key={player.userId}
                className="flex-shrink-0 text-center"
                style={{ width: '50px' }}
                title={overlayTitle}
              >
                {showOverlay && (
                  <div
                    className={`text-[10px] font-bold mb-0.5 ${overlayClass}`}
                  >
                    {overlayLabel}
                  </div>
                )}
                <div className="h-32 sm:h-48 flex flex-col justify-end mb-1">
                  <div
                    className="w-full rounded-t overflow-hidden relative bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200"
                    style={{
                      height: `${barHeightPercent}%`,
                      minHeight: player.totalTokens > 0 ? '12px' : '0'
                    }}
                  >
                    <div className="h-full w-full flex flex-col">
                      {segments.map(({ rarity, count }) => {
                        const segmentPercent =
                          player.totalTokens > 0
                            ? (count / player.totalTokens) * 100
                            : 0
                        return (
                          <div
                            key={rarity}
                            className="w-full"
                            style={{
                              backgroundColor:
                                RARITY_COLORS[
                                  rarity as keyof typeof RARITY_COLORS
                                ],
                              height: `${segmentPercent}%`,
                              minHeight: count > 0 ? '2px' : '0'
                            }}
                            title={`${rarity}: ${count}`}
                          />
                        )
                      })}
                    </div>
                    <span
                      className={`absolute inset-0 flex items-center justify-center text-[var(--text-primary)] font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${barHeightPercent < 20 ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}
                    >
                      {player.totalTokens}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] sm:text-xs">
                  <div
                    className="font-medium text-[var(--text-secondary)] truncate"
                    title={player.displayName}
                  >
                    <PlayerLink playerName={player.displayName}>
                      {player.displayName.length > 6
                        ? player.displayName.substring(0, 6) + '..'
                        : player.displayName}
                    </PlayerLink>
                  </div>
                  <div className="text-[var(--text-secondary)] text-[10px]">
                    #{index + 1}
                  </div>
                  {player.historicalAvg ? (
                    <div className="text-yellow-400 text-[9px]">5-vet</div>
                  ) : (
                    <div className="text-[9px] text-transparent">
                      placeholder
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--text-tertiary)] flex flex-col gap-0.5 mt-1">
                    <span
                      title={
                        player.dataSource === 'live'
                          ? 'Live from the Tacticus API (player API key)'
                          : player.dataSource === 'calculated'
                            ? 'Estimated from battle history — no live API reading for this player'
                            : undefined
                      }
                    >
                      Avail: {cappedAvailable(player.tokensAvailable)}
                      {player.dataSource === 'calculated' && (
                        <span aria-hidden="true">~</span>
                      )}
                    </span>
                    <span>Bombs: {player.bombsAvailable ?? 0}</span>
                    {player.burnedTokensUsage !== null &&
                      player.burnedTokensUsage !== undefined && (
                        <span title="Tokens behind the guild-leader anchor (±1 token) — a participation proxy, not physical waste. See the FAQ below.">
                          Behind pace: {player.burnedTokensUsage}
                        </span>
                      )}
                    {player.overcappedTokens !== null &&
                      player.overcappedTokens !== undefined &&
                      player.overcappedTokens > 0 && (
                        <span title="Tokens physically wasted at the 3/3 cap through full 12h regen cycles — unrecoverable.">
                          Overcapped: {player.overcappedTokens}
                        </span>
                      )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default memo(PlayerTokenChart)

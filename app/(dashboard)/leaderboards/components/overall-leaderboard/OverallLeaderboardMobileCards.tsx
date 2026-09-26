'use client'

import {
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { getGuildColor, getRankBadge } from './model'
import type { EnhancedPlayerStats } from './types'

interface OverallLeaderboardMobileCardsProps {
  players: EnhancedPlayerStats[]
  userGuild: string
  guildLabels: Record<string, string>
  scoringBasisLabel: string
}

export function OverallLeaderboardMobileCards({
  players,
  userGuild,
  guildLabels,
  scoringBasisLabel
}: OverallLeaderboardMobileCardsProps) {
  return (
    <div className="lg:hidden space-y-3">
      {players.map((player) => {
        const rank = player.scoreRank ?? player.currentRank
        return (
          <div
            key={player.stableKey}
            className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-3 sm:p-4 space-y-2 sm:space-y-3"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`font-bold ${rank && rank <= 3 ? 'text-xl sm:text-2xl' : 'text-[var(--text-secondary)]'}`}
                  >
                    {getRankBadge(rank)}
                  </span>
                  <span
                    className={`font-medium text-base sm:text-lg ${getGuildColor(player.Guild, userGuild)}`}
                  >
                    <PlayerLink playerName={player.displayName}>
                      {player.displayName}
                    </PlayerLink>
                  </span>
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {guildLabels[player.Guild] ??
                    formatGuildDisplayLabel(null, player.Guild)}
                </div>
              </div>
              <div className="text-right">
                {player.rankChange !== undefined ? (
                  <div className="flex items-center gap-1">
                    {player.rankChange > 0 ? (
                      <>
                        <span className="text-green-500">↑</span>
                        <span className="text-green-500 font-medium">
                          +{player.rankChange}
                        </span>
                      </>
                    ) : player.rankChange < 0 ? (
                      <>
                        <span className="text-red-500">↓</span>
                        <span className="text-red-500 font-medium">
                          {player.rankChange}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--text-secondary)]">-</span>
                    )}
                  </div>
                ) : (
                  <span className="text-[var(--text-secondary)] text-sm">
                    NEW
                  </span>
                )}
                {player.fiveSeasonAvgRank && (
                  <div className="text-xs text-[var(--text-secondary)] mt-1">
                    5-Season: #{Math.round(player.fiveSeasonAvgRank)}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
              <div>
                <div className="text-[var(--text-secondary)] text-[10px] sm:text-xs">
                  Total Damage
                </div>
                <div className="text-[var(--primary)] font-bold">
                  {formatNumber(player.totalDamage)}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-secondary)] text-[10px] sm:text-xs">
                  Avg Damage
                </div>
                <div className="font-medium">
                  {formatNumber(player.avgDamage)}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-secondary)] text-[10px] sm:text-xs">
                  Score ({scoringBasisLabel})
                </div>
                <div
                  className={`font-medium ${
                    typeof player.performanceValue === 'number' &&
                    player.performanceValue > 0
                      ? 'text-green-500'
                      : typeof player.performanceValue === 'number' &&
                          player.performanceValue < 0
                        ? 'text-red-500'
                        : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {typeof player.performanceValue === 'number'
                    ? formatPercentageDiff(player.performanceValue, 0)
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-secondary)] text-[10px] sm:text-xs">
                  Battles / Bombs
                </div>
                <div className="font-medium">
                  {player.allBattleCount} / {player.bombsUsed}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--card-border)] text-xs sm:text-sm text-[var(--text-secondary)]">
              Kills: {player.allBossesKilled}
            </div>
          </div>
        )
      })}
    </div>
  )
}

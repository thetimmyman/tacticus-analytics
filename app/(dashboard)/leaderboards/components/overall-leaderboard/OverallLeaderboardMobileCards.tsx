'use client'

import {
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import {
  MobileCardList,
  type MobileCardListItem
} from '@/app/components/ui/MobileCardList'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { getGuildColor, getLeaderboardRowKey, getRankBadge } from './model'
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
  const items: MobileCardListItem[] = players.map((player) => {
    const rank = player.scoreRank ?? player.currentRank
    return {
      id: getLeaderboardRowKey(player),
      title: (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`font-bold ${rank && rank <= 3 ? 'text-xl sm:text-2xl' : 'text-secondary-wh40k'}`}
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
          <div className="text-sm font-normal text-secondary-wh40k">
            {guildLabels[player.Guild] ??
              formatGuildDisplayLabel(null, player.Guild)}
          </div>
        </div>
      ),
      state: (
        <div className="text-right">
          {player.rankChange !== undefined ? (
            <div className="flex items-center justify-end gap-1">
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
                <span className="text-secondary-wh40k">-</span>
              )}
            </div>
          ) : (
            <span className="text-secondary-wh40k text-sm">NEW</span>
          )}
          {player.fiveSeasonAvgRank && (
            <div className="text-xs font-normal text-secondary-wh40k mt-1">
              5-Season: #{Math.round(player.fiveSeasonAvgRank)}
            </div>
          )}
        </div>
      ),
      detail: (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
          <div>
            <div className="text-secondary-wh40k text-xs">Total Damage</div>
            <div className="text-(--primary) font-bold">
              {formatNumber(player.totalDamage)}
            </div>
          </div>
          <div>
            <div className="text-secondary-wh40k text-xs">Avg Damage</div>
            <div className="font-medium">{formatNumber(player.avgDamage)}</div>
          </div>
          <div>
            <div className="text-secondary-wh40k text-xs">
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
                    : 'text-secondary-wh40k'
              }`}
            >
              {typeof player.performanceValue === 'number'
                ? formatPercentageDiff(player.performanceValue, 0)
                : '-'}
            </div>
          </div>
          <div>
            <div className="text-secondary-wh40k text-xs">Battles / Bombs</div>
            <div className="font-medium">
              {player.allBattleCount} / {player.bombsUsed}
            </div>
          </div>
        </div>
      ),
      meta: [
        <span
          key="kills"
          className="block pt-2 text-xs sm:text-sm text-secondary-wh40k"
        >
          Kills: {player.allBossesKilled}
        </span>
      ]
    }
  })

  return <MobileCardList items={items} className="lg:hidden space-y-3" />
}

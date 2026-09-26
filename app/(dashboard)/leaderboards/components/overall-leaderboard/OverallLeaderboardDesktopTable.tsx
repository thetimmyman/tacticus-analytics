'use client'

import {
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { getGuildColor, getRankBadge } from './model'
import type { EnhancedPlayerStats, SortDirection, SortField } from './types'

interface OverallLeaderboardDesktopTableProps {
  rows: EnhancedPlayerStats[]
  userGuild: string
  guildLabels: Record<string, string>
  scoringBasisLabel: string
  scoringBasisTableLabel: string
  sortField: SortField
  sortDirection: SortDirection
  onSortChange: (sort: { key: SortField; direction: SortDirection }) => void
}

export function OverallLeaderboardDesktopTable({
  rows,
  userGuild,
  guildLabels,
  scoringBasisLabel,
  scoringBasisTableLabel,
  sortField,
  sortDirection,
  onSortChange
}: OverallLeaderboardDesktopTableProps) {
  const columns: DataTableColumn<EnhancedPlayerStats, SortField>[] = [
    {
      key: 'rank',
      header: 'Rank',
      className: 'w-[4rem]',
      render: (player) => {
        const rank = player.scoreRank ?? player.currentRank
        return (
          <span
            className={`font-bold ${rank && rank <= 3 ? 'text-2xl text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
          >
            {getRankBadge(rank)}
          </span>
        )
      }
    },
    {
      key: 'rankChange',
      header: '+/- Prior',
      className: 'w-[5.25rem]',
      render: (player) =>
        player.rankChange !== undefined ? (
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
          <span className="text-[var(--text-secondary)] text-sm">NEW</span>
        )
    },
    {
      key: 'fiveSeasonAvg',
      header: '5-Season Avg',
      className: 'w-[7.25rem]',
      render: (player) =>
        player.fiveSeasonAvgRank ? (
          <span className="font-medium">
            #{Math.round(player.fiveSeasonAvgRank)}
          </span>
        ) : (
          <span className="text-[var(--text-secondary)]">-</span>
        )
    },
    {
      key: 'name',
      header: 'Player',
      className: 'w-[8.75rem]',
      render: (player) => (
        <span
          className={`font-medium ${getGuildColor(player.Guild, userGuild)}`}
        >
          <PlayerLink playerName={player.displayName}>
            {player.displayName}
          </PlayerLink>
        </span>
      )
    },
    {
      key: 'guild',
      header: 'Guild',
      className: 'w-[11.25rem] whitespace-nowrap',
      render: (player) =>
        guildLabels[player.Guild] ?? formatGuildDisplayLabel(null, player.Guild)
    },
    {
      key: 'totalDamage',
      header: 'Total Damage',
      className: 'w-[7.5rem]',
      render: (player) => (
        <span className="text-[var(--primary)] font-bold">
          {formatNumber(player.totalDamage)}
        </span>
      )
    },
    {
      key: 'battles',
      header: 'Battles',
      className: 'w-[5.25rem]',
      render: (player) => player.allBattleCount
    },
    {
      key: 'avgDamage',
      header: 'Avg Damage',
      className: 'w-[7rem]',
      render: (player) => formatNumber(player.avgDamage)
    },
    {
      key: 'percentVsCluster',
      header: scoringBasisTableLabel,
      headerTitle: scoringBasisLabel,
      className: 'w-[8.5rem] whitespace-nowrap',
      render: (player) => (
        <span
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
            : '0%'}
        </span>
      )
    },
    {
      key: 'bombs',
      header: 'Bombs',
      className: 'w-[4.75rem]',
      render: (player) => player.bombsUsed
    },
    {
      key: 'kills',
      header: 'Kills',
      className: 'w-[4rem]',
      render: (player) => (
        <span className="text-[var(--accent-wh40k)]">
          {player.allBossesKilled}
        </span>
      )
    }
  ]

  return (
    <div className="hidden lg:block bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg overflow-hidden">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(player) => player.stableKey}
        sort={{ key: sortField, direction: sortDirection }}
        onSortChange={onSortChange}
        externallySorted
        tableClassName="min-w-[1180px] table-fixed"
        empty={<></>}
      />
    </div>
  )
}

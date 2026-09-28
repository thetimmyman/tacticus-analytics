'use client'

import type { GuildTrendsRow } from '@/app/lib/hooks/queries'
import {
  formatDamage,
  formatNumber,
  formatPercentage,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'

interface GuildSeasonTableProps {
  data: GuildTrendsRow[]
  hasCluster: boolean
}

export function GuildSeasonTable({ data, hasCluster }: GuildSeasonTableProps) {
  const displayData = [...data].reverse()

  return (
    <div className="card-wh40k p-4 overflow-x-auto">
      <h3 className="subheading-wh40k text-green-400 text-base sm:text-lg mb-3">
        Season Summary
      </h3>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-secondary-wh40k border-b border-(--card-border)">
            <th className="px-3 py-2">Season</th>
            {hasCluster && <th className="px-3 py-2 text-right">vs Cluster</th>}
            {hasCluster && (
              <th className="px-3 py-2 text-right">Cluster Rank</th>
            )}
            <th className="px-3 py-2 text-right">Total Damage</th>
            <th className="px-3 py-2 text-right">Active Players</th>
            <th className="px-3 py-2 text-right">Tokens Used</th>
            <th
              className="px-3 py-2 text-right"
              title="Based on current roster size"
            >
              Participation*
            </th>
            <th className="px-3 py-2 text-right">Avg Dmg/Token</th>
            <th className="px-3 py-2 text-right">Reliability</th>
          </tr>
        </thead>
        <tbody>
          {displayData.map((row) => {
            const vsCluster = row.vs_cluster_percent
            const vsColor =
              vsCluster != null && vsCluster >= 0
                ? 'text-green-400'
                : 'text-red-400'

            return (
              <tr
                key={row.season}
                className="border-t border-card-border/60 hover:bg-card/50"
              >
                <td className="px-3 py-2 font-medium text-primary-wh40k">
                  S{row.season}
                </td>
                {hasCluster && (
                  <td className={`px-3 py-2 text-right font-mono ${vsColor}`}>
                    {vsCluster != null
                      ? formatPercentageDiff(vsCluster, 0)
                      : 'N/A'}
                  </td>
                )}
                {hasCluster && (
                  <td className="px-3 py-2 text-right text-primary-wh40k">
                    {row.guild_rank_in_cluster != null &&
                    row.total_guilds_in_cluster != null
                      ? `#${row.guild_rank_in_cluster}/${row.total_guilds_in_cluster}`
                      : 'N/A'}
                  </td>
                )}
                <td className="px-3 py-2 text-right font-mono text-blue-400">
                  {formatDamage(row.total_damage)}
                </td>
                <td className="px-3 py-2 text-right text-primary-wh40k">
                  {row.active_players}
                </td>
                <td className="px-3 py-2 text-right font-mono text-yellow-400">
                  {formatNumber(row.total_battles)}
                </td>
                <td className="px-3 py-2 text-right text-primary-wh40k">
                  {row.participation_rate != null
                    ? formatPercentage(row.participation_rate / 100)
                    : 'N/A'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-primary-wh40k">
                  {row.avg_damage_per_token != null
                    ? formatDamage(row.avg_damage_per_token)
                    : 'N/A'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-purple-400">
                  {row.reliability_score != null
                    ? row.reliability_score.toFixed(1)
                    : 'N/A'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-secondary-wh40k">
        * Participation rate is based on current roster size and may differ from
        actual membership during older seasons.
      </p>
    </div>
  )
}

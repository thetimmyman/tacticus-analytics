'use client'

import { useState } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { formatDamage } from '@tacticus/app-core/formatters'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.homepage.GlobalLeaderboard')
import { useQuery } from '@tanstack/react-query'
import { CACHE_CONFIG } from '@/app/lib/config/constants'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

/**
 * Guilds with `obfuscate_values` get damage rounded to 25,000 server-side; mark
 * those so approximations never look exact.
 */
function formatLeaderboardDamage(
  damage: number,
  isObfuscated?: boolean
): string {
  return isObfuscated ? `~${formatDamage(damage)}` : formatDamage(damage)
}

export function GlobalLeaderboard() {
  const supabase = dbClient()
  const [selectedMetric, setSelectedMetric] = useState<
    'total' | 'average' | 'weighted'
  >('total')

  const { data: entries = [], isLoading: loading } = useQuery({
    queryKey: ['global_leaderboard', selectedMetric],
    queryFn: async () => {
      // Use the privacy-aware RPC, never public.global_leaderboard: the raw view ignores
      // explore_privacy_mode and would expose `hide_all` guilds.
      const { data, error } = await supabase.rpc(
        'get_public_global_leaderboard',
        { p_limit: 10 }
      )

      if (error) {
        logger.error({ err: error }, 'Error fetching leaderboard:')
        throw error
      }

      if (!data || data.length === 0) {
        return []
      }

      const typedData = data

      const maxTotalDamage = Math.max(...typedData.map((p) => p.total_damage))
      const maxAvgDamage = Math.max(...typedData.map((p) => p.avg_damage))
      const maxBattles = Math.max(...typedData.map((p) => p.battle_count))

      const dataWithScores = typedData.map((player) => {
        const normalizedTotal = (player.total_damage / maxTotalDamage) * 100
        const normalizedAvg = (player.avg_damage / maxAvgDamage) * 100
        const normalizedBattles = (player.battle_count / maxBattles) * 100

        // 60% total damage, 30% average damage, 10% participation.
        const performanceScore =
          normalizedTotal * 0.6 + normalizedAvg * 0.3 + normalizedBattles * 0.1

        return {
          ...player,
          performance_score: performanceScore
        }
      })

      return [...dataWithScores]
        .sort((a, b) => {
          if (selectedMetric === 'total') {
            return b.total_damage - a.total_damage
          } else if (selectedMetric === 'average') {
            return b.avg_damage - a.avg_damage
          } else {
            return (b.performance_score || 0) - (a.performance_score || 0)
          }
        })
        .map((player, index) => ({
          ...player,
          rank: index + 1
        }))
    },
    staleTime: CACHE_CONFIG.STALE_TIME.SHORT, // 2 minutes for leaderboard
    gcTime: 10 * 60 * 1000 // 10 minutes garbage collection
  })

  if (loading) {
    return (
      <div className="bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded-lg border border-red-900/30 p-4 sm:p-6 md:p-8">
        <LoadingSpinner message="Calculating rankings..." variant="sacred" />
      </div>
    )
  }

  return (
    <div className="bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded-lg border border-[var(--card-border)] overflow-hidden">
      {/* Metric Selector */}
      <div className="p-4 border-b border-[var(--card-border)] flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedMetric('total')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-semibold transition-all text-sm sm:text-base ${
            selectedMetric === 'total'
              ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
              : 'bg-card/50 text-[var(--text-secondary)] border border-[var(--card-border)] hover:border-[var(--card-border)]'
          }`}
        >
          Total
        </button>
        <button
          onClick={() => setSelectedMetric('average')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-semibold transition-all text-sm sm:text-base ${
            selectedMetric === 'average'
              ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
              : 'bg-card/50 text-[var(--text-secondary)] border border-[var(--card-border)] hover:border-[var(--card-border)]'
          }`}
        >
          Average
        </button>
        <button
          onClick={() => setSelectedMetric('weighted')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-semibold transition-all text-sm sm:text-base ${
            selectedMetric === 'weighted'
              ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
              : 'bg-card/50 text-[var(--text-secondary)] border border-[var(--card-border)] hover:border-[var(--card-border)]'
          }`}
        >
          Score
        </button>
      </div>

      {/* Mobile Datacards */}
      <div className="md:hidden">
        {entries.map((entry) => (
          <div
            key={`${entry.display_name}-${entry.rank}`}
            className="p-4 border-b border-gray-800/50 hover:bg-card/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div
                  className={`text-xl sm:text-2xl font-bold ${
                    entry.rank === 1
                      ? 'text-[var(--primary)]'
                      : entry.rank === 2
                        ? 'text-[var(--text-secondary)]'
                        : entry.rank === 3
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--text-secondary)]'
                  }`}
                >
                  #{entry.rank}
                </div>
                <div>
                  <div className="font-semibold text-[var(--text-primary)]">
                    {entry.display_name}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {formatGuildDisplayLabel({
                      display_name: entry.guild_display_name
                    })}{' '}
                    • {entry.cluster_display_name}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div>
                <div
                  className={`font-semibold text-sm ${selectedMetric === 'total' ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                >
                  {formatLeaderboardDamage(
                    entry.total_damage,
                    entry.is_obfuscated
                  )}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Total
                </div>
              </div>
              <div>
                <div
                  className={`font-semibold text-sm ${selectedMetric === 'average' ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                >
                  {formatLeaderboardDamage(
                    entry.avg_damage,
                    entry.is_obfuscated
                  )}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Average
                </div>
              </div>
              <div>
                <div className="font-semibold text-sm text-[var(--text-secondary)]">
                  {entry.battle_count}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Battles
                </div>
              </div>
            </div>

            {selectedMetric === 'weighted' && (
              <div className="mt-2 text-center">
                <div className="font-semibold text-[var(--accent)]">
                  Score: {entry.performance_score?.toFixed(1)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--card-border)] hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors duration-150">
              <th className="text-left p-4 text-[var(--text-secondary)] font-semibold">
                Rank
              </th>
              <th className="text-left p-4 text-[var(--text-secondary)] font-semibold">
                Player
              </th>
              <th className="text-left p-4 text-[var(--text-secondary)] font-semibold">
                Guild
              </th>
              <th className="text-left p-4 text-[var(--text-secondary)] font-semibold">
                Cluster
              </th>
              <th className="text-right p-4 text-[var(--text-secondary)] font-semibold">
                Total Damage
              </th>
              <th className="text-right p-4 text-[var(--text-secondary)] font-semibold">
                Avg Damage
              </th>
              <th className="text-right p-4 text-[var(--text-secondary)] font-semibold">
                Battles
              </th>
              {selectedMetric === 'weighted' && (
                <th className="text-right p-4 text-[var(--text-secondary)] font-semibold">
                  Score
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              // Display text comes only from configured labels (the view may hold guild UUIDs).
              <tr
                key={`${entry.display_name}-${entry.rank}`}
                className="border-b border-gray-800/50 hover:bg-card/30 transition-colors hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors duration-150"
              >
                <td className="p-4">
                  <div
                    className={`font-bold ${
                      entry.rank === 1
                        ? 'text-[var(--primary)]'
                        : entry.rank === 2
                          ? 'text-[var(--text-secondary)]'
                          : entry.rank === 3
                            ? 'text-[var(--accent)]'
                            : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    #{entry.rank}
                  </div>
                </td>
                <td className="p-4">
                  <div className="font-semibold text-[var(--text-primary)]">
                    {entry.display_name}
                  </div>
                </td>
                <td className="p-4">
                  <div className="text-sm">
                    <div className="text-[var(--text-secondary)]">
                      {formatGuildDisplayLabel({
                        display_name: entry.guild_display_name
                      })}
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <div className="text-sm text-[var(--text-secondary)]">
                    {entry.cluster_display_name}
                  </div>
                </td>
                <td className="p-4 text-right">
                  <div
                    className={`font-semibold ${selectedMetric === 'total' ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    {formatLeaderboardDamage(
                      entry.total_damage,
                      entry.is_obfuscated
                    )}
                  </div>
                </td>
                <td className="p-4 text-right">
                  <div
                    className={`font-semibold ${selectedMetric === 'average' ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    {formatLeaderboardDamage(
                      entry.avg_damage,
                      entry.is_obfuscated
                    )}
                  </div>
                </td>
                <td className="p-4 text-right">
                  <div className="text-[var(--text-secondary)]">
                    {entry.battle_count}
                  </div>
                </td>
                {selectedMetric === 'weighted' && (
                  <td className="p-4 text-right">
                    <div className="font-semibold text-[var(--accent)]">
                      {entry.performance_score?.toFixed(1)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.length === 0 && (
        <div className="p-4 sm:p-6 md:p-8 text-center text-[var(--text-secondary)]">
          No leaderboard data available yet
        </div>
      )}
    </div>
  )
}

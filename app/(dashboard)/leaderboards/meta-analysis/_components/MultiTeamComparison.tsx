'use client'

import type { TeamComposition } from '@tacticus/app-core/meta-analysis.types'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'
import {
  formatDamage,
  formatNumber,
  formatPercentage
} from '@tacticus/app-core/formatters'
import type { CompositionEntry, CompositionWrapper } from '../_types'

const hasCompositionProperty = (
  entry: CompositionEntry
): entry is CompositionWrapper =>
  typeof entry === 'object' && entry !== null && 'composition' in entry

const hasNestedComposition = (
  entry: CompositionEntry
): entry is CompositionWrapper & { composition: TeamComposition } =>
  hasCompositionProperty(entry) && Boolean(entry.composition)

const isTeamCompositionEntry = (
  entry: CompositionEntry
): entry is TeamComposition => !hasCompositionProperty(entry)

const extractComposition = (
  entry: CompositionEntry
): TeamComposition | null => {
  if (hasNestedComposition(entry)) {
    return entry.composition
  }

  if (isTeamCompositionEntry(entry)) {
    return entry
  }

  return null
}

const extractCategories = (entry: CompositionEntry): string[] => {
  const composition = extractComposition(entry)
  if (composition) {
    const categories =
      composition.categories?.filter((cat): cat is string =>
        Boolean(cat && cat.trim())
      ) ?? []
    if (categories.length > 0) {
      return categories
    }
    return composition.category ? [composition.category] : []
  }

  if (hasCompositionProperty(entry)) {
    const fallbackCategories =
      entry.categories?.filter((cat): cat is string =>
        Boolean(cat && cat.trim())
      ) ?? []
    if (fallbackCategories.length > 0) {
      return fallbackCategories
    }
    return entry.category ? [entry.category] : []
  }

  return []
}

export interface MultiTeamComparisonProps {
  teams: string[]
  allData: CompositionEntry[]
}

export function MultiTeamComparison({
  teams,
  allData
}: MultiTeamComparisonProps) {
  const calculateTeamStats = (teamName: string) => {
    const compositions = allData.reduce<TeamComposition[]>((acc, entry) => {
      const categories = extractCategories(entry)
      if (!categories.includes(teamName)) {
        return acc
      }

      const normalized = extractComposition(entry)
      if (normalized) {
        acc.push(normalized)
      }
      return acc
    }, [])

    if (compositions.length === 0) return null

    const totalBattles = compositions.reduce(
      (sum, c) => sum + (c.battlesCount || 0),
      0
    )
    if (totalBattles === 0) return null

    const avgDamage =
      compositions.reduce(
        (sum, c) => sum + (c.avgDamage || 0) * (c.battlesCount || 0),
        0
      ) / totalBattles

    const avgStability =
      compositions.reduce((sum, c) => sum + (c.stabilityScore || 50), 0) /
      compositions.length

    const damages = compositions.flatMap((c) =>
      Array(c.battlesCount || 1).fill(c.avgDamage || 0)
    )
    const variance =
      damages.reduce((sum, d) => sum + Math.pow(d - avgDamage, 2), 0) /
      damages.length
    const stdDev = Math.sqrt(variance)
    const coefficientOfVariation =
      avgDamage > 0 ? (stdDev / avgDamage) * 100 : 0

    const normalizedDamage = Math.min((avgDamage / 10000000) * 100, 100)
    const sharpeRatio =
      stdDev > 0
        ? normalizedDamage * 0.9 + avgStability * 0.1
        : normalizedDamage * 0.9

    return {
      teamName,
      avgDamage,
      avgStability,
      coefficientOfVariation,
      sharpeRatio,
      totalBattles,
      totalCompositions: compositions.length,
      bestComposition: compositions[0]
    }
  }

  const teamStats = teams
    .map(calculateTeamStats)
    .filter((s): s is NonNullable<typeof s> => s !== null)

  if (teamStats.length < 2) {
    return (
      <div className="text-secondary-wh40k text-center py-4">
        Not enough data available for selected teams
      </div>
    )
  }

  const winners = {
    recommended: teamStats.reduce<(typeof teamStats)[0] | null>(
      (prev, curr) =>
        !prev || curr.sharpeRatio > prev.sharpeRatio ? curr : prev,
      null
    ),
    highestDamage: teamStats.reduce<(typeof teamStats)[0] | null>(
      (prev, curr) => (!prev || curr.avgDamage > prev.avgDamage ? curr : prev),
      null
    ),
    mostConsistent: teamStats.reduce<(typeof teamStats)[0] | null>(
      (prev, curr) =>
        !prev || curr.avgStability > prev.avgStability ? curr : prev,
      null
    )
  }

  if (
    !winners.recommended ||
    !winners.highestDamage ||
    !winners.mostConsistent
  ) {
    return (
      <div className="text-secondary-wh40k text-center py-4">
        Unable to determine team rankings
      </div>
    )
  }

  const recommendedWinner = winners.recommended
  const highestDamageWinner = winners.highestDamage
  const mostConsistentWinner = winners.mostConsistent

  return (
    <div className="space-y-4">
      <div
        className={`grid grid-cols-1 gap-4 ${teams.length === 2 ? 'md:grid-cols-2' : teams.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}
      >
        {teamStats.map((stats) => {
          if (!stats) return null
          return (
            <div
              key={stats.teamName}
              className={`rounded-lg p-4 relative ${
                stats.teamName === recommendedWinner.teamName
                  ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--accent)_50%,transparent)] shadow-lg shadow-[color-mix(in_srgb,var(--accent)_20%,transparent)]'
                  : 'bg-card/30 border border-(--card-border)'
              }`}
            >
              {(stats.teamName === recommendedWinner.teamName ||
                stats.teamName === highestDamageWinner.teamName ||
                stats.teamName === mostConsistentWinner.teamName) && (
                <div className="absolute -top-3 left-0 right-0 flex justify-center gap-1 flex-wrap">
                  {stats.teamName === recommendedWinner.teamName && (
                    <span className="bg-accent-wh40k text-black text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1 shadow-lg">
                      RECOMMENDED
                    </span>
                  )}
                  {stats.teamName === highestDamageWinner.teamName && (
                    <span className="bg-[color-mix(in_srgb,var(--accent)_80%,transparent)] text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
                      HIGHEST DMG
                    </span>
                  )}
                  {stats.teamName === mostConsistentWinner.teamName && (
                    <span className="bg-yellow-600/80 text-black text-[10px] px-2 py-0.5 rounded-full font-medium">
                      MOST STABLE
                    </span>
                  )}
                </div>
              )}

              <h4
                className={`text-sm font-medium mb-3 ${
                  stats.teamName === recommendedWinner.teamName ||
                  stats.teamName === highestDamageWinner.teamName ||
                  stats.teamName === mostConsistentWinner.teamName
                    ? 'mt-4'
                    : ''
                }`}
              >
                {stats.teamName}
              </h4>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-secondary-wh40k">Avg Damage:</span>
                  <span
                    className={`font-mono ${
                      stats.teamName === highestDamageWinner.teamName
                        ? 'text-(--accent) font-bold'
                        : 'text-(--accent)'
                    }`}
                  >
                    {formatDamage(stats.avgDamage, 1)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-wh40k">Stability:</span>
                  <span
                    className={`${
                      stats.teamName === mostConsistentWinner.teamName
                        ? 'text-yellow-300 font-bold'
                        : 'text-(--primary)'
                    }`}
                  >
                    {formatPercentage(stats.avgStability / 100, 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-wh40k">CV%:</span>
                  <span className="text-secondary-wh40k font-mono">
                    {formatPercentage(stats.coefficientOfVariation / 100)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-wh40k">Sharpe Ratio:</span>
                  <span
                    className={`${
                      stats.teamName === recommendedWinner.teamName
                        ? 'text-(--accent) font-bold'
                        : 'text-(--accent)'
                    }`}
                  >
                    {formatNumber(stats.sharpeRatio, 1)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-wh40k">Total Battles:</span>
                  <span className="text-secondary-wh40k">
                    {stats.totalBattles}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-wh40k">Variations:</span>
                  <span className="text-secondary-wh40k">
                    {stats.totalCompositions}
                  </span>
                </div>
              </div>

              {stats.bestComposition && (
                <div className="mt-3 pt-3 border-t border-(--card-border)">
                  <div className="text-xs text-secondary-wh40k mb-1">
                    Top Comp:
                  </div>
                  <TeamCompositionDisplay
                    heroDetails={stats.bestComposition.heroDetails}
                    machineOfWarDetails={
                      stats.bestComposition.machineOfWarDetails
                    }
                    showNames={false}
                    iconSize={28}
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-secondary-wh40k mb-2">
          Analysis Summary
        </h4>
        <div className="text-xs text-secondary-wh40k space-y-1">
          <p>
            <span className="text-(--accent) font-medium">
              {recommendedWinner.teamName}
            </span>{' '}
            is recommended based on the best balance of damage output (
            {formatDamage(recommendedWinner.avgDamage, 1)}) and consistency (
            {formatPercentage(recommendedWinner.avgStability / 100, 0)}{' '}
            stability).
          </p>
          {highestDamageWinner.teamName !== recommendedWinner.teamName && (
            <p>
              <span className="text-(--accent) font-medium">
                {highestDamageWinner.teamName}
              </span>{' '}
              delivers the highest average damage at{' '}
              {formatDamage(highestDamageWinner.avgDamage, 1)} but with{' '}
              {highestDamageWinner.avgStability < recommendedWinner.avgStability
                ? 'lower'
                : 'comparable'}{' '}
              consistency.
            </p>
          )}
          {mostConsistentWinner.teamName !== recommendedWinner.teamName && (
            <p>
              <span className="text-(--primary) font-medium">
                {mostConsistentWinner.teamName}
              </span>{' '}
              offers the most consistent performance with{' '}
              {formatPercentage(mostConsistentWinner.avgStability / 100, 0)}{' '}
              stability but{' '}
              {mostConsistentWinner.avgDamage < recommendedWinner.avgDamage
                ? 'lower'
                : 'comparable'}{' '}
              damage output.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

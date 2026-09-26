'use client'

import type { Dispatch, SetStateAction } from 'react'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import { formatDamage, formatPercentage } from '@tacticus/app-core/formatters'
import type { BossAnalysis, BossComparisonStates } from '../_types'
import { getBossComparisonKey } from '../_types'
import { getStabilityBgColor, getStabilityColor } from '../_utils/stability'
import { MultiTeamComparison } from './MultiTeamComparison'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { Spinner } from '@tacticus/ui-kit'

const ITEMS_PER_PAGE = 10

export interface BossAnalysisPanelProps {
  analysis: BossAnalysis
  bossLabel: string
  selectedMetaTeams: Set<string>
  bossComparisonStates: BossComparisonStates
  setBossComparisonStates: Dispatch<SetStateAction<BossComparisonStates>>
  setBossAnalyses: Dispatch<SetStateAction<BossAnalysis[]>>
  onRetry?: () => void
}

export function BossAnalysisPanel({
  analysis,
  bossLabel,
  selectedMetaTeams,
  bossComparisonStates,
  setBossComparisonStates,
  setBossAnalyses,
  onRetry
}: BossAnalysisPanelProps) {
  const currentPage = analysis.currentPage || 1

  const filteredCompositions =
    selectedMetaTeams.size === 0
      ? analysis.compositions
      : analysis.compositions.filter((comp) => {
          const teamCategories =
            comp.categories || ([comp.category].filter(Boolean) as string[])
          return teamCategories.some((cat) => selectedMetaTeams.has(cat))
        })

  const totalPages = Math.ceil(filteredCompositions.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const currentCompositions = filteredCompositions.slice(startIndex, endIndex)

  // render(row) has no index, so pre-attach the externally-paginated rank.
  const rankedCompositions = currentCompositions.map((comp, compIndex) => ({
    comp,
    actualRank: startIndex + compIndex + 1
  }))
  type RankedComposition = (typeof rankedCompositions)[number]

  const compositionColumns: DataTableColumn<RankedComposition>[] = [
    {
      key: 'rank',
      header: 'Rank',
      sortable: false,
      render: (r) => `#${r.actualRank}`
    },
    {
      key: 'category',
      header: 'Category',
      sortable: false,
      render: (r) => (
        <MultipleCategoryBadges
          categories={r.comp.categories || [r.comp.category || 'Other']}
        />
      )
    },
    {
      key: 'composition',
      header: 'Team Composition',
      sortable: false,
      render: (r) => (
        <TeamCompositionDisplay
          heroDetails={r.comp.heroDetails}
          machineOfWarDetails={r.comp.machineOfWarDetails}
          showNames={false}
          iconSize={42}
          className="font-medium text-[var(--text-secondary)] text-xs max-w-xs"
        />
      )
    },
    {
      key: 'battles',
      header: 'Battles',
      sortable: false,
      align: 'center',
      render: (r) => r.comp.battlesCount
    },
    {
      key: 'min',
      header: 'Min',
      sortable: false,
      align: 'center',
      render: (r) => (
        <span className="text-[var(--accent)] font-mono">
          {formatDamage(r.comp.minDamage, 1)}
        </span>
      )
    },
    {
      key: 'avg',
      header: 'Avg',
      sortable: false,
      align: 'center',
      render: (r) => (
        <span className="text-[var(--accent)] font-mono font-medium">
          {formatDamage(r.comp.avgDamage, 1)}
        </span>
      )
    },
    {
      key: 'max',
      header: 'Max',
      sortable: false,
      align: 'center',
      render: (r) => (
        <span className="text-green-400 font-mono">
          {formatDamage(r.comp.maxDamage, 1)}
        </span>
      )
    },
    {
      key: 'stability',
      header: 'Stability',
      sortable: false,
      align: 'center',
      render: (r) => (
        <div
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${getStabilityBgColor(r.comp.stabilityRank)}`}
        >
          <span
            className={`font-medium ${getStabilityColor(r.comp.stabilityRank)}`}
          >
            {r.comp.stabilityRank}
          </span>
        </div>
      )
    },
    {
      key: 'cv',
      header: 'CV%',
      sortable: false,
      align: 'center',
      render: (r) => (
        <span className="font-mono">
          {Number.isFinite(r.comp.coefficientOfVariation)
            ? formatPercentage((r.comp.coefficientOfVariation ?? 0) / 100, 1)
            : '—'}
        </span>
      )
    },
    {
      key: 'players',
      header: 'Players',
      sortable: false,
      align: 'center',
      render: (r) => r.comp.playerCount
    },
    {
      key: 'guilds',
      header: 'Guilds',
      sortable: false,
      align: 'center',
      render: (r) => r.comp.guildCount
    }
  ]

  const bossKey = getBossComparisonKey(analysis)
  const bossComparisonState = bossComparisonStates[bossKey] || {
    showComparison: true,
    compareTeams: ['', '', '', '']
  }
  const showBossComparison = bossComparisonState.showComparison
  const bossCompareTeams = bossComparisonState.compareTeams

  const teams = new Set<string>()
  filteredCompositions.forEach((comp) => {
    if (comp.categories && comp.categories.length > 0) {
      comp.categories.forEach((cat: string) => teams.add(cat))
    } else if (comp.category) {
      teams.add(comp.category)
    }
  })
  const bossMetaTeams = Array.from(teams).sort()

  const handlePageChange = (newPage: number) => {
    setBossAnalyses((prev) =>
      prev.map((a) =>
        a.rarity === analysis.rarity &&
        a.set === analysis.set &&
        a.encounterId === analysis.encounterId
          ? { ...a, currentPage: newPage }
          : a
      )
    )
  }

  return (
    <div
      key={`${analysis.rarity}-${analysis.set}-${analysis.encounterId}`}
      className="card-wh40k p-3 sm:p-4"
    >
      <div className="flex justify-between items-center mb-4">
        <h3 className="subheading-wh40k text-[var(--accent)]">
          {bossLabel}: {getBossDisplayName(analysis.bossName)}
        </h3>
        <div className="flex items-center gap-3">
          {analysis.compositions.length > 0 && (
            <button
              onClick={() => {
                setBossComparisonStates((prev) => ({
                  ...prev,
                  [bossKey]: {
                    ...bossComparisonState,
                    showComparison: !showBossComparison
                  }
                }))
              }}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                showBossComparison
                  ? 'bg-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_80%,transparent)] text-black'
                  : 'bg-[var(--card-bg)] hover:bg-[var(--card-bg)] text-[var(--text-primary)]'
              }`}
            >
              {showBossComparison
                ? 'Hide Team Comparison'
                : 'Show Team Comparison'}
            </button>
          )}
          {analysis.compositions.length > ITEMS_PER_PAGE && (
            <div className="text-sm text-[var(--text-secondary)]">
              Total: {analysis.compositions.length} teams
            </div>
          )}
        </div>
      </div>

      {showBossComparison && analysis.compositions.length > 0 && (
        <div className="bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded-lg p-4 mb-4 border border-[var(--card-border)]">
          <h4 className="text-sm font-medium text-[var(--accent)] mb-3">
            Compare Teams for {getBossDisplayName(analysis.bossName)}
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            {[0, 1, 2, 3].map((teamSlot) => (
              <div key={`team-selector-${bossKey}-${teamSlot}`}>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">
                  Team {teamSlot + 1}
                </label>
                <select
                  value={bossCompareTeams[teamSlot]}
                  onChange={(e) => {
                    const newTeams = [...bossCompareTeams]
                    newTeams[teamSlot] = e.target.value
                    setBossComparisonStates((prev) => ({
                      ...prev,
                      [bossKey]: {
                        ...bossComparisonState,
                        compareTeams: newTeams
                      }
                    }))
                  }}
                  className="w-full px-2 py-1 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="">Select Team</option>
                  {bossMetaTeams.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {bossCompareTeams.filter((t) => t).length >= 2 && (
            <MultiTeamComparison
              teams={bossCompareTeams.filter((t) => t)}
              allData={analysis.compositions}
            />
          )}
        </div>
      )}

      {analysis.loading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner size="md" className="text-cyan-400" />
          <span className="ml-2 text-[var(--text-secondary)]">
            Loading {bossLabel} analysis...
          </span>
        </div>
      ) : analysis.error ? (
        <div className="text-[var(--accent)] text-center py-4">
          {analysis.error}
        </div>
      ) : analysis.compositions.length === 0 &&
        analysis.source === 'fallback-error' ? (
        <div className="text-[var(--accent)] text-center py-6">
          <div className="text-sm font-medium mb-1">
            We couldn&apos;t load meta analysis right now. Try again.
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 px-3 py-1.5 text-xs rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      ) : analysis.compositions.length === 0 &&
        analysis.source === 'fallback-disabled' ? (
        <div className="text-[var(--text-secondary)] text-center py-6">
          <div className="text-sm font-medium mb-1">
            Meta analysis is currently disabled
          </div>
        </div>
      ) : analysis.compositions.length === 0 ? (
        <div className="text-[var(--text-secondary)] text-center py-6">
          <div className="text-sm font-medium mb-1">
            No team compositions found
          </div>
          <div className="text-xs opacity-75">
            Insufficient battle data for this boss
          </div>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block">
            <DataTable
              rows={rankedCompositions}
              columns={compositionColumns}
              rowKey={(r) => r.comp.compositionKey}
              // Deliberately dense; descendant selectors override DataTable's text-sm/p-3.
              tableClassName="[&_td]:text-xs [&_td]:px-0 [&_td]:py-2"
              empty={<></>}
            />
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-3">
            {currentCompositions.map((comp, compIndex) => {
              const actualRank = startIndex + compIndex + 1
              return (
                <div
                  key={comp.compositionKey}
                  className="bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded-lg p-3"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-[var(--text-secondary)] text-sm">
                      #{actualRank}
                    </div>
                    <div
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${getStabilityBgColor(comp.stabilityRank)}`}
                    >
                      <span
                        className={`font-medium ${getStabilityColor(comp.stabilityRank)}`}
                      >
                        {comp.stabilityRank}
                      </span>
                    </div>
                  </div>

                  <div className="mb-3">
                    <MultipleCategoryBadges
                      categories={comp.categories || [comp.category || 'Other']}
                    />
                  </div>

                  <div className="mb-3">
                    <TeamCompositionDisplay
                      heroDetails={comp.heroDetails}
                      machineOfWarDetails={comp.machineOfWarDetails}
                      showNames={false}
                      iconSize={36}
                      className="font-medium text-[var(--text-secondary)] text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center">
                      <div className="text-[var(--text-secondary)] mb-1">
                        Battles
                      </div>
                      <div className="text-[var(--text-secondary)] font-medium">
                        {comp.battlesCount}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[var(--text-secondary)] mb-1">
                        Avg Damage
                      </div>
                      <div className="text-[var(--accent)] font-mono font-medium">
                        {formatDamage(comp.avgDamage, 1)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[var(--text-secondary)] mb-1">
                        CV%
                      </div>
                      <div className="text-[var(--text-secondary)] font-mono">
                        {Number.isFinite(comp.coefficientOfVariation)
                          ? formatPercentage(
                              (comp.coefficientOfVariation ?? 0) / 100,
                              1
                            )
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-[var(--card-border)]">
                    <div>
                      <span className="text-[var(--accent)] font-mono">
                        {formatDamage(comp.minDamage, 1)}
                      </span>
                      <span className="text-[var(--text-secondary)] mx-1">
                        min
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--text-secondary)] mx-1">
                        max
                      </span>
                      <span className="text-green-400 font-mono">
                        {formatDamage(comp.maxDamage, 1)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-4">
              <button
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-[var(--card-bg)] hover:bg-[var(--card-bg)] disabled:opacity-50 disabled:cursor-not-allowed text-sm rounded"
              >
                Previous
              </button>

              <span className="text-sm text-[var(--text-secondary)]">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() =>
                  handlePageChange(Math.min(totalPages, currentPage + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-[var(--card-bg)] hover:bg-[var(--card-bg)] disabled:opacity-50 disabled:cursor-not-allowed text-sm rounded"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

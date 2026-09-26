'use client'

import type { RecommendedTeam } from '@tacticus/app-core/meta-analysis.types'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import { formatDamage } from '@tacticus/app-core/formatters'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { Spinner } from '@tacticus/ui-kit'
import {
  MOBILE_SKELETON_IDS,
  PARTICLE_IDS_10,
  SKELETON_HERO_IDS,
  SKELETON_ROW_IDS
} from '../_constants'
import { getStabilityBgColor, getStabilityColor } from '../_utils/stability'
import { getPseudoRandom } from '../_utils/pseudo-random'
import type { MetaAnalysisSource } from '../_types'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

// Accent colours live in the render output: `column.className` races DataTable's <td> colour.
const recommendedTeamColumns: DataTableColumn<RecommendedTeam>[] = [
  {
    key: 'boss',
    header: 'Boss',
    sortable: false,
    // font-mono on the span: col.className also hits the <th>.
    render: (team) => (
      <span className="font-mono text-[var(--accent)]">
        {team.levelString} {getBossDisplayName(team.bossName)}
      </span>
    )
  },
  {
    key: 'category',
    header: 'Category',
    sortable: false,
    render: (team) => (
      <MultipleCategoryBadges
        categories={
          team.composition.categories || [team.composition.category || 'Other']
        }
      />
    )
  },
  {
    key: 'composition',
    header: 'Team Composition',
    sortable: false,
    render: (team) => (
      <TeamCompositionDisplay
        heroDetails={team.composition.heroDetails}
        machineOfWarDetails={team.composition.machineOfWarDetails}
        showNames={false}
        iconSize={48}
        className="font-medium text-[var(--text-secondary)]"
      />
    )
  },
  {
    key: 'battles',
    header: 'Battles',
    align: 'center',
    sortable: false,
    render: (team) => team.composition.battlesCount
  },
  {
    key: 'avgDamage',
    header: 'Avg Damage',
    align: 'center',
    sortable: false,
    render: (team) => (
      <span className="text-[var(--accent)] font-mono">
        {formatDamage(team.composition.avgDamage, 1)}
      </span>
    )
  },
  {
    key: 'stability',
    header: 'Stability',
    align: 'center',
    sortable: false,
    render: (team) => (
      <div
        className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${getStabilityBgColor(team.composition.stabilityRank)}`}
      >
        <span
          className={`font-medium ${getStabilityColor(team.composition.stabilityRank)}`}
        >
          {team.composition.stabilityRank}
        </span>
        <span className="ml-1 text-[var(--text-secondary)]">
          ({Math.round(team.composition.stabilityScore)}%)
        </span>
      </div>
    )
  },
  {
    key: 'players',
    header: 'Players',
    align: 'center',
    sortable: false,
    render: (team) => team.composition.playerCount
  },
  {
    key: 'guilds',
    header: 'Guilds',
    align: 'center',
    sortable: false,
    render: (team) => team.composition.guildCount
  }
]

const recommendedTeamRowKey = (team: RecommendedTeam) =>
  `${team.rarity}-${team.set}-${team.bossName}-${team.composition.compositionKey}`

const recommendedTeamRowClassName = (team: RecommendedTeam) =>
  team.rarity === 'Mythic'
    ? // Side-specific border-l: an all-sides colour would race the border-b separator.
      'bg-orange-900/10 border-l-4 border-l-orange-500'
    : 'bg-cyan-900/10 border-l-4 border-l-cyan-400'

type RecommendedTeamSkeletonRow = { id: string }

const recommendedTeamSkeletonRows: RecommendedTeamSkeletonRow[] =
  SKELETON_ROW_IDS.map((id) => ({ id }))

const renderRecommendedTeamSkeletonCell = (
  columnKey: string,
  rowId: string
) => {
  switch (columnKey) {
    case 'boss':
      return <div className="h-4 w-24 rounded bg-card/70" />
    case 'category':
      return <div className="h-6 w-20 rounded bg-card/70" />
    case 'composition':
      return (
        <div className="flex gap-1">
          {SKELETON_HERO_IDS.map((heroId) => (
            <div
              key={`${rowId}-${heroId}`}
              className="h-8 w-8 rounded bg-card/70"
            />
          ))}
        </div>
      )
    case 'avgDamage':
    case 'stability':
      return <div className="mx-auto h-4 w-16 rounded bg-card/70" />
    case 'battles':
      return <div className="mx-auto h-4 w-12 rounded bg-card/70" />
    default:
      return <div className="mx-auto h-4 w-8 rounded bg-card/70" />
  }
}

// Headers derive from the live contract, so loading cannot drift into a second table.
const recommendedTeamSkeletonColumns: DataTableColumn<RecommendedTeamSkeletonRow>[] =
  recommendedTeamColumns.map((column) => ({
    key: column.key,
    header: column.header,
    align: column.align,
    sortable: false,
    className: column.className,
    headerTitle: column.headerTitle,
    render: (row) => renderRecommendedTeamSkeletonCell(column.key, row.id)
  }))

export interface RecommendedTeamsPanelProps {
  recommendedTeams: RecommendedTeam[]
  recommendedLoading: boolean
  levelFilter: string
  selectedMetaTeams: Set<string>
  /** `'fallback-error'` = RPC failed behind a 200 empty; `'fallback-disabled'` = feature off. */
  source?: MetaAnalysisSource | null
  onRetry?: () => void
}

export function RecommendedTeamsPanel({
  recommendedTeams,
  recommendedLoading,
  levelFilter,
  selectedMetaTeams,
  source = null,
  onRetry
}: RecommendedTeamsPanelProps) {
  const filterTeam = (team: RecommendedTeam): boolean => {
    if (levelFilter !== 'all' && team.levelString !== levelFilter) return false
    if (selectedMetaTeams.size === 0) return true
    const teamCategories =
      team.composition.categories ||
      ([team.composition.category].filter(Boolean) as string[])
    return teamCategories.some((cat) => selectedMetaTeams.has(cat))
  }

  return (
    <div className="card-wh40k p-3 sm:p-4">
      <h2 className="subheading-wh40k text-[var(--accent)] mb-4">
        Recommended Teams
      </h2>

      {recommendedLoading ? (
        <RecommendedTeamsSkeleton />
      ) : recommendedTeams.length === 0 && source === 'fallback-error' ? (
        <div className="text-[var(--accent)] text-center py-8">
          <div className="text-lg font-medium mb-2">
            We couldn&apos;t load meta analysis right now. Try again.
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 px-4 py-2 text-sm rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      ) : recommendedTeams.length === 0 && source === 'fallback-disabled' ? (
        <div className="text-[var(--text-secondary)] text-center py-8">
          <div className="text-lg font-medium mb-2">
            Meta analysis is currently disabled
          </div>
          <div className="text-sm">
            Recommended teams are turned off for this environment.
          </div>
        </div>
      ) : recommendedTeams.length === 0 ? (
        <div className="text-[var(--text-secondary)] text-center py-8">
          <div className="text-lg font-medium mb-2">
            No recommended teams found
          </div>
          <div className="text-sm">
            Try adjusting filters or check if there are enough battles for the
            current season.
          </div>
          <div className="text-xs mt-2 opacity-75">
            Meta analysis requires sufficient battle data to generate meaningful
            team recommendations.
          </div>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block">
            <DataTable
              rows={recommendedTeams.filter(filterTeam)}
              columns={recommendedTeamColumns}
              rowKey={recommendedTeamRowKey}
              rowClassName={recommendedTeamRowClassName}
              // A post-filter empty result renders an empty tbody, so suppress DataTable's copy.
              empty={<></>}
            />
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-4">
            {recommendedTeams.filter(filterTeam).map((team) => {
              const isMythic = team.rarity === 'Mythic'
              const teamKey = `${team.rarity}-${team.set}-${team.bossName}-${team.composition.compositionKey}`
              const compositionSeed = team.composition.compositionKey
                .split('')
                .reduce((acc, char) => acc + char.charCodeAt(0), 0)

              return (
                <div
                  key={teamKey}
                  className={`relative overflow-hidden rounded-lg p-6 ${
                    isMythic ? 'mythic-section' : 'diamond-section'
                  }`}
                >
                  {isMythic
                    ? PARTICLE_IDS_10.map((particleId, idx) => {
                        const seed = compositionSeed * 100 + idx
                        return (
                          <div
                            key={`mythic-particle-${teamKey}-${particleId}`}
                            className="mythic-particle"
                            style={{
                              left: `${getPseudoRandom(seed, 100)}%`,
                              animationDelay: `${getPseudoRandom(seed + 1, 7)}s`,
                              width: `${3 + getPseudoRandom(seed + 2, 3)}px`,
                              height: `${3 + getPseudoRandom(seed + 3, 3)}px`,
                              background: `radial-gradient(circle, rgba(255, ${140 + getPseudoRandom(seed + 4, 55)}, 0, 0.8) 0%, transparent 70%)`
                            }}
                          />
                        )
                      })
                    : PARTICLE_IDS_10.map((particleId, idx) => {
                        const seed = compositionSeed * 100 + idx
                        return (
                          <div
                            key={`diamond-particle-${teamKey}-${particleId}`}
                            className="diamond-particle"
                            style={{
                              left: `${getPseudoRandom(seed, 100)}%`,
                              animationDelay: `${getPseudoRandom(seed + 1, 8)}s`,
                              width: `${2 + getPseudoRandom(seed + 2, 2)}px`,
                              height: `${2 + getPseudoRandom(seed + 3, 2)}px`,
                              background: `radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%)`
                            }}
                          />
                        )
                      })}

                  <div className="relative z-10">
                    <div className="mb-4">
                      <h3
                        className={`text-lg font-bold ${isMythic ? 'mythic-title' : 'diamond-title'}`}
                      >
                        {team.levelString} {getBossDisplayName(team.bossName)}
                      </h3>
                      <div className="mt-2">
                        <MultipleCategoryBadges
                          categories={
                            team.composition.categories || [
                              team.composition.category || 'Other'
                            ]
                          }
                        />
                      </div>
                    </div>

                    <div className="mb-4">
                      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                        Team Composition
                      </div>
                      <TeamCompositionDisplay
                        heroDetails={team.composition.heroDetails}
                        machineOfWarDetails={
                          team.composition.machineOfWarDetails
                        }
                        showNames={false}
                        iconSize={64}
                        className="font-medium text-[var(--text-secondary)]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[color-mix(in_srgb,var(--bg-primary)_20%,transparent)] rounded-lg p-3">
                        <div className="text-xs text-[var(--text-secondary)] mb-1">
                          Avg Damage
                        </div>
                        <div
                          className={`text-lg font-bold ${isMythic ? 'text-[var(--accent)]' : 'text-[var(--accent)]'}`}
                        >
                          {formatDamage(team.composition.avgDamage, 1)}
                        </div>
                      </div>

                      <div className="bg-[color-mix(in_srgb,var(--bg-primary)_20%,transparent)] rounded-lg p-3">
                        <div className="text-xs text-[var(--text-secondary)] mb-1">
                          Stability
                        </div>
                        <div
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${getStabilityBgColor(team.composition.stabilityRank)}`}
                        >
                          <span
                            className={`font-medium ${getStabilityColor(team.composition.stabilityRank)}`}
                          >
                            {team.composition.stabilityRank}
                          </span>
                          <span className="ml-1 text-[var(--text-secondary)]">
                            ({Math.round(team.composition.stabilityScore)}%)
                          </span>
                        </div>
                      </div>

                      <div className="bg-[color-mix(in_srgb,var(--bg-primary)_20%,transparent)] rounded-lg p-3">
                        <div className="text-xs text-[var(--text-secondary)] mb-1">
                          Uses
                        </div>
                        <div className="text-[var(--text-secondary)] font-medium">
                          {team.composition.battlesCount} battles
                        </div>
                      </div>

                      <div className="bg-[color-mix(in_srgb,var(--bg-primary)_20%,transparent)] rounded-lg p-3">
                        <div className="text-xs text-[var(--text-secondary)] mb-1">
                          Adoption
                        </div>
                        <div className="text-[var(--text-secondary)] font-medium">
                          {team.composition.playerCount} players •{' '}
                          {team.composition.guildCount} guilds
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function RecommendedTeamsSkeleton() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center justify-center z-10 bg-[color-mix(in_srgb,var(--bg-primary)_30%,transparent)] backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-[var(--card-border)] rounded-full"></div>
            <Spinner
              size="lg"
              className="absolute left-0 top-0 h-16 w-16 text-cyan-400"
            />
          </div>
          <div className="text-[var(--accent)] text-base font-medium animate-pulse">
            Analyzing Recommended Teams...
          </div>
          <div className="text-[var(--text-secondary)] text-sm text-center max-w-xs">
            Finding the best team compositions across all bosses
          </div>
        </div>
      </div>

      <div className="hidden lg:block opacity-50" aria-hidden="true">
        <DataTable
          rows={recommendedTeamSkeletonRows}
          columns={recommendedTeamSkeletonColumns}
          rowKey={(row) => row.id}
          rowClassName={() => 'animate-pulse'}
        />
      </div>

      <div className="lg:hidden space-y-3 opacity-50">
        {MOBILE_SKELETON_IDS.map((mobileId) => (
          <div
            key={mobileId}
            className="animate-pulse bg-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] rounded-lg p-4"
          >
            <div className="flex justify-between mb-3">
              <div className="h-5 bg-card/70 hover:bg-card/80 transition-colors duration-200 rounded w-24"></div>
              <div className="h-5 bg-card/70 hover:bg-card/80 transition-colors duration-200 rounded w-16"></div>
            </div>
            <div className="flex gap-1 mb-3">
              {SKELETON_HERO_IDS.map((heroId) => (
                <div
                  key={`${mobileId}-${heroId}`}
                  className="h-12 w-12 bg-card/70 hover:bg-card/80 transition-colors duration-200 rounded"
                ></div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="h-4 bg-card/70 hover:bg-card/80 transition-colors duration-200 rounded"></div>
              <div className="h-4 bg-card/70 hover:bg-card/80 transition-colors duration-200 rounded"></div>
              <div className="h-4 bg-card/70 hover:bg-card/80 transition-colors duration-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

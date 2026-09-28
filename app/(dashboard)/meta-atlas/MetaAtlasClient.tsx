'use client'

import { useMemo, useState } from 'react'
import { useBossData } from '@/app/lib/hooks/shared'
import { DataErrorBoundary } from '@/app/components/error/DataErrorBoundary'
import { Card, CardContent, Tabs } from '@tacticus/ui-kit'
import { Crown, TrendingUp, Users, Calendar } from 'lucide-react'
import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import type { ReleaseStage } from '@/app/lib/utils/release-stage'
import { BestTeamsTab, type DensityMode } from './components/BestTeamsTab'
import { MetaAtlasTeamsTab } from './components/MetaAtlasTeamsTab'
import { ContextualMetaScopeLinks } from './components/MetaScopeLinks'
import { MetaTrends } from './components/MetaTrends'
import { PersonalBenchmarksSection } from './components/PersonalBenchmarksSection'
import MyGuildTab from './components/MyGuildTab'
import { useMetaFilters } from './hooks/useMetaFilters'
import { useBossResolution } from './hooks/useBossResolution'
import { useMetaAtlasFiltersState } from './hooks/useMetaAtlasFiltersState'
import { useMetaAtlasPersonalization } from './hooks/useMetaAtlasPersonalization'
import { useMetaAtlasRecommendations } from './hooks/useMetaAtlasRecommendations'
import { useRosterContext } from './hooks/useRosterContext'
import { useRosterRoi } from './hooks/useRosterRoi'

/** Stable kebab-case `?tab=` values, decoupled from labels so shared links survive renames. */
const TAB_BEST_TEAMS = 'best-teams'
const TAB_TEAM_IDEAS = 'team-ideas'
const TAB_YOUR_GAPS = 'your-gaps'
const TAB_MY_GUILD = 'my-guild'
const TAB_TRENDS = 'trends'

/** Retired tab ids → replacement (pre-Best Teams merge). */
const LEGACY_TAB_ALIASES: Readonly<Record<string, string>> = {
  'top-teams': TAB_BEST_TEAMS,
  global: TAB_BEST_TEAMS,
  potential: TAB_TEAM_IDEAS,
  benchmarks: TAB_YOUR_GAPS
}

interface MetaAtlasClientProps {
  guildCode: string
  userDisplayName?: string
  releaseStage?: ReleaseStage | null
}

export function MetaAtlasClient({
  guildCode,
  userDisplayName = '',
  releaseStage
}: MetaAtlasClientProps) {
  const { filters, loading: filtersLoading } = useMetaFilters()
  // Compact is the default: it matches the old landing tab and needs no private data.
  const [bestTeamsDensity, setBestTeamsDensity] =
    useState<DensityMode>('compact')
  const { bosses: catalogBosses } = useBossData()
  const { resolveBoss } = useBossResolution(catalogBosses)

  // "My Guild" is members-only; the filters hook uses this to reject a stale `?tab=my-guild`.
  const tabOptions = useMemo(
    () => ({
      tabIds: guildCode
        ? [
            TAB_BEST_TEAMS,
            TAB_TEAM_IDEAS,
            TAB_YOUR_GAPS,
            TAB_MY_GUILD,
            TAB_TRENDS
          ]
        : [TAB_BEST_TEAMS, TAB_TEAM_IDEAS, TAB_YOUR_GAPS, TAB_TRENDS],
      defaultTab: TAB_BEST_TEAMS,
      aliases: LEGACY_TAB_ALIASES
    }),
    [guildCode]
  )

  const {
    selectedSeason,
    availableSeasons,
    availableRaritySets,
    selectedRaritySets,
    selectedMetaTeams,
    bossFilter,
    debouncedBossFilter,
    showAllBosses,
    setSelectedSeason,
    setBossFilter,
    toggleShowAllBosses,
    toggleRaritySet,
    selectAllRaritySets,
    clearRaritySets,
    toggleMetaTeam,
    clearMetaTeams,
    activeTab,
    setActiveTab
  } = useMetaAtlasFiltersState(filters, null, tabOptions)

  const currentSeason = selectedSeason || filters?.current_season || ''
  const previousSeason = filters?.previous_season || ''

  // Private player data is fetched only for Team Ideas, the only view that renders it.
  const isBestTeamsTab = activeTab === TAB_BEST_TEAMS
  const isTeamIdeasTab = activeTab === TAB_TEAM_IDEAS
  const needsPersonalization = isTeamIdeasTab

  const {
    heroMappings,
    rosterEntries,
    rosterNames,
    rosterSignature,
    rosterQuery,
    hasRoster,
    abilityNotice
  } = useRosterContext({ rosterEnabled: needsPersonalization })
  const canPersonalize = hasRoster

  const {
    currentTeams,
    currentTeamsLookup,
    currentTeamsLoading,
    personalizedPayload
  } = useMetaAtlasPersonalization({
    season: currentSeason,
    canPersonalize,
    enabled: needsPersonalization,
    rosterEntries,
    rosterSignature,
    rosterNames
  })

  // Heavy batches are scoped to the tab that renders them; header inputs are never gated.
  const rosterSignatureKey = rosterSignature || String(rosterNames.length)
  const rosterRoiQuery = useRosterRoi({
    rosterEntries,
    season: currentSeason,
    currentTeams,
    rosterSignatureKey,
    // The ROI widget renders only on Team Ideas, so its batch follows that tab.
    enabled: isTeamIdeasTab && rosterNames.length > 0 && !!currentSeason
  })
  const rosterRoiEntries = rosterRoiQuery.data?.results || []

  const globalRecommendations = useMetaAtlasRecommendations({
    filters,
    showAllBosses,
    bossFilter: debouncedBossFilter,
    resolveBoss,
    selectedRaritySets,
    selectedMetaTeams,
    currentSeason,
    personalizedPayload: undefined,
    enabled: isBestTeamsTab
  })

  const personalRecommendations = useMetaAtlasRecommendations({
    filters,
    showAllBosses,
    bossFilter: debouncedBossFilter,
    resolveBoss,
    selectedRaritySets,
    selectedMetaTeams,
    currentSeason,
    personalizedPayload,
    // Do not fall through to the global query while the roster request is pending.
    requirePersonalized: rosterQuery.isLoading || canPersonalize,
    enabled: isTeamIdeasTab
  })
  const displayBosses = globalRecommendations.displayBosses
  const globalGroupedByRaritySet = globalRecommendations.groupedByRaritySet
  const globalRecsLoading = globalRecommendations.recsLoading
  const personalGroupedByRaritySet = personalRecommendations.groupedByRaritySet
  const personalRecsLoading = personalRecommendations.recsLoading
  // Chips come from the batch the tab rendered; the global batch is empty on Team Ideas.
  const globalMetaTeams = globalRecommendations.availableMetaTeams
  const personalMetaTeams = personalRecommendations.availableMetaTeams

  const firstSelectedRaritySet =
    selectedRaritySets.size > 0
      ? (Array.from(selectedRaritySets)[0] ?? '')
      : (availableRaritySets[0] ?? '')

  const bestTeamsContent = (
    <BestTeamsTab
      density={bestTeamsDensity}
      onDensityChange={setBestTeamsDensity}
      filters={filters}
      filtersLoading={filtersLoading}
      recsLoading={globalRecsLoading}
      heroMappings={heroMappings}
      groupedByRaritySet={globalGroupedByRaritySet}
      displayBossCount={displayBosses.length}
      availableMetaTeams={globalMetaTeams}
      availableRaritySets={availableRaritySets}
      filterControls={{
        bossFilter,
        onBossFilterChange: setBossFilter,
        showAllBosses,
        onToggleShowAll: toggleShowAllBosses,
        selectedRaritySets,
        onToggleRaritySet: toggleRaritySet,
        onSelectAllRaritySets: selectAllRaritySets,
        onClearRaritySets: clearRaritySets,
        selectedMetaTeams,
        onToggleMetaTeam: toggleMetaTeam,
        onClearMetaTeams: clearMetaTeams,
        displayBossCount: displayBosses.length
      }}
      currentSeason={currentSeason}
    />
  )

  const potentialContent = (
    <MetaAtlasTeamsTab
      filters={filters}
      filtersLoading={filtersLoading}
      recsLoading={personalRecsLoading}
      heroMappings={heroMappings}
      rosterEntries={rosterEntries}
      rosterRoiEntries={rosterRoiEntries}
      rosterRoiLoading={rosterRoiQuery.isLoading}
      rosterRoiMessage={rosterRoiQuery.data?.message}
      rosterError={rosterQuery.error}
      hasRoster={hasRoster}
      abilityNotice={abilityNotice}
      canPersonalize={canPersonalize}
      currentTeamsLoading={currentTeamsLoading}
      currentTeamsLookup={currentTeamsLookup}
      groupedByRaritySet={personalGroupedByRaritySet}
      displayBossCount={displayBosses.length}
      availableMetaTeams={personalMetaTeams}
      availableRaritySets={availableRaritySets}
      filterControls={{
        bossFilter,
        onBossFilterChange: setBossFilter,
        showAllBosses,
        onToggleShowAll: toggleShowAllBosses,
        selectedRaritySets,
        onToggleRaritySet: toggleRaritySet,
        onSelectAllRaritySets: selectAllRaritySets,
        onClearRaritySets: clearRaritySets,
        selectedMetaTeams,
        onToggleMetaTeam: toggleMetaTeam,
        onClearMetaTeams: clearMetaTeams,
        displayBossCount: displayBosses.length
      }}
      currentSeason={currentSeason}
      defaultViewMode="personal"
      showViewToggle={false}
      showRosterRoi={true}
    />
  )

  const trendsContent = (
    <DataErrorBoundary fallbackMessage="Failed to load meta trends">
      <MetaTrends
        currentSeason={currentSeason}
        previousSeason={previousSeason}
        raritySet={firstSelectedRaritySet}
      />
    </DataErrorBoundary>
  )

  const benchmarksContent = (
    <DataErrorBoundary fallbackMessage="Failed to load performance benchmarks">
      <PersonalBenchmarksSection
        guildCode={guildCode}
        userDisplayName={userDisplayName}
      />
    </DataErrorBoundary>
  )

  const tabs = [
    { id: TAB_BEST_TEAMS, label: 'Best Teams', content: bestTeamsContent },
    {
      id: TAB_TEAM_IDEAS,
      label: 'Team Ideas For You',
      content: potentialContent
    },
    { id: TAB_YOUR_GAPS, label: 'Your Gaps', content: benchmarksContent },
    ...(guildCode
      ? [
          {
            id: TAB_MY_GUILD,
            label: 'My Guild',
            content: (
              <DataErrorBoundary fallbackMessage="Failed to load your guild's meta">
                <MyGuildTab guildCode={guildCode} />
              </DataErrorBoundary>
            )
          }
        ]
      : []),
    { id: TAB_TRENDS, label: 'Meta Trends', content: trendsContent }
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 w-full">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <TrendingUp className="w-6 h-6 text-purple-400" />
              Towen&apos;s Meta Atlas
              {releaseStage && releaseStage !== 'public' && (
                <ReleaseStageBadge stage={releaseStage} size="md" />
              )}
            </h1>
            <p className="text-secondary-wh40k mt-1">
              Best-performing team compositions based on aggregated data across
              all guilds
            </p>
            {/* Scope-labelled cross-links between the "meta" surfaces. */}
            <ContextualMetaScopeLinks />
          </div>

          {availableSeasons.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <Calendar className="w-4 h-4 text-secondary-wh40k" />
              <label
                htmlFor="meta-season-select"
                className="text-sm text-secondary-wh40k"
              >
                Season:
              </label>
              <select
                id="meta-season-select"
                value={currentSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                className="min-h-11 px-3 py-1.5 rounded-sm bg-(--card-bg) border border-(--card-border) text-white text-sm focus:border-purple-500 focus:outline-hidden cursor-pointer"
              >
                {availableSeasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <Tabs
        tabs={tabs}
        value={activeTab}
        onChange={setActiveTab}
        defaultTab={TAB_BEST_TEAMS}
      />

      {/* Promo above the explainer so content closes the page. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-purple-500/30 bg-linear-to-r from-purple-500/10 to-indigo-500/10 px-4 py-2.5 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="text-purple-200 font-medium">
            Support the Developer
          </span>
          <span className="text-purple-400/70 hidden sm:inline">·</span>
          <span className="text-purple-400/70 truncate">
            Please support Towen with his referral code
          </span>
        </div>
        <span className="sm:ml-auto shrink-0 rounded-md border border-purple-500/40 bg-purple-500/20 px-3 py-1 font-mono font-bold tracking-wide text-purple-200">
          NOD-08-POD
        </span>
      </div>

      <Card className="bg-card/50 border-(--card-border)">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-sm text-secondary-wh40k space-y-2">
              <p>
                <strong className="text-primary-wh40k">How it works:</strong>{' '}
                Meta Atlas aggregates anonymized battle data from all guilds to
                identify the highest-performing team compositions.
              </p>
              <p>
                <strong className="text-primary-wh40k">P90 damage</strong> means
                90% of attacks with this team deal less damage — this is the
                damage top performers achieve.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <span className="text-secondary-wh40k text-xs">
                  Sample size:
                </span>
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-secondary-wh40k">
                    100+ attacks (high)
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  <span className="text-secondary-wh40k">30-99 (medium)</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-orange-400" />
                  <span className="text-secondary-wh40k">&lt;30 (low)</span>
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

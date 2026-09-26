'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, History, Package, Equal, Key } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { TeamComparisonView, parseTeamComposition } from './TeamComparisonView'
import { useMetaAtlasTeamFloor } from '../hooks/useMetaAtlasTeamFloor'
import { usePlaybookStrengthOverrides } from '../hooks/usePlaybookStrengthOverrides'
import { getStrengthOverrideKey } from '../hooks/usePlaybookStrengthOverridesBatch'
import {
  evaluateStrengthState,
  getStrengthThresholdsForRaritySet,
  type StrengthState
} from '@/app/lib/meta/roster-strength'
import { normalizeHeroKey, resolveHeroMapping } from '../utils/hero-mapping'
import {
  buildRosterEntryIndex,
  parseTeamUnits,
  rankMetaTeamProgressions,
  resolveDefaultMetaTeamKey,
  resolveMetaTeamAvailabilityBadge,
  resolveMetaTeamBadge,
  resolveMetaTeamKey,
  resolvePotentialDelta,
  selectMetaTeamProgression,
  type PersonalPotentialContentProps,
  type SourceMode,
  type TeamUnitInfo
} from './personal-potential-model'
import { PersonalPotentialMetaTeamSelect } from './PersonalPotentialMetaTeamSelect'
import { PersonalPotentialUpgradeSection } from './PersonalPotentialUpgradeSection'

export function PersonalPotentialContent({
  data,
  heroMappings,
  rosterEntries,
  hasBattleHistory,
  hasRoster,
  strengthOverridesLookup
}: PersonalPotentialContentProps) {
  const hasHistoryData =
    hasBattleHistory && Boolean(data?.current_team || data?.current_team_info)
  const metaTeamProgressions = useMemo(
    () => data.meta_team_progressions ?? [],
    [data.meta_team_progressions]
  )
  const hasMetaTeamBuildable = metaTeamProgressions.some(
    (entry) => entry.is_buildable
  )
  const hasRosterData = Boolean(
    data?.best_buildable_team ||
    data?.best_buildable_info ||
    hasMetaTeamBuildable
  )
  const defaultSourceMode: SourceMode = hasHistoryData ? 'history' : 'roster'
  const [sourceMode, setSourceMode] = useState<SourceMode>(defaultSourceMode)
  const [hasUserSelected, setHasUserSelected] = useState(false)
  const resolvedSourceMode = hasUserSelected
    ? sourceMode === 'history' && !hasHistoryData
      ? defaultSourceMode
      : sourceMode
    : defaultSourceMode
  const defaultMetaTeamKey = useMemo(() => {
    return resolveDefaultMetaTeamKey(data, metaTeamProgressions)
  }, [data, metaTeamProgressions])
  const [selectedMetaTeamKey, setSelectedMetaTeamKey] = useState<string | null>(
    defaultMetaTeamKey
  )
  const [hasMetaTeamSelected, setHasMetaTeamSelected] = useState(false)
  const resolvedMetaTeamKey = hasMetaTeamSelected
    ? selectedMetaTeamKey
    : defaultMetaTeamKey
  const metaTeamRankings = useMemo(() => {
    return rankMetaTeamProgressions(metaTeamProgressions)
  }, [metaTeamProgressions])
  const selectedMetaTeam = useMemo(() => {
    return selectMetaTeamProgression(metaTeamProgressions, resolvedMetaTeamKey)
  }, [metaTeamProgressions, resolvedMetaTeamKey])
  const selectedMetaTeamRank = selectedMetaTeam
    ? (metaTeamRankings.get(resolveMetaTeamKey(selectedMetaTeam.meta_team)) ??
      null)
    : null

  const historyEqualsRoster = data.history_equals_roster ?? true
  const isOptimalFromHistory = data.is_optimal_from_history ?? false
  const isOptimalFromRoster = data.is_optimal_from_roster ?? false
  const deployableIsSuitable = data.best_buildable_is_suitable === true
  const deployableStatusKnown = data.best_buildable_is_suitable != null
  const rosterProgression =
    resolvedSourceMode === 'roster' ? selectedMetaTeam : null
  const rosterBestTeamInfo =
    rosterProgression?.best_buildable_team ?? data.best_buildable_info ?? null
  const rosterLowestTeamInfo =
    rosterProgression?.lowest_buildable_team ?? rosterBestTeamInfo
  const rosterTargetTeamInfo =
    rosterProgression?.target_team ?? data.target_team_info ?? null
  const rosterUpgradePath =
    rosterProgression?.upgrade_path ?? data.upgrade_path_from_roster ?? []

  const currentTeam =
    resolvedSourceMode === 'history'
      ? data.current_team
      : (rosterBestTeamInfo?.composition ?? data.best_buildable_team)

  const currentTeamInfo =
    resolvedSourceMode === 'history'
      ? data.current_team_info
      : rosterBestTeamInfo

  const upgradePath =
    resolvedSourceMode === 'history'
      ? data.upgrade_path_from_history?.length
        ? data.upgrade_path_from_history
        : (data.upgrade_path ?? [])
      : rosterUpgradePath

  const findRecommendation = (team?: string | null) => {
    if (!team) return undefined
    const normalized = team.trim().toLowerCase()
    return data.recommendations.find(
      (rec) => rec.team_composition.trim().toLowerCase() === normalized
    )
  }

  const fallbackCurrentRec = findRecommendation(currentTeam)
  const fallbackTargetRec =
    findRecommendation(data.target_team) || data.recommendations[0]
  const overrideMetaTeam =
    selectedMetaTeam?.meta_team ??
    rosterTargetTeamInfo?.meta_team ??
    data.target_team_info?.meta_team ??
    fallbackTargetRec?.meta_team ??
    null

  const resolvedCurrentDamage =
    currentTeamInfo?.damage_p90 ?? fallbackCurrentRec?.damage_p90 ?? null

  const showBetterBuildableHint =
    resolvedSourceMode === 'history' &&
    !historyEqualsRoster &&
    data.best_buildable_info &&
    data.current_team_info &&
    data.best_buildable_info.damage_p90 > data.current_team_info.damage_p90

  const isOptimal =
    resolvedSourceMode === 'history'
      ? isOptimalFromHistory && !showBetterBuildableHint
      : isOptimalFromRoster

  const targetTeamOverride =
    resolvedSourceMode === 'roster'
      ? (rosterTargetTeamInfo?.composition ?? data.target_team)
      : data.target_team
  const targetDamageOverride =
    resolvedSourceMode === 'roster'
      ? (rosterTargetTeamInfo?.damage_p90 ?? data.target_team_info?.damage_p90)
      : data.target_team_info?.damage_p90
  const resolvedTargetTeam =
    targetTeamOverride ||
    fallbackTargetRec?.team_composition ||
    (isOptimal ? currentTeam : null)
  const resolvedTargetDamage =
    targetDamageOverride ??
    fallbackTargetRec?.damage_p90 ??
    (isOptimal ? resolvedCurrentDamage : null)

  const totalDamageIncrease =
    resolvedSourceMode === 'history'
      ? (data.total_damage_increase_from_history ??
        data.total_damage_increase ??
        0)
      : (rosterProgression?.total_damage_increase ??
        data.total_damage_increase_from_roster ??
        0)
  const resolvedDelta = resolvePotentialDelta(
    resolvedCurrentDamage,
    resolvedTargetDamage,
    totalDamageIncrease
  )
  const resolvedDeltaLabel =
    resolvedDelta != null
      ? `${resolvedDelta > 0 ? '+' : resolvedDelta < 0 ? '-' : ''}${formatNumber(Math.abs(resolvedDelta))}`
      : null
  const resolvedDeltaTone =
    resolvedDelta == null
      ? 'text-[var(--text-primary)]'
      : resolvedDelta > 0
        ? 'text-emerald-200'
        : resolvedDelta < 0
          ? 'text-rose-200'
          : 'text-[var(--text-primary)]'

  const yourTeamHeroes = parseTeamComposition(currentTeam, heroMappings)
  const targetTeamHeroes = parseTeamComposition(
    resolvedTargetTeam,
    heroMappings
  )
  const floorSeason = data.recommendations[0]?.season ?? null
  const targetTeamHash =
    (resolvedSourceMode === 'roster'
      ? rosterTargetTeamInfo?.id
      : data.target_team_info?.id) ??
    fallbackTargetRec?.team_hash ??
    null
  const teamFloorQuery = useMetaAtlasTeamFloor({
    teamHash: targetTeamHash,
    bossType: data.boss_type,
    encounterIndex: data.encounter_index,
    raritySet: data.rarity_set,
    season: floorSeason,
    enabled: hasRoster && Boolean(targetTeamHash && floorSeason)
  })
  const strengthThresholds = useMemo(
    () => getStrengthThresholdsForRaritySet(data.rarity_set ?? null),
    [data.rarity_set]
  )

  // Prefer prefetched batch data; fall back to an individual query.
  const lookupKey = getStrengthOverrideKey(
    data.boss_type,
    data.boss_name,
    overrideMetaTeam
  )
  const prefetchedOverride = lookupKey
    ? (strengthOverridesLookup?.get(lookupKey) ?? null)
    : null
  const useBatchData = Boolean(strengthOverridesLookup && lookupKey)

  const playbookOverrideQuery = usePlaybookStrengthOverrides({
    bossType: data.boss_type,
    bossName: data.boss_name,
    metaTeam: overrideMetaTeam,
    enabled: hasRoster && Boolean(overrideMetaTeam) && !useBatchData
  })

  const heroOverrides = useBatchData
    ? (prefetchedOverride?.heroes ?? null)
    : (playbookOverrideQuery.data?.heroes ?? null)
  const hasHeroOverrides = Boolean(heroOverrides && heroOverrides.size > 0)

  const rosterIndex = useMemo(
    () => buildRosterEntryIndex(rosterEntries),
    [rosterEntries]
  )

  const targetTeamUnits = useMemo(
    () => parseTeamUnits(resolvedTargetTeam || currentTeam, heroMappings),
    [resolvedTargetTeam, currentTeam, heroMappings]
  )

  const rosterDefaultIndex = useMemo(() => {
    if (!rosterProgression || !rosterLowestTeamInfo) return null
    const baseline = rosterLowestTeamInfo.composition
    const steps = rosterProgression.upgrade_path || []
    const sequence = [
      baseline,
      ...steps.map((step) => step.to_team).filter(Boolean)
    ]
    const target = rosterBestTeamInfo?.composition
    if (target) {
      const normalizedTarget = target.trim().toLowerCase()
      const matchIndex = sequence.findIndex(
        (team) => team.trim().toLowerCase() === normalizedTarget
      )
      if (matchIndex >= 0) return matchIndex
    }
    const targetDamage = rosterBestTeamInfo?.damage_p90
    if (typeof targetDamage === 'number') {
      const damageSequence = [
        rosterLowestTeamInfo.damage_p90,
        ...steps.map((step) => step.new_damage_p90 ?? null)
      ]
      let bestIndex = 0
      let bestDelta = Number.POSITIVE_INFINITY
      damageSequence.forEach((damage, index) => {
        if (typeof damage !== 'number') return
        const delta = Math.abs(damage - targetDamage)
        if (delta < bestDelta) {
          bestDelta = delta
          bestIndex = index
        }
      })
      return bestIndex
    }
    return 0
  }, [rosterProgression, rosterLowestTeamInfo, rosterBestTeamInfo])

  const floorUnitLookup = useMemo(() => {
    const lookup = new Map<
      string,
      {
        min_rank_name: string | null
        min_rank_index: number | null
        min_stars: number | null
      }
    >()
    const units = teamFloorQuery.data?.units || []
    units.forEach((unit) => {
      const mapping = resolveHeroMapping(unit.unit_id, heroMappings)
      const keys = [unit.unit_id, mapping?.display_name]
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
        )
        .map((value) => normalizeHeroKey(value))
        .filter(Boolean)
      if (keys.length === 0) return
      const entry = {
        min_rank_name: unit.min_rank_name ?? null,
        min_rank_index:
          typeof unit.min_rank_index === 'number' ? unit.min_rank_index : null,
        min_stars: typeof unit.min_stars === 'number' ? unit.min_stars : null
      }
      keys.forEach((key) => lookup.set(key, entry))
    })
    return lookup
  }, [teamFloorQuery.data?.units, heroMappings])

  const findRosterEntry = useCallback(
    (unit: TeamUnitInfo) => {
      const keys = [unit.unitId, unit.displayName]
        .map((value) => normalizeHeroKey(value))
        .filter(Boolean)
      for (const key of keys) {
        const entry = rosterIndex.get(key)
        if (entry) return entry
      }
      return null
    },
    [rosterIndex]
  )

  const teamStrengthUnits = useMemo(() => {
    if (!hasRoster || !currentTeam) return []
    if (strengthThresholds.source === 'none' && !hasHeroOverrides) return []
    const units = parseTeamUnits(currentTeam, heroMappings)
    return units.map((unit) => {
      const rosterEntry = findRosterEntry(unit)
      if (!rosterEntry) {
        return { unit, state: 'Locked' as StrengthState, needsInvestment: true }
      }
      const rawEntry =
        typeof rosterEntry === 'string' ? { name: rosterEntry } : rosterEntry
      const candidates = [unit.unitId, unit.displayName]
      let heroOverride = null
      if (hasHeroOverrides && heroOverrides) {
        for (const value of candidates) {
          if (!value) continue
          const key = normalizeHeroKey(value)
          if (!key) continue
          heroOverride = heroOverrides.get(key) ?? null
          if (heroOverride) break
        }
      }
      const state =
        evaluateStrengthState(rawEntry, strengthThresholds, heroOverride) ??
        'Invalid'
      const needsInvestment =
        state === 'Weak' || state === 'Invalid' || state === 'Locked'
      return { unit, state, needsInvestment }
    })
  }, [
    currentTeam,
    findRosterEntry,
    hasHeroOverrides,
    hasRoster,
    heroMappings,
    heroOverrides,
    strengthThresholds
  ])

  const teamFloor = teamFloorQuery.data
  const teamFloorUnits = teamFloor?.units ?? []
  const showTeamFloor =
    hasRoster &&
    targetTeamUnits.length > 0 &&
    (teamFloorQuery.isLoading || Boolean(teamFloor))
  const strengthNeedsCount = teamStrengthUnits.filter(
    (unit) => unit.needsInvestment
  ).length
  const showStrengthOverview = hasRoster && teamStrengthUnits.length > 0
  const resolvedDeployableIsSuitable =
    resolvedSourceMode === 'roster' && rosterProgression
      ? showStrengthOverview
        ? strengthNeedsCount === 0
        : false
      : deployableStatusKnown
        ? deployableIsSuitable
        : showStrengthOverview
          ? strengthNeedsCount === 0
          : false
  const pathBaseTeam =
    resolvedSourceMode === 'history'
      ? currentTeam
      : (rosterLowestTeamInfo?.composition ?? currentTeam)
  const pathBaseDamage =
    resolvedSourceMode === 'history'
      ? resolvedCurrentDamage
      : (rosterLowestTeamInfo?.damage_p90 ?? resolvedCurrentDamage)
  const activeBadgeLabel =
    resolvedSourceMode === 'history'
      ? 'Current Team'
      : resolvedDeployableIsSuitable
        ? 'Best Buildable'
        : 'Best Available'
  const selectedMetaTeamBadge = resolveMetaTeamBadge(
    selectedMetaTeam?.worst_state
  )
  const selectedMetaTeamAvailabilityBadge = resolveMetaTeamAvailabilityBadge(
    selectedMetaTeam?.is_buildable
  )
  const selectedMetaTeamLabel = selectedMetaTeam?.meta_team ?? 'Custom Team'

  const showToggle = hasRoster

  const historyUnavailable = resolvedSourceMode === 'history' && !hasHistoryData
  const needsApiKey = !hasRoster
  const blockRosterView = resolvedSourceMode === 'roster' && !hasRoster
  const selectedMetaBuildable =
    resolvedSourceMode === 'roster'
      ? (selectedMetaTeam?.is_buildable ?? hasRosterData)
      : hasRosterData
  const rosterUnavailable =
    resolvedSourceMode === 'roster' && hasRoster && !selectedMetaBuildable

  const showUpgradeLine =
    !historyUnavailable &&
    !rosterUnavailable &&
    !blockRosterView &&
    Boolean(
      upgradePath.length > 0 ||
      data.target_team ||
      data.target_team_info ||
      pathBaseTeam ||
      currentTeamInfo
    )
  const showTeamComparison = !showUpgradeLine && !blockRosterView

  return (
    <div className="space-y-3">
      {showToggle && (
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center rounded-full border border-[var(--card-border)] bg-card/70 p-1">
            <button
              type="button"
              onClick={() => {
                setSourceMode('history')
                setHasUserSelected(true)
              }}
              disabled={!hasHistoryData}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 ${
                resolvedSourceMode === 'history'
                  ? 'bg-blue-500 text-white'
                  : !hasHistoryData
                    ? 'text-[var(--text-secondary)] cursor-not-allowed'
                    : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <History className="w-3 h-3" />
              Battle History
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode('roster')
                setHasUserSelected(true)
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 ${
                resolvedSourceMode === 'roster'
                  ? 'bg-purple-500 text-white'
                  : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <Package className="w-3 h-3" />
              My Roster
            </button>
          </div>
          {historyEqualsRoster && hasHistoryData && (
            <div
              className="ml-2 flex items-center gap-1 text-[10px] text-[var(--text-secondary)]"
              title="Your battle history team matches your best roster team"
            >
              <Equal className="w-3 h-3" />
              Same
            </div>
          )}
        </div>
      )}

      {resolvedSourceMode === 'roster' && metaTeamProgressions.length > 0 && (
        <PersonalPotentialMetaTeamSelect
          resolvedMetaTeamKey={resolvedMetaTeamKey}
          setSelectedMetaTeamKey={setSelectedMetaTeamKey}
          setHasMetaTeamSelected={setHasMetaTeamSelected}
          selectedMetaTeamRank={selectedMetaTeamRank}
          selectedMetaTeam={selectedMetaTeam}
          selectedMetaTeamLabel={selectedMetaTeamLabel}
          selectedMetaTeamAvailabilityBadge={selectedMetaTeamAvailabilityBadge}
          selectedMetaTeamBadge={selectedMetaTeamBadge}
          metaTeamProgressions={metaTeamProgressions}
          metaTeamRankings={metaTeamRankings}
        />
      )}

      {!hasHistoryData && hasRoster && (
        <div className="text-center text-xs text-[var(--text-secondary)]">
          No battle history for this boss. Showing roster-based analysis.
        </div>
      )}

      {showBetterBuildableHint && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-300">
              Better Team Available
            </span>
          </div>
          <p className="text-xs text-amber-200/80">
            {resolvedDeployableIsSuitable ? (
              <>
                You own a better deployable team! Switch to{' '}
                <strong>My Roster</strong> view to see it,
              </>
            ) : (
              <>
                You own a higher-damage team, but some units need investment.
                Switch to <strong>My Roster</strong> view to see it,
              </>
            )}{' '}
            or gain{' '}
            <span className="font-bold text-amber-300">
              +
              {formatNumber(
                data.best_buildable_info!.damage_p90 -
                  data.current_team_info!.damage_p90
              )}
            </span>{' '}
            P90 damage.
          </p>
        </div>
      )}

      {showStrengthOverview &&
        !resolvedDeployableIsSuitable &&
        resolvedSourceMode === 'roster' && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            Some units on this roster team are below the Suitable strength
            threshold for this boss. Upgrade ranks or abilities to make the team
            deployable.
          </div>
        )}

      {historyUnavailable && (
        <div className="p-3 rounded-lg bg-card/70 border border-[var(--card-border)] text-xs text-[var(--text-primary)]">
          No battle history team found for this boss/rarity. Switch to{' '}
          <strong>My Roster</strong> to see deployable paths.
        </div>
      )}

      {needsApiKey && (
        <div className="rounded-xl border-2 border-dashed border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center mb-2">
              <Key className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">
              Connect Your Roster
            </h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-sm mb-3">
              Add your Player API key to load your roster and compute the best
              team you can field.
            </p>
            <Link
              href="/profile/edit"
              className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Configure API Key
            </Link>
          </div>
        </div>
      )}

      {rosterUnavailable && (
        <div className="p-3 rounded-lg bg-card/70 border border-[var(--card-border)] text-xs text-[var(--text-primary)]">
          {selectedMetaTeam && !selectedMetaTeam.is_buildable ? (
            <>
              No buildable team found for{' '}
              <strong>{selectedMetaTeam.meta_team ?? 'Custom Team'}</strong>.
              Unlock missing heroes to start progression.
            </>
          ) : hasBattleHistory ? (
            <>
              No fully deployable roster team found for this boss/rarity. Build
              out your roster or switch to <strong>Battle History</strong> to
              see your current team path.
            </>
          ) : (
            <>
              No fully deployable roster team found for this boss/rarity. Build
              out your roster to unlock a path toward the meta team.
            </>
          )}
        </div>
      )}

      {showUpgradeLine && (
        <PersonalPotentialUpgradeSection
          resolvedDeltaLabel={resolvedDeltaLabel}
          resolvedDeltaTone={resolvedDeltaTone}
          resolvedCurrentDamage={resolvedCurrentDamage}
          resolvedTargetDamage={resolvedTargetDamage}
          resolvedSourceMode={resolvedSourceMode}
          pathBaseTeam={pathBaseTeam}
          resolvedTargetTeam={resolvedTargetTeam}
          pathBaseDamage={pathBaseDamage}
          upgradePath={upgradePath}
          rosterDefaultIndex={rosterDefaultIndex}
          activeBadgeLabel={activeBadgeLabel}
          heroMappings={heroMappings}
          rosterEntries={rosterEntries}
          strengthThresholds={strengthThresholds}
          heroOverrides={heroOverrides}
          overrideMetaTeam={overrideMetaTeam}
          showTeamFloor={showTeamFloor}
          teamFloorQuery={teamFloorQuery}
          teamFloor={teamFloor}
          teamFloorUnits={teamFloorUnits}
          targetTeamUnits={targetTeamUnits}
          floorUnitLookup={floorUnitLookup}
          findRosterEntry={findRosterEntry}
        />
      )}

      {showTeamComparison && (
        <TeamComparisonView
          yourTeam={{
            heroes: yourTeamHeroes,
            damage: currentTeamInfo?.damage_p90 ?? null,
            label:
              resolvedSourceMode === 'history'
                ? 'Your Current Team'
                : resolvedDeployableIsSuitable
                  ? 'Best Deployable Team'
                  : 'Best Available Team'
          }}
          globalTeam={{
            heroes: targetTeamHeroes,
            damage: data.target_team_info?.damage_p90 ?? null,
            label: 'Meta Target'
          }}
          heroMappings={heroMappings}
        />
      )}
    </div>
  )
}

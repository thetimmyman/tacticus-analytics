import {
  buildRosterLookup,
  evaluateStrengthState,
  fetchStrengthThresholds
} from '@/app/lib/meta/roster-strength'
import { parseTeamComposition } from '@/app/lib/meta/team-coverage'
import type {
  MetaTeamProgression,
  TeamInfo,
  UpgradeStep
} from '@/app/lib/meta/types'
import type {
  DagEdgeRow,
  DagProgressionError,
  DagProgressionInput,
  DagProgressionResult,
  DagSupabaseClient,
  LegacyUpgradeStep,
  MetaAtlasTeamRow,
  TeamEntry,
  TeamWithOwnership
} from './types'
import {
  buildHeroScores,
  buildMetaTeamEdges,
  buildSyntheticUpgradePath,
  collectRosterUnits,
  findClosestTeamByOverlap,
  findTopTeam,
  normalizeTeamComposition,
  normalizeUnitName,
  parseTeamHeroes,
  resolveTeamProgressState
} from './team-analysis'
import {
  fetchCurrentTeam,
  logger,
  resolveBossName,
  toRequiredInput
} from './data-access'
import {
  computePathFromTeam,
  type PathComputationContext
} from './path-computation'
import { emptyDagProgressionResult } from './result-builders'

export async function resolveDagProgression(
  supabase: DagSupabaseClient,
  input: DagProgressionInput,
  options: { requireCurrentTeam?: boolean } = {}
): Promise<DagProgressionResult | DagProgressionError> {
  const requireCurrentTeam = options.requireCurrentTeam ?? false
  const resolvedInput = toRequiredInput(input)
  const hasRosterEntries =
    Array.isArray(resolvedInput.roster) && resolvedInput.roster.length > 0

  if (!resolvedInput.bossType && !resolvedInput.bossUnitId) {
    return { error: 'boss_type or boss_unit_id is required' }
  }

  if (
    requireCurrentTeam &&
    !resolvedInput.currentTeam &&
    !resolvedInput.currentTeamHash
  ) {
    return { error: 'current_team or current_team_hash is required' }
  }

  if (!resolvedInput.currentTeam && !resolvedInput.currentTeamHash) {
    if (!hasRosterEntries) {
      return emptyDagProgressionResult(resolvedInput, {
        message: 'Roster data is required to compute upgrade paths'
      })
    }
    if (
      !resolvedInput.raritySet ||
      !resolvedInput.season ||
      resolvedInput.encounterIndex == null
    ) {
      return {
        error:
          'rarity_set, season, and encounter_index are required when current_team is missing'
      }
    }
  }

  let currentTeamRow: MetaAtlasTeamRow | null = null
  if (resolvedInput.currentTeam || resolvedInput.currentTeamHash) {
    currentTeamRow = await fetchCurrentTeam(supabase, resolvedInput)
  }

  if (
    (resolvedInput.currentTeam || resolvedInput.currentTeamHash) &&
    !currentTeamRow
  ) {
    return emptyDagProgressionResult(resolvedInput, {
      currentTeam: resolvedInput.currentTeam,
      targetTeam: resolvedInput.currentTeam,
      message: 'No team data found for the provided composition'
    })
  }

  const resolvedBossType =
    resolvedInput.bossType || currentTeamRow?.boss_type || null
  const resolvedBossUnitId =
    resolvedInput.bossUnitId || currentTeamRow?.boss_unit_id || null
  const resolvedEncounterIndex =
    resolvedInput.encounterIndex ?? currentTeamRow?.encounter_index ?? null
  const resolvedRaritySet =
    resolvedInput.raritySet || currentTeamRow?.rarity_set || null
  const resolvedSeason = resolvedInput.season || currentTeamRow?.season || null

  if (!resolvedRaritySet || !resolvedSeason) {
    return {
      error: 'rarity_set and season are required to resolve upgrade paths'
    }
  }
  if (resolvedEncounterIndex == null) {
    return { error: 'encounter_index is required to resolve upgrade paths' }
  }
  if (!resolvedBossType) {
    return { error: 'boss_type is required to resolve upgrade paths' }
  }

  const { data: edgesData, error: edgesError } = await supabase
    .from('meta_atlas_dag_edges')
    .select(
      'from_team_hash, to_team_hash, swapped_out, swapped_in, from_damage_p90, to_damage_p90, damage_gain'
    )
    .eq('boss_type', resolvedBossType)
    .eq('encounter_index', resolvedEncounterIndex)
    .eq('rarity_set', resolvedRaritySet)
    .eq('season', resolvedSeason)

  if (edgesError) {
    logger.error({ error: edgesError }, 'Meta atlas DAG edge lookup failed')
    return { error: 'Failed to load DAG edges' }
  }

  const edges = (edgesData || []) as DagEdgeRow[]

  const { data: teamRows, error: teamError } = await supabase
    .from('meta_atlas_data')
    .select('team_hash, team_composition, meta_team, damage_p90')
    .eq('boss_type', resolvedBossType)
    .eq('encounter_index', resolvedEncounterIndex)
    .eq('rarity_set', resolvedRaritySet)
    .eq('season', resolvedSeason)

  if (teamError) {
    logger.error({ error: teamError }, 'Meta atlas team lookup failed')
    return { error: 'Failed to load team data' }
  }

  const teamLookup = new Map<string, TeamEntry>()

  for (const row of teamRows || []) {
    if (!row.team_hash || !row.team_composition || row.damage_p90 == null)
      continue
    teamLookup.set(row.team_hash, {
      team_hash: row.team_hash,
      composition: row.team_composition,
      metaTeam: row.meta_team ?? null,
      damageP90: Number(row.damage_p90)
    })
  }

  if (currentTeamRow && !teamLookup.has(currentTeamRow.team_hash)) {
    teamLookup.set(currentTeamRow.team_hash, {
      team_hash: currentTeamRow.team_hash,
      composition:
        currentTeamRow.team_composition ||
        normalizeTeamComposition(resolvedInput.currentTeam || ''),
      metaTeam: currentTeamRow.meta_team ?? null,
      damageP90: Number(currentTeamRow.damage_p90 ?? 0)
    })
  }

  const teamEntries: TeamEntry[] = []
  const compositionLookup = new Map<string, TeamEntry>()
  const knownMows = new Set<string>()
  for (const [hash, team] of teamLookup) {
    const entry: TeamEntry = {
      team_hash: hash,
      composition: team.composition,
      metaTeam: team.metaTeam,
      damageP90: team.damageP90
    }
    teamEntries.push(entry)
    const normalized = normalizeTeamComposition(team.composition)
    if (!compositionLookup.has(normalized)) {
      compositionLookup.set(normalized, entry)
    }
    const parsed = parseTeamComposition(team.composition)
    if (parsed.mow) {
      const normalizedMow = normalizeUnitName(parsed.mow)
      if (normalizedMow) {
        knownMows.add(normalizedMow)
      }
    }
  }

  const rosterLookup = buildRosterLookup(resolvedInput.roster)
  const rosterUnits = collectRosterUnits(resolvedInput.roster, knownMows)
  const heroScores = buildHeroScores(teamEntries, rosterLookup)
  const topTeam = findTopTeam(teamEntries)

  const getEdgeGain = (edge: DagEdgeRow): number | null => {
    if (edge.damage_gain != null && Number.isFinite(edge.damage_gain)) {
      return edge.damage_gain
    }
    const fromTeam = teamLookup.get(edge.from_team_hash)
    const toTeam = teamLookup.get(edge.to_team_hash)
    const fromDamage = edge.from_damage_p90 ?? fromTeam?.damageP90 ?? null
    const toDamage = edge.to_damage_p90 ?? toTeam?.damageP90 ?? null
    if (fromDamage == null || toDamage == null) return null
    return toDamage - fromDamage
  }

  const edgeMap = new Map<string, DagEdgeRow>()
  const edgeGainMap = new Map<string, number>()
  for (const edge of edges) {
    const gain = getEdgeGain(edge)
    if (gain == null || gain < 0) continue
    const existingGain = edgeGainMap.get(edge.from_team_hash)
    const shouldReplace = existingGain == null || gain > existingGain
    if (shouldReplace) {
      edgeGainMap.set(edge.from_team_hash, gain)
      edgeMap.set(edge.from_team_hash, edge)
    }
  }
  const shouldScoreStrength =
    rosterLookup.hasEntries && rosterLookup.hasStrengthData
  const resolvedBossName = shouldScoreStrength
    ? await resolveBossName(supabase, resolvedBossType, resolvedEncounterIndex)
    : null
  const strengthThresholds = shouldScoreStrength
    ? await fetchStrengthThresholds({
        bossName: resolvedBossName,
        bossType: resolvedBossType,
        raritySet: resolvedRaritySet,
        encounterIndex: resolvedEncounterIndex,
        season: resolvedSeason
      })
    : null

  const metaTeamProgressions: MetaTeamProgression[] = []
  if (rosterLookup.hasEntries) {
    const metaTeamGroups = new Map<
      string,
      { metaTeam: string | null; teams: TeamEntry[] }
    >()
    const toTeamInfo = (team: TeamEntry): TeamInfo => ({
      id: team.team_hash,
      composition: team.composition,
      damage_p90: Math.round(team.damageP90),
      meta_team: team.metaTeam
    })

    for (const team of teamEntries) {
      const key = team.metaTeam ?? '__custom__'
      if (!metaTeamGroups.has(key)) {
        metaTeamGroups.set(key, { metaTeam: team.metaTeam ?? null, teams: [] })
      }
      metaTeamGroups.get(key)!.teams.push(team)
    }

    for (const group of metaTeamGroups.values()) {
      const { teams, metaTeam } = group
      if (teams.length === 0) continue

      const targetTeam = findTopTeam(teams)
      const buildableTeams: TeamEntry[] = []

      for (const team of teams) {
        const units = parseTeamComposition(team.composition).units
        const allOwned =
          units.length > 0 && units.every((unit) => rosterLookup.find(unit))
        if (allOwned) {
          buildableTeams.push(team)
        }
      }

      let lowestBuildable: TeamEntry | null = null
      let bestBuildable: TeamEntry | null = null
      for (const team of buildableTeams) {
        if (!lowestBuildable || team.damageP90 < lowestBuildable.damageP90) {
          lowestBuildable = team
        }
        if (!bestBuildable || team.damageP90 > bestBuildable.damageP90) {
          bestBuildable = team
        }
      }

      const metaCompositionLookup = new Map<string, TeamEntry>()
      for (const team of teams) {
        const normalized = normalizeTeamComposition(team.composition)
        if (!metaCompositionLookup.has(normalized)) {
          metaCompositionLookup.set(normalized, team)
        }
      }

      let metaPath: UpgradeStep[] = []
      let metaIncrease = 0

      if (lowestBuildable && targetTeam) {
        const metaEdges = buildMetaTeamEdges(teams)
        const metaEdgeMap = new Map<string, DagEdgeRow>()
        const metaEdgeGainMap = new Map<string, number>()
        for (const edge of metaEdges) {
          const gain = getEdgeGain(edge)
          if (gain == null || gain < 0) continue
          const existingGain = metaEdgeGainMap.get(edge.from_team_hash)
          const shouldReplace = existingGain == null || gain > existingGain
          if (shouldReplace) {
            metaEdgeGainMap.set(edge.from_team_hash, gain)
            metaEdgeMap.set(edge.from_team_hash, edge)
          }
        }

        const metaCtx: PathComputationContext = {
          edgeMap: metaEdgeMap,
          teamLookup,
          rosterLookup,
          strengthThresholds
        }
        const metaResult = computePathFromTeam(
          lowestBuildable.team_hash,
          metaCtx
        )
        metaPath = metaResult.path
        metaIncrease = metaResult.totalIncrease

        if (targetTeam && metaResult.finalHash !== targetTeam.team_hash) {
          const fallbackTeam =
            teamLookup.get(metaResult.finalHash) ?? lowestBuildable
          const metaHeroScores = buildHeroScores(teams, rosterLookup)
          const synthetic = buildSyntheticUpgradePath({
            baselineComposition: fallbackTeam.composition,
            baselineDamage: fallbackTeam.damageP90,
            targetTeam,
            heroScores: metaHeroScores,
            rosterLookup,
            compositionLookup: metaCompositionLookup,
            startIndex: metaPath.length
          })
          if (synthetic.path.length > 0) {
            metaPath = metaPath.concat(synthetic.path)
            metaIncrease += synthetic.totalIncrease
          }
        }
      }

      const worstState = lowestBuildable
        ? resolveTeamProgressState(
            lowestBuildable.composition,
            rosterLookup,
            strengthThresholds
          )
        : 'Locked'

      metaTeamProgressions.push({
        meta_team: metaTeam ?? null,
        target_team: targetTeam ? toTeamInfo(targetTeam) : null,
        lowest_buildable_team: lowestBuildable
          ? toTeamInfo(lowestBuildable)
          : null,
        best_buildable_team: bestBuildable ? toTeamInfo(bestBuildable) : null,
        upgrade_path: metaPath,
        total_damage_increase: Math.round(metaIncrease),
        worst_state: worstState,
        is_buildable: Boolean(lowestBuildable)
      })
    }

    metaTeamProgressions.sort((a, b) => {
      const aDamage = a.target_team?.damage_p90 ?? 0
      const bDamage = b.target_team?.damage_p90 ?? 0
      if (bDamage !== aDamage) return bDamage - aDamage
      return (a.meta_team || '').localeCompare(b.meta_team || '')
    })
  }

  let bestBuildableTeam: TeamWithOwnership | null = null
  let bestBuildableIsSuitable: boolean | null = null
  let bestBuildableIsSynthetic = false
  let syntheticTargetTeam: TeamEntry | null = null
  const shouldGateBuildable = Boolean(
    strengthThresholds &&
    strengthThresholds.source !== 'none' &&
    rosterLookup.hasStrengthData
  )

  const isUnitBuildable = (unit: string): boolean => {
    const entry = rosterLookup.find(unit)
    if (!entry) return false
    if (!shouldGateBuildable) return true
    const strengthState = evaluateStrengthState(entry.raw, strengthThresholds)
    return (
      strengthState === 'Suitable' ||
      strengthState === 'Strong' ||
      strengthState === 'Optimal'
    )
  }

  if (rosterLookup.hasEntries) {
    const teamsWithOwnership: TeamWithOwnership[] = []
    for (const [hash, team] of teamLookup) {
      const heroes = parseTeamHeroes(team.composition)
      const allOwned = heroes.every((hero) => rosterLookup.find(hero) !== null)
      const allBuildable =
        allOwned && heroes.every((hero) => isUnitBuildable(hero))
      teamsWithOwnership.push({
        team_hash: hash,
        composition: team.composition,
        meta_team: team.metaTeam,
        damage_p90: team.damageP90,
        all_heroes_owned: allOwned,
        all_heroes_buildable: allBuildable
      })
    }
    const ownedTeams = teamsWithOwnership.filter((t) => t.all_heroes_owned)
    if (ownedTeams.length > 0) {
      ownedTeams.sort((a, b) => b.damage_p90 - a.damage_p90)
      const topOwned = ownedTeams[0]
      if (topOwned) {
        bestBuildableTeam = topOwned
        bestBuildableIsSuitable = shouldGateBuildable
          ? Boolean(topOwned.all_heroes_buildable)
          : null
      }
    } else {
      const topTeam = findTopTeam(teamEntries)
      if (topTeam && rosterUnits.heroMap.size > 0) {
        syntheticTargetTeam = topTeam
        const targetParts = parseTeamComposition(topTeam.composition)
        const selectedHeroes: string[] = []
        const selectedSet = new Set<string>()

        for (const hero of targetParts.heroes) {
          const normalized = normalizeUnitName(hero)
          if (!normalized || !rosterLookup.find(hero)) continue
          selectedHeroes.push(hero)
          selectedSet.add(normalized)
        }

        const scoredHeroes = Array.from(heroScores.entries())
          .filter(([, entry]) => !entry.isMow && rosterLookup.find(entry.name))
          .sort((a, b) => b[1].score - a[1].score)

        for (const [normalized, entry] of scoredHeroes) {
          if (selectedHeroes.length >= 5) break
          if (selectedSet.has(normalized)) continue
          selectedHeroes.push(entry.name)
          selectedSet.add(normalized)
        }

        if (selectedHeroes.length < 5) {
          for (const [normalized, name] of rosterUnits.heroMap) {
            if (selectedHeroes.length >= 5) break
            if (selectedSet.has(normalized)) continue
            selectedHeroes.push(name)
            selectedSet.add(normalized)
          }
        }

        let baselineMow: string | null = null
        if (targetParts.mow) {
          const normalized = normalizeUnitName(targetParts.mow)
          if (normalized && rosterLookup.find(targetParts.mow)) {
            baselineMow = targetParts.mow
          }
        }
        if (!baselineMow && rosterUnits.mowMap.size > 0) {
          const scoredMows = Array.from(heroScores.entries())
            .filter(([, entry]) => entry.isMow && rosterLookup.find(entry.name))
            .sort((a, b) => b[1].score - a[1].score)
          baselineMow =
            scoredMows[0]?.[1].name ??
            Array.from(rosterUnits.mowMap.values())[0] ??
            null
        }

        const baselineComposition = selectedHeroes.join(', ')
        const baselineWithMow = baselineMow
          ? `${baselineComposition} + ${baselineMow}`
          : baselineComposition
        const normalizedBaseline = normalizeTeamComposition(baselineWithMow)
        const exactMatch = compositionLookup.get(normalizedBaseline) ?? null
        const closestMatch =
          exactMatch ?? findClosestTeamByOverlap(teamEntries, baselineWithMow)
        const baselineDamage = closestMatch?.damageP90 ?? 0
        const baselineHash =
          exactMatch?.team_hash ?? `synthetic:${normalizedBaseline}`

        bestBuildableTeam = {
          team_hash: baselineHash,
          composition: baselineWithMow,
          meta_team: exactMatch?.metaTeam ?? null,
          damage_p90: baselineDamage,
          all_heroes_owned: true,
          all_heroes_buildable: shouldGateBuildable
            ? parseTeamHeroes(baselineWithMow).every((hero) =>
                isUnitBuildable(hero)
              )
            : false
        }
        bestBuildableIsSuitable = shouldGateBuildable
          ? bestBuildableTeam.all_heroes_buildable
          : null
        bestBuildableIsSynthetic = !exactMatch
      }
    }
  }

  const hasHistoryTeam = Boolean(currentTeamRow)
  if (!currentTeamRow && bestBuildableTeam) {
    currentTeamRow = {
      team_hash: bestBuildableTeam.team_hash,
      team_composition: bestBuildableTeam.composition,
      meta_team: bestBuildableTeam.meta_team,
      damage_p90: bestBuildableTeam.damage_p90,
      attack_count: 0,
      boss_type: resolvedBossType ?? '',
      boss_unit_id: resolvedBossUnitId,
      encounter_index: resolvedEncounterIndex,
      rarity_set: resolvedRaritySet,
      season: resolvedSeason
    }
  }

  if (!currentTeamRow) {
    return {
      boss_type: resolvedBossType,
      boss_unit_id: resolvedBossUnitId,
      filters: {
        rarity_set: resolvedRaritySet,
        season: resolvedSeason,
        encounter_index: resolvedEncounterIndex,
        min_attacks: resolvedInput.minAttacks
      },
      team_count: teamLookup.size,
      edge_count: edges.length,
      dag: { source: 'meta_atlas_dag_edges', edges: edges.length },
      current_team: null,
      target_team: null,
      current_team_info: null,
      target_team_info: null,
      best_buildable_team: null,
      best_buildable_info: null,
      best_buildable_is_suitable: null,
      is_optimal: false,
      is_optimal_from_history: false,
      is_optimal_from_roster: false,
      history_equals_roster: true,
      optimal_message: null,
      upgrade_path: [],
      upgrade_path_from_history: [],
      upgrade_path_from_roster: [],
      upgrade_paths: [],
      progression_path: [],
      total_damage_increase: 0,
      total_damage_increase_from_history: 0,
      total_damage_increase_from_roster: 0,
      final_team: null,
      message: 'No deployable team data found for the provided roster'
    }
  }

  const ctx: PathComputationContext = {
    edgeMap,
    teamLookup,
    rosterLookup,
    strengthThresholds
  }

  let upgradePathFromHistory: UpgradeStep[] = []
  let totalDamageIncreaseFromHistory = 0
  let historyFinalHash: string | null = null

  if (hasHistoryTeam) {
    const historyResult = computePathFromTeam(currentTeamRow.team_hash, ctx)
    upgradePathFromHistory = historyResult.path
    totalDamageIncreaseFromHistory = historyResult.totalIncrease
    historyFinalHash = historyResult.finalHash
  }

  let upgradePathFromRoster: UpgradeStep[] = []
  let totalDamageIncreaseFromRoster = 0
  let rosterTargetTeam: TeamEntry | null = null

  if (bestBuildableTeam) {
    if (teamLookup.has(bestBuildableTeam.team_hash)) {
      const rosterResult = computePathFromTeam(bestBuildableTeam.team_hash, ctx)
      upgradePathFromRoster = rosterResult.path
      totalDamageIncreaseFromRoster = rosterResult.totalIncrease
      rosterTargetTeam = teamLookup.get(rosterResult.finalHash) ?? null
    } else if (bestBuildableIsSynthetic && syntheticTargetTeam) {
      const synthetic = buildSyntheticUpgradePath({
        baselineComposition: bestBuildableTeam.composition,
        baselineDamage: bestBuildableTeam.damage_p90,
        targetTeam: syntheticTargetTeam,
        heroScores,
        rosterLookup,
        compositionLookup
      })
      upgradePathFromRoster = synthetic.path
      totalDamageIncreaseFromRoster = synthetic.totalIncrease
      rosterTargetTeam = syntheticTargetTeam
    }
  }

  const historyTargetTeam = historyFinalHash
    ? (teamLookup.get(historyFinalHash) ?? null)
    : null
  let targetTeam =
    historyTargetTeam ||
    rosterTargetTeam ||
    (bestBuildableTeam
      ? (teamLookup.get(bestBuildableTeam.team_hash) ?? syntheticTargetTeam)
      : null)
  const currentTeamComposition =
    currentTeamRow.team_composition ??
    (resolvedInput.currentTeam
      ? normalizeTeamComposition(resolvedInput.currentTeam)
      : null)
  const currentDamage = Math.round(currentTeamRow.damage_p90 ?? 0)

  if (
    hasHistoryTeam &&
    historyTargetTeam &&
    historyTargetTeam.team_hash === currentTeamRow.team_hash &&
    topTeam &&
    topTeam.damageP90 > currentDamage
  ) {
    targetTeam = topTeam
  }

  const targetTeamComposition =
    targetTeam?.composition ?? currentTeamComposition

  const normalizedTarget = targetTeamComposition
    ? normalizeTeamComposition(targetTeamComposition)
    : null
  const normalizedRoster = bestBuildableTeam?.composition
    ? normalizeTeamComposition(bestBuildableTeam.composition)
    : null
  const rosterMatchesTarget =
    Boolean(normalizedRoster) &&
    Boolean(normalizedTarget) &&
    normalizedRoster === normalizedTarget
  const rosterIsBuildable = bestBuildableIsSuitable ?? true

  const targetDamage = Math.round(targetTeam?.damageP90 ?? currentDamage)
  const historyExceedsMeta = hasHistoryTeam && currentDamage >= targetDamage

  const upgradePath = hasHistoryTeam
    ? upgradePathFromHistory
    : upgradePathFromRoster
  const totalIncrease = upgradePath.reduce(
    (sum, step) => sum + step.damage_increase,
    0
  )
  let resolvedUpgradePath = upgradePath
  let resolvedUpgradePathFromHistory = hasHistoryTeam
    ? upgradePathFromHistory
    : []
  let resolvedUpgradePathFromRoster = upgradePathFromRoster
  let resolvedTotalIncrease = totalIncrease
  let resolvedHistoryIncrease = hasHistoryTeam
    ? totalDamageIncreaseFromHistory
    : 0
  let resolvedRosterIncrease = totalDamageIncreaseFromRoster
  if (historyExceedsMeta) {
    resolvedUpgradePath = []
    resolvedUpgradePathFromHistory = []
    resolvedUpgradePathFromRoster = []
    resolvedTotalIncrease = 0
    resolvedHistoryIncrease = 0
    resolvedRosterIncrease = 0
  }

  const legacySteps: LegacyUpgradeStep[] = resolvedUpgradePath.map((step) => ({
    from_team: step.from_team,
    to_team: step.to_team,
    swapped_out: step.swapped_out,
    swapped_in: step.swapped_in,
    damage_increase: step.damage_increase,
    percent_increase: step.percent_increase,
    new_damage_p90: step.new_damage_p90,
    meta_team: step.meta_team
  }))

  const bestBuildableDamage = bestBuildableTeam?.damage_p90 ?? 0

  const isCurrentBestBuildable = bestBuildableTeam
    ? currentTeamRow.team_hash === bestBuildableTeam.team_hash
    : false
  const historyEqualsRoster =
    hasHistoryTeam && bestBuildableTeam
      ? currentTeamRow.team_hash === bestBuildableTeam.team_hash
      : true

  const hasBetterTarget =
    targetTeam?.damageP90 != null && targetTeam.damageP90 > currentDamage
  const isOptimalFromHistory =
    hasHistoryTeam &&
    !hasBetterTarget &&
    (historyExceedsMeta || resolvedUpgradePathFromHistory.length === 0)
  const isOptimalFromRoster = rosterMatchesTarget && rosterIsBuildable

  const isOptimal = hasHistoryTeam ? isOptimalFromHistory : isOptimalFromRoster

  let optimalMessage: string | null = null
  if (isOptimal) {
    if (hasHistoryTeam && currentDamage > targetDamage) {
      optimalMessage = 'Exceeds Meta'
    }
  } else if (isCurrentBestBuildable && resolvedUpgradePath.length > 0) {
    optimalMessage =
      bestBuildableIsSuitable === false
        ? "You're at your best available team. Upgrade unit strength to progress further."
        : "You're at your best deployable team. Unlock new heroes to progress further."
  } else if (
    bestBuildableTeam &&
    !isCurrentBestBuildable &&
    bestBuildableDamage > currentDamage
  ) {
    optimalMessage = `You could improve by switching to a better team you already own (+${Math.round(bestBuildableDamage - currentDamage).toLocaleString()} damage).`
  }

  return {
    boss_type: resolvedBossType,
    boss_unit_id: resolvedBossUnitId,
    filters: {
      rarity_set: resolvedRaritySet,
      season: resolvedSeason,
      encounter_index: resolvedEncounterIndex,
      min_attacks: resolvedInput.minAttacks
    },
    team_count: teamLookup.size,
    edge_count: edges.length,
    dag: { source: 'meta_atlas_dag_edges', edges: edges.length },
    current_team: hasHistoryTeam ? currentTeamComposition : null,
    target_team: targetTeamComposition,
    current_team_info:
      hasHistoryTeam && currentTeamRow.team_hash
        ? {
            id: currentTeamRow.team_hash,
            composition: currentTeamComposition || '',
            damage_p90: currentDamage,
            meta_team: currentTeamRow.meta_team
          }
        : null,
    target_team_info: targetTeam
      ? {
          id: targetTeam.team_hash,
          composition: targetTeam.composition,
          damage_p90: Math.round(targetTeam.damageP90),
          meta_team: targetTeam.metaTeam
        }
      : null,
    best_buildable_team: bestBuildableTeam?.composition ?? null,
    best_buildable_info: bestBuildableTeam
      ? {
          id: bestBuildableTeam.team_hash,
          composition: bestBuildableTeam.composition,
          damage_p90: Math.round(bestBuildableTeam.damage_p90),
          meta_team: bestBuildableTeam.meta_team
        }
      : null,
    best_buildable_is_suitable: bestBuildableIsSuitable,
    is_optimal: isOptimal,
    is_optimal_from_history: isOptimalFromHistory,
    is_optimal_from_roster: isOptimalFromRoster,
    history_equals_roster: historyEqualsRoster,
    optimal_message: optimalMessage,
    upgrade_path: resolvedUpgradePath,
    upgrade_path_from_history: resolvedUpgradePathFromHistory,
    upgrade_path_from_roster: resolvedUpgradePathFromRoster,
    upgrade_paths: legacySteps,
    progression_path: legacySteps,
    total_damage_increase: resolvedTotalIncrease,
    total_damage_increase_from_history: resolvedHistoryIncrease,
    total_damage_increase_from_roster: resolvedRosterIncrease,
    final_team: targetTeamComposition,
    meta_team_progressions: metaTeamProgressions
  }
}

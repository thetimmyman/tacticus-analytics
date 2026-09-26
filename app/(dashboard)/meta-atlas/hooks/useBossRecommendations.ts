'use client'

import { useQuery } from '@tanstack/react-query'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type {
  BossData,
  BossRecommendation,
  CurrentSeasonBoss,
  MetaTeamProgression,
  TeamInfo,
  UpgradeStep
} from '../types'

async function fetchBossRecommendationsBatch(
  bosses: CurrentSeasonBoss[],
  options: {
    raritySets?: string[]
    season?: string
    minAttacks?: number
    limit?: number
  },
  personalized?: {
    roster?: RosterInputEntry[]
    currentTeams?: Record<
      string,
      {
        current_team?: string | null
        current_team_hash?: string | null
        encounter_index?: number | null
        rarity_set?: string | null
        season?: string | null
      }
    >
  }
): Promise<Map<string, BossData>> {
  if (bosses.length === 0) return new Map()

  try {
    const res = await fetch('/api/meta/boss-recommendations-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boss_types: bosses.map((b) => b.boss_type),
        season: options.season,
        min_attacks: options.minAttacks || 20,
        limit: options.limit || 20,
        ...(personalized?.roster && personalized.roster.length > 0
          ? { roster: personalized.roster }
          : {}),
        ...(personalized?.currentTeams &&
        Object.keys(personalized.currentTeams).length > 0
          ? { current_teams: personalized.currentTeams }
          : {})
      })
    })

    if (!res.ok) throw new Error('Failed to fetch batch recommendations')

    const data = await res.json()
    const results = data.results as Record<
      string,
      {
        boss_type: string
        boss_name: string
        recommendations: BossRecommendation[]
        error: string | null
        progressions?: Record<
          string,
          {
            current_team?: string | null
            current_team_info?: TeamInfo | null
            target_team?: string | null
            target_team_info?: TeamInfo | null
            best_buildable_team?: string | null
            best_buildable_info?: TeamInfo | null
            best_buildable_is_suitable?: boolean | null
            is_optimal?: boolean
            is_optimal_from_history?: boolean
            is_optimal_from_roster?: boolean
            history_equals_roster?: boolean
            optimal_message?: string | null
            upgrade_path?: UpgradeStep[]
            upgrade_path_from_history?: UpgradeStep[]
            upgrade_path_from_roster?: UpgradeStep[]
            total_damage_increase?: number
            total_damage_increase_from_history?: number
            total_damage_increase_from_roster?: number
            meta_team_progressions?: MetaTeamProgression[]
            progression_message?: string | null
            progression_error?: string | null
          }
        >
        current_team?: string | null
        current_team_info?: TeamInfo | null
        target_team?: string | null
        target_team_info?: TeamInfo | null
        best_buildable_team?: string | null
        best_buildable_info?: TeamInfo | null
        best_buildable_is_suitable?: boolean | null
        is_optimal?: boolean
        is_optimal_from_history?: boolean
        is_optimal_from_roster?: boolean
        history_equals_roster?: boolean
        optimal_message?: string | null
        final_team?: string | null
        upgrade_path?: UpgradeStep[]
        upgrade_path_from_history?: UpgradeStep[]
        upgrade_path_from_roster?: UpgradeStep[]
        total_damage_increase?: number
        total_damage_increase_from_history?: number
        total_damage_increase_from_roster?: number
        progression_message?: string | null
        progression_error?: string | null
        meta_team_progressions?: MetaTeamProgression[]
      }
    >

    const newMap = new Map<string, BossData>()

    for (const [bossType, result] of Object.entries(results)) {
      const recsByRaritySetAndEncounter = new Map<
        string,
        BossRecommendation[]
      >()

      for (const rec of result.recommendations) {
        const rs = rec.rarity_set || 'Unknown'
        const encIdx = rec.encounter_index ?? 0
        const groupKey = `${rs}|${encIdx}`
        if (!recsByRaritySetAndEncounter.has(groupKey)) {
          recsByRaritySetAndEncounter.set(groupKey, [])
        }
        recsByRaritySetAndEncounter.get(groupKey)!.push(rec)
      }

      const buildUpgradePayload = (source: typeof result) => {
        const upgradePath = Array.isArray(source.upgrade_path)
          ? source.upgrade_path
          : []
        const upgradePathFromHistory = Array.isArray(
          source.upgrade_path_from_history
        )
          ? source.upgrade_path_from_history
          : undefined
        const upgradePathFromRoster = Array.isArray(
          source.upgrade_path_from_roster
        )
          ? source.upgrade_path_from_roster
          : undefined
        return {
          current_team: source.current_team ?? null,
          current_team_info: source.current_team_info ?? null,
          target_team: source.target_team ?? source.final_team ?? null,
          target_team_info: source.target_team_info ?? null,
          best_buildable_team: source.best_buildable_team ?? null,
          best_buildable_info: source.best_buildable_info ?? null,
          best_buildable_is_suitable: source.best_buildable_is_suitable ?? null,
          is_optimal: source.is_optimal ?? false,
          is_optimal_from_history: source.is_optimal_from_history ?? undefined,
          is_optimal_from_roster: source.is_optimal_from_roster ?? undefined,
          history_equals_roster: source.history_equals_roster ?? undefined,
          optimal_message: source.optimal_message ?? null,
          upgrade_path: upgradePath,
          upgrade_path_from_history: upgradePathFromHistory,
          upgrade_path_from_roster: upgradePathFromRoster,
          total_damage_increase:
            typeof source.total_damage_increase === 'number'
              ? source.total_damage_increase
              : undefined,
          total_damage_increase_from_history:
            typeof source.total_damage_increase_from_history === 'number'
              ? source.total_damage_increase_from_history
              : undefined,
          total_damage_increase_from_roster:
            typeof source.total_damage_increase_from_roster === 'number'
              ? source.total_damage_increase_from_roster
              : undefined,
          meta_team_progressions: Array.isArray(source.meta_team_progressions)
            ? source.meta_team_progressions
            : undefined,
          progression_message: source.progression_message ?? null,
          progression_error: source.progression_error ?? null
        }
      }

      for (const [groupKey, recs] of recsByRaritySetAndEncounter) {
        const [raritySet, encIdxStr] = groupKey.split('|')
        if (!raritySet) continue
        const encounterIndex = parseInt(encIdxStr ?? '0', 10)
        const subBossName = recs[0]?.sub_boss_name || result.boss_name
        const key = `${raritySet}|${bossType}|${encounterIndex}`
        const groupProgressionKey = `${raritySet}|${encounterIndex}`
        const groupProgression = result.progressions?.[groupProgressionKey]
        const upgradePayload = groupProgression
          ? buildUpgradePayload(groupProgression as typeof result)
          : buildUpgradePayload(result)

        let lookupName = bossType
        if (
          encounterIndex > 0 &&
          subBossName &&
          subBossName !== result.boss_name
        ) {
          const bossBase = bossType
            .toLowerCase()
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .toLowerCase()
          const primeName = subBossName
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
          lookupName = `${bossBase}_${primeName}`
        }

        newMap.set(key, {
          boss_type: bossType,
          boss_name: subBossName,
          boss_lookup_name: lookupName,
          rarity_set: raritySet,
          encounter_index: encounterIndex,
          recommendations: recs,
          loading: false,
          error: result.error,
          ...upgradePayload
        })
      }
    }

    return newMap
  } catch (error) {
    console.error('[MetaAtlas] Batch fetch error:', error)
    const emptyMap = new Map<string, BossData>()
    for (const boss of bosses) {
      emptyMap.set(`Unknown|${boss.boss_type}|0`, {
        boss_type: boss.boss_type,
        boss_name: boss.boss_name,
        boss_lookup_name: boss.boss_type,
        rarity_set: 'Unknown',
        encounter_index: 0,
        recommendations: [],
        loading: false,
        error: 'Failed to load'
      })
    }
    return emptyMap
  }
}

export function useMultiBossRecommendations(
  bosses: CurrentSeasonBoss[],
  options: {
    raritySets?: string[]
    season?: string
    minAttacks?: number
    limit?: number
  },
  personalized?: {
    roster?: RosterInputEntry[]
    currentTeams?: Record<
      string,
      {
        current_team?: string | null
        current_team_hash?: string | null
        encounter_index?: number | null
        rarity_set?: string | null
        season?: string | null
      }
    >
    key?: string
  },
  config?: {
    requirePersonalized?: boolean
    /** Tab-scoped gate (default true); cached results survive while closed. */
    enabled?: boolean
  }
) {
  const bossKeys = bosses
    .map((b) => b.boss_type)
    .sort()
    .join(',')
  const requirePersonalized = config?.requirePersonalized ?? false
  const gateEnabled = config?.enabled ?? true
  const personalizedKey =
    personalized?.key ||
    (requirePersonalized && !personalized
      ? 'personalization-pending'
      : 'global')

  const {
    data: bossData,
    isLoading: loading,
    isPending
  } = useQuery({
    queryKey: [
      'bossRecommendationsBatch',
      bossKeys,
      options.season,
      options.minAttacks,
      options.limit,
      personalizedKey
    ],
    queryFn: () => fetchBossRecommendationsBatch(bosses, options, personalized),
    enabled:
      gateEnabled &&
      bosses.length > 0 &&
      !!options.season &&
      (!requirePersonalized || !!personalized),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  return { bossData: bossData ?? new Map(), loading, isPending }
}

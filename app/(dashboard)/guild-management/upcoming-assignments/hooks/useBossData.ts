import { useEffect, useMemo } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.useBossData'
)
import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import { useBossCatalog } from '@/app/lib/catalogs'
import { useBaseQuery } from '@/app/lib/hooks/shared'
import type { Rarity } from '@/app/lib/config'
import type {
  BossOption,
  LokiBoss,
  BossMapping,
  HistoricalPerformance,
  MetaTeamData,
  TokenPerformanceData
} from '../types'
import type { AssignmentState, AssignmentActions } from './useAssignmentState'
import { sortLevelsByPriority, bossNamesMatch } from '../utils/boss-helpers'

interface BossDataResult {
  bossMappings: BossMapping[]
  allBosses: BossOption[]
  allSubBosses: BossOption[]
  availableLevels: string[]
  historicalPerformance: HistoricalPerformance | null
  tokenPerformance: TokenPerformanceData | null
  enhancedData: {
    reliability?: Record<string, number>
    metaTeams?: MetaTeamData
    teamCompositions?: Record<string, unknown>[]
  } | null
  defaultBossSelections: Record<string, string>
  defaultSubBossSelections: Record<string, string>
}

async function fetchBossData(
  guildCode: string,
  selectedRarities: Rarity[],
  mode: 'current',
  bossMappings: BossMapping[],
  lokiCurrentBosses?: LokiBoss[]
): Promise<BossDataResult> {
  const supabase = dbClient()
  const uniqueBosses = new Map<string, BossOption>()
  const uniqueSubBosses = new Map<string, BossOption>()
  const levelSet = new Set<string>()

  const lokiBosses = lokiCurrentBosses
  const defaultBossSelections: Record<string, string> = {}
  const defaultSubBossSelections: Record<string, string> = {}

  if (lokiBosses && lokiBosses.length > 0) {
    lokiBosses.forEach((boss) => {
      const normalizedRarity = normalizeRarity(boss.rarity)
      const prefix = normalizedRarity ? getRarityPrefix(normalizedRarity) : 'L'
      const level = `${prefix}${boss.set + 1}`

      if (boss.encounter_id === 0) {
        if (!uniqueBosses.has(boss.boss_name)) {
          uniqueBosses.set(boss.boss_name, {
            boss_type: boss.boss_type,
            boss_name: boss.boss_name,
            tier: 0,
            set: boss.set,
            encounter_id: boss.encounter_id,
            rarity: boss.rarity as Rarity
          })
        }
        levelSet.add(level)
        if (selectedRarities.includes(normalizedRarity as Rarity)) {
          defaultBossSelections[level] = boss.boss_type
        }
      }
    })

    Object.entries(defaultBossSelections).forEach(([level, bossType]) => {
      const primesForBoss = bossMappings.filter(
        (mapping) =>
          mapping.encounter_index > 0 &&
          bossNamesMatch(mapping.boss_type, bossType)
      )

      const prime1 = primesForBoss.find(
        (mapping) => mapping.encounter_index === 1
      )
      const prime2 = primesForBoss.find(
        (mapping) => mapping.encounter_index === 2
      )

      if (prime1?.boss_name) {
        defaultSubBossSelections[`${level}_Sub1`] = prime1.boss_name
      }

      if (prime2?.boss_name) {
        defaultSubBossSelections[`${level}_Sub2`] = prime2.boss_name
      }
    })
  }

  if (mode === 'current') {
    let mainBossQuery = supabase
      .from('EOT_GR_data')
      .select('Name, set, encounterId, rarity')
      .eq('encounterId', 0)
      .not('Name', 'is', null)
      .in('rarity', selectedRarities)
      .order('rarity', { ascending: false })
      .order('set', { ascending: false })
      .order('Name')

    let subBossQuery = supabase
      .from('EOT_GR_data')
      .select('Name, set, encounterId, rarity')
      .in('encounterId', [1, 2])
      .not('Name', 'is', null)
      .in('rarity', selectedRarities)
      .order('rarity', { ascending: false })
      .order('set', { ascending: false })
      .order('Name')

    mainBossQuery = mainBossQuery.eq('Guild', guildCode)
    subBossQuery = subBossQuery.eq('Guild', guildCode)

    const [mainBossesResult, subBossesResult] = await Promise.all([
      mainBossQuery,
      subBossQuery
    ])

    if (mainBossesResult.error) throw mainBossesResult.error
    if (subBossesResult.error) throw subBossesResult.error

    mainBossesResult.data?.forEach((row) => {
      if (row.Name && !uniqueBosses.has(row.Name)) {
        uniqueBosses.set(row.Name, {
          boss_type: row.Name,
          boss_name: row.Name,
          tier: 0,
          set: row.set !== null && row.set !== undefined ? row.set : -1,
          encounter_id: row.encounterId,
          rarity: row.rarity as Rarity
        })

        if (row.set !== null && row.set !== undefined && row.rarity) {
          const normalizedRarity = normalizeRarity(row.rarity)
          const prefix = normalizedRarity
            ? getRarityPrefix(normalizedRarity)
            : 'L'
          const level = `${prefix}${row.set + 1}`
          levelSet.add(level)
        }
      }
    })

    subBossesResult.data?.forEach((row) => {
      if (!row.Name) return
      const key = `${row.Name}_${row.encounterId}`
      if (!uniqueSubBosses.has(key)) {
        uniqueSubBosses.set(key, {
          boss_type: row.Name,
          boss_name: row.Name,
          tier: 0,
          set: row.set !== null && row.set !== undefined ? row.set : -1,
          encounter_id: row.encounterId,
          rarity: row.rarity as Rarity
        })
      }
    })
  }

  bossMappings.forEach((mapping) => {
    if (mapping.encounter_index <= 0) return
    if (!mapping.boss_name) return

    const key = `${mapping.boss_name}_${mapping.encounter_index}`
    if (uniqueSubBosses.has(key)) return

    uniqueSubBosses.set(key, {
      boss_type: mapping.boss_name,
      boss_name: mapping.boss_name,
      tier: mapping.tier ?? 0,
      set: -1,
      encounter_id: mapping.encounter_index,
      rarity: 'Legendary' as Rarity
    })
  })

  selectedRarities.forEach((rarity) => {
    const prefix = getRarityPrefix(rarity)
    if (prefix === 'L') {
      for (let i = 1; i <= 5; i++) {
        levelSet.add(`L${i}`)
      }
    } else if (prefix === 'M') {
      // Known mythic levels as a fallback; more are added from data.
      for (let i = 1; i <= 2; i++) {
        levelSet.add(`M${i}`)
      }
    } else {
      levelSet.add(`${prefix}1`)
    }
  })

  const levels = sortLevelsByPriority(Array.from(levelSet), selectedRarities)

  const [historicalPerformance, tokenPerformance, enhancedData] =
    await Promise.all([
      fetch(`/api/upcoming/historical-performance?guild_code=${guildCode}`)
        .then(async (r) =>
          r.ok ? ((await r.json()) as HistoricalPerformance) : null
        )
        .catch((error) => {
          logger.error({ err: error }, 'Error fetching historical performance:')
          return null
        }),
      fetch(`/api/upcoming/token-performance?guild_code=${guildCode}`)
        .then(async (r) =>
          r.ok ? ((await r.json()) as TokenPerformanceData) : null
        )
        .catch((error) => {
          logger.error({ err: error }, 'Error fetching token performance:')
          return null
        }),
      fetch('/api/upcoming/enhanced-data')
        .then(
          async (
            r
          ): Promise<{
            reliability?: Record<string, number>
            metaTeams?: MetaTeamData
            teamCompositions?: Record<string, unknown>[]
          } | null> => (r.ok ? r.json() : null)
        )
        .catch((error) => {
          logger.error({ err: error }, 'Error fetching enhanced data:')
          return null
        })
    ])

  return {
    bossMappings,
    allBosses: Array.from(uniqueBosses.values()),
    allSubBosses: Array.from(uniqueSubBosses.values()),
    availableLevels: levels,
    historicalPerformance,
    tokenPerformance,
    enhancedData,
    defaultBossSelections,
    defaultSubBossSelections
  }
}

export function useBossData(
  state: AssignmentState,
  actions: AssignmentActions,
  guildCode: string,
  mode: 'current',
  // In the query key so a season change busts the cache.
  seasonNumber?: string,
  lokiCurrentBosses?: LokiBoss[]
) {
  const bossCatalogQuery = useBossCatalog()
  const bossMappings = useMemo(
    () =>
      (bossCatalogQuery.data?.getMappings() as BossMapping[] | undefined) ?? [],
    [bossCatalogQuery.data]
  )
  const lokiBossesKey = 'db-current'

  const { data, isLoading } = useBaseQuery({
    queryKey: [
      'boss-data',
      guildCode,
      state.selectedRarities.join(','),
      mode,
      seasonNumber ?? 'current',
      lokiBossesKey
    ],
    queryFn: () =>
      fetchBossData(
        guildCode,
        state.selectedRarities,
        mode,
        bossMappings,
        lokiCurrentBosses
      ),
    enabled: Boolean(guildCode) && Boolean(bossCatalogQuery.data),
    cacheDuration: 5 * 60 * 1000
  })

  useEffect(() => {
    actions.setLoading(isLoading || bossCatalogQuery.isLoading)
  }, [isLoading, bossCatalogQuery.isLoading, actions])

  useEffect(() => {
    if (!data) return

    actions.setBossMappings(data.bossMappings)
    actions.setAllBosses(data.allBosses)
    actions.setAllSubBosses(data.allSubBosses)
    actions.setAvailableLevels(data.availableLevels)

    if (data.historicalPerformance) {
      actions.setHistoricalPerformance(data.historicalPerformance)
    }

    if (data.tokenPerformance) {
      actions.setTokenPerformance(data.tokenPerformance)
    }

    if (data.enhancedData) {
      if (data.enhancedData.reliability)
        actions.setReliabilityScores(data.enhancedData.reliability)
      if (data.enhancedData.metaTeams)
        actions.setMetaTeamData(data.enhancedData.metaTeams)
      if (data.enhancedData.teamCompositions)
        actions.setTeamCompositions(data.enhancedData.teamCompositions)
    }

    const levels = data.availableLevels

    // No "keep if non-empty" gate: nothing edits selectedBosses, so it would pin stale names.
    actions.setSelectedBosses(() => {
      const initialBosses: Record<string, string> = {}
      levels.forEach((level) => {
        initialBosses[level] = data.defaultBossSelections[level] || ''
      })
      return initialBosses
    })

    actions.setSelectedSubBosses(() => {
      const initialSubBosses: Record<string, string> = {}
      levels.forEach((level) => {
        initialSubBosses[`${level}_Sub1`] =
          data.defaultSubBossSelections[`${level}_Sub1`] || ''
        initialSubBosses[`${level}_Sub2`] =
          data.defaultSubBossSelections[`${level}_Sub2`] || ''
      })
      return initialSubBosses
    })

    actions.setSkippedPrimes((prev) => {
      if (Object.keys(prev).length > 0) {
        return prev
      }
      const initialSkipSettings: Record<string, boolean> = {}
      levels.forEach((level) => {
        initialSkipSettings[`${level}_Sub1`] = false
        initialSkipSettings[`${level}_Sub2`] = false
      })
      return initialSkipSettings
    })
  }, [data, actions])

  useEffect(() => {
    if (state.bossMappings.length === 0) return
    if (state.subBossesLoadedFromDB) return
    if (Object.keys(state.selectedBosses).length === 0) return

    const updates: Record<string, string> = {}

    Object.entries(state.selectedBosses).forEach(([level, bossName]) => {
      if (bossName) {
        const primesForBoss = state.bossMappings.filter(
          (mapping) =>
            bossNamesMatch(mapping.boss_type, bossName) &&
            mapping.encounter_index > 0
        )

        const prime1 = primesForBoss.find((p) => p.encounter_index === 1)
        const prime2 = primesForBoss.find((p) => p.encounter_index === 2)

        if (prime1?.boss_name) {
          updates[`${level}_Sub1`] = prime1.boss_name
        }
        if (prime2?.boss_name) {
          updates[`${level}_Sub2`] = prime2.boss_name
        }
      }
    })

    if (Object.keys(updates).length > 0) {
      actions.setSelectedSubBosses((prev) => {
        const hasChanges = Object.entries(updates).some(
          ([key, value]) => prev[key as keyof typeof prev] !== value
        )
        if (!hasChanges) return prev
        return { ...prev, ...updates }
      })
    }
  }, [
    state.selectedBosses,
    state.bossMappings,
    state.subBossesLoadedFromDB,
    actions
  ])
}

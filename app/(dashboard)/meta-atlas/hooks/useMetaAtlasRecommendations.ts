'use client'

import { useMemo } from 'react'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type {
  BossData,
  BossRecommendation,
  CurrentSeasonBoss,
  MetaFilters
} from '../types'
import { useMultiBossRecommendations } from './useBossRecommendations'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

type PersonalizedPayload = {
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
}

type GroupedBossEntry = {
  key: string
  raritySet: string
  bossName: string
  bossType: string
  main: BossData | null
  prime1: BossData | null
  prime2: BossData | null
}

const EMPTY_BOSS_DATA = new Map<string, BossData>()

export function useMetaAtlasRecommendations(options: {
  filters: MetaFilters | null
  showAllBosses: boolean
  bossFilter: string
  resolveBoss: (
    bossType: string,
    bossName?: string,
    bossUnitId?: string
  ) => CurrentSeasonBoss
  selectedRaritySets: Set<string>
  selectedMetaTeams: Set<string>
  currentSeason: string
  personalizedPayload?: PersonalizedPayload
  requirePersonalized?: boolean
  /** When false no batch is issued; `filters`-derived values (displayBosses) still resolve. */
  enabled?: boolean
}) {
  const displayBosses = useMemo(() => {
    const currentSeasonBosses = options.filters?.current_season_bosses || []
    const allBosses = options.filters?.bosses || []

    let baseBosses: CurrentSeasonBoss[]
    if (options.showAllBosses) {
      baseBosses = allBosses.map((bossType) =>
        options.resolveBoss(bossType, getBossDisplayName(bossType))
      )
    } else {
      baseBosses =
        currentSeasonBosses.length > 0
          ? currentSeasonBosses.map((boss) =>
              options.resolveBoss(
                boss.boss_type,
                boss.boss_name,
                boss.boss_unit_id
              )
            )
          : allBosses
              .slice(0, 5)
              .map((bossType) =>
                options.resolveBoss(bossType, getBossDisplayName(bossType))
              )
    }

    if (options.bossFilter.trim()) {
      const filterLower = options.bossFilter.toLowerCase()
      return baseBosses.filter(
        (boss) =>
          boss.boss_name.toLowerCase().includes(filterLower) ||
          boss.boss_type.toLowerCase().includes(filterLower)
      )
    }

    return baseBosses
  }, [options])

  const gateEnabled = options.enabled ?? true

  const {
    bossData,
    loading: recsLoading,
    isPending
  } = useMultiBossRecommendations(
    displayBosses,
    {
      raritySets: Array.from(options.selectedRaritySets),
      season: options.currentSeason,
      minAttacks: 10,
      limit: 20
    },
    options.personalizedPayload,
    {
      requirePersonalized: options.requirePersonalized,
      enabled: gateEnabled
    }
  )
  const personalizationPending = Boolean(
    options.requirePersonalized && !options.personalizedPayload
  )
  // Keep derived UI empty until the private key exists so Team Ideas never flashes global data.
  const visibleBossData = personalizationPending ? EMPTY_BOSS_DATA : bossData
  // A just-opened gate reports `isLoading: false` for one render; treat it as loading.
  const awaitingFirstFetch =
    gateEnabled &&
    isPending &&
    displayBosses.length > 0 &&
    !!options.currentSeason
  const resolvedLoading =
    recsLoading || personalizationPending || awaitingFirstFetch

  const availableMetaTeams = useMemo(() => {
    const teams = new Set<string>()
    visibleBossData.forEach((data) => {
      data.recommendations.forEach((rec: BossRecommendation) => {
        if (rec.meta_team) teams.add(rec.meta_team)
      })
    })
    return Array.from(teams).sort()
  }, [visibleBossData])

  const filteredBossData = useMemo(() => {
    const filtered = new Map<string, BossData>()
    visibleBossData.forEach((data, key) => {
      if (
        options.selectedRaritySets.size > 0 &&
        !options.selectedRaritySets.has(data.rarity_set)
      ) {
        return
      }
      const filteredRecs = data.recommendations.filter(
        (rec: BossRecommendation) => {
          if (
            options.selectedMetaTeams.size > 0 &&
            (!rec.meta_team || !options.selectedMetaTeams.has(rec.meta_team))
          ) {
            return false
          }
          return true
        }
      )
      if (filteredRecs.length > 0) {
        filtered.set(key, { ...data, recommendations: filteredRecs })
      }
    })
    return filtered
  }, [visibleBossData, options.selectedMetaTeams, options.selectedRaritySets])

  const groupedByRaritySet = useMemo<GroupedBossEntry[]>(() => {
    const groups = new Map<
      string,
      {
        main: BossData | null
        prime1: BossData | null
        prime2: BossData | null
        bossType: string
      }
    >()

    filteredBossData.forEach((data) => {
      const groupKey = `${data.rarity_set}|${data.boss_type}`
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          main: null,
          prime1: null,
          prime2: null,
          bossType: data.boss_type
        })
      }
      const group = groups.get(groupKey)!
      if (data.encounter_index === 0) {
        const currentMainDamage =
          group.main?.recommendations?.[0]?.damage_p90 ?? 0
        const dataDamage = data.recommendations?.[0]?.damage_p90 ?? 0
        if (!group.main || dataDamage > currentMainDamage) {
          group.main = data
        }
      } else if (data.encounter_index === 1) {
        const currentPrimeDamage =
          group.prime1?.recommendations?.[0]?.damage_p90 ?? 0
        const dataDamage = data.recommendations?.[0]?.damage_p90 ?? 0
        if (!group.prime1 || dataDamage > currentPrimeDamage) {
          group.prime1 = data
        }
      } else if (data.encounter_index === 2) {
        const currentPrimeDamage =
          group.prime2?.recommendations?.[0]?.damage_p90 ?? 0
        const dataDamage = data.recommendations?.[0]?.damage_p90 ?? 0
        if (!group.prime2 || dataDamage > currentPrimeDamage) {
          group.prime2 = data
        }
      }
    })

    return Array.from(groups.entries())
      .map(([groupKey, group]) => {
        const raritySet = groupKey.split('|')[0] ?? ''
        const primaryData = group.main || group.prime1 || group.prime2
        return {
          ...group,
          key: groupKey,
          raritySet,
          bossName: primaryData?.boss_name || 'Unknown',
          bossType: group.bossType || primaryData?.boss_type || ''
        }
      })
      .sort((a, b) => {
        const order: Record<string, number> = {
          M5: 1,
          M4: 2,
          M3: 3,
          M2: 4,
          M1: 5,
          L5: 6,
          L4: 7,
          L3: 8,
          L2: 9,
          L1: 10
        }
        const aOrder = order[a.raritySet] || 99
        const bOrder = order[b.raritySet] || 99
        if (aOrder !== bOrder) return aOrder - bOrder
        return a.bossType.localeCompare(b.bossType)
      })
  }, [filteredBossData])

  return {
    displayBosses,
    availableMetaTeams,
    groupedByRaritySet,
    recsLoading: resolvedLoading
  }
}

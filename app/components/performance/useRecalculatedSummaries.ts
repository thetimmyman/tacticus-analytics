'use client'

import { useMemo } from 'react'
import { createStablePlayerKey } from '@/app/lib/utils/player-resolution'
import { normalizeDisplayName } from '@/app/lib/utils/normalize'
import type { PerformanceSummary } from '@tacticus/app-core/performance.types'
import type { CompareMode } from '@/app/components/performance/types'

export interface FiveSeasonPlayerRow {
  player_name?: string | null
  player_id?: string | null
  is_current_member?: boolean | null
  battle_count?: number | null
  encounter_id?: number | null
  boss_name?: string | null
  vs_guild_pct?: number | null
  vs_cluster_pct?: number | null
}

export interface UseRecalculatedSummariesParams {
  showFiveSeasonAvg: boolean
  playerFiveSeasonData: FiveSeasonPlayerRow[]
  compareMode: CompareMode
  latestDisplayNames: Map<string, string>
  currentDisplayNames: Map<string, string>
  playerMembershipMap: Map<string, boolean>
  selectedGuild: string
  calculationSummaries?: PerformanceSummary[]
}

interface FiveSeasonAggregation {
  playerId?: string
  displayName?: string | null
  latestDisplayName?: string | null
  totalBattles: number
  weightedGuildSum: number
  weightedClusterSum: number
  weightedGuildBossSum: number
  weightedClusterBossSum: number
  totalWeight: number
  bossOnlyWeight: number
  uniqueBosses: Set<string>
  uniquePrimes: Set<string>
  isActive?: boolean
}

export function useRecalculatedSummaries({
  showFiveSeasonAvg,
  playerFiveSeasonData,
  compareMode,
  latestDisplayNames,
  currentDisplayNames,
  playerMembershipMap,
  selectedGuild,
  calculationSummaries = []
}: UseRecalculatedSummariesParams): PerformanceSummary[] {
  const fallbackSummaries = useMemo(() => {
    return Array.isArray(calculationSummaries) ? calculationSummaries : []
  }, [calculationSummaries])

  const computedSummaries = useMemo<PerformanceSummary[]>(() => {
    if (!showFiveSeasonAvg || playerFiveSeasonData.length === 0) return []

    const playerMap = new Map<string, FiveSeasonAggregation>()

    playerFiveSeasonData.forEach((row) => {
      if (!row.player_name) return

      const playerId =
        typeof row.player_id === 'string' && row.player_id.trim().length > 0
          ? row.player_id.trim()
          : undefined

      const playerKey = createStablePlayerKey(
        playerId,
        row.player_name,
        selectedGuild
      )
      if (!playerKey) return

      const rawActiveStatus = row?.is_current_member
      const rowActiveStatus =
        rawActiveStatus === true
          ? true
          : rawActiveStatus === false
            ? false
            : undefined

      const existing =
        playerMap.get(playerKey) ||
        ({
          playerId,
          displayName: row.player_name,
          latestDisplayName: row.player_name,
          totalBattles: 0,
          weightedGuildSum: 0,
          weightedClusterSum: 0,
          weightedGuildBossSum: 0,
          weightedClusterBossSum: 0,
          totalWeight: 0,
          bossOnlyWeight: 0,
          uniqueBosses: new Set<string>(),
          uniquePrimes: new Set<string>(),
          isActive: rowActiveStatus
        } satisfies FiveSeasonAggregation)

      if (playerId && !existing.playerId) {
        existing.playerId = playerId
      }

      if (
        typeof row.player_name === 'string' &&
        row.player_name.trim().length > 0
      ) {
        existing.displayName = row.player_name
      }

      if (playerId) {
        const latestName = latestDisplayNames.get(playerId)
        if (latestName && latestName.trim().length > 0) {
          existing.latestDisplayName = latestName
        }

        const currentName = currentDisplayNames.get(playerId)
        if (currentName && currentName.trim().length > 0) {
          existing.latestDisplayName = currentName
          existing.displayName = currentName
        }
      }

      if (!existing.latestDisplayName && typeof row.player_name === 'string') {
        existing.latestDisplayName = row.player_name
      }

      if (rowActiveStatus !== undefined) {
        existing.isActive = rowActiveStatus
      }

      const weight = row.battle_count || 1
      const encounterId =
        row.encounter_id ?? (row.boss_name?.includes('Prime') ? 1 : 0)
      const isPrimeBoss = encounterId > 0

      if (
        (compareMode === 'guild-boss' || compareMode === 'cluster-boss') &&
        isPrimeBoss
      ) {
        return
      }

      existing.totalBattles += weight
      existing.totalWeight += weight

      existing.weightedGuildSum += (row.vs_guild_pct || 0) * weight
      existing.weightedClusterSum += (row.vs_cluster_pct || 0) * weight

      if (!isPrimeBoss) {
        existing.uniqueBosses.add(row.boss_name ?? '')
        existing.bossOnlyWeight += weight
        existing.weightedGuildBossSum += (row.vs_guild_pct || 0) * weight
        existing.weightedClusterBossSum += (row.vs_cluster_pct || 0) * weight
      } else {
        existing.uniquePrimes.add(row.boss_name ?? '')
      }

      playerMap.set(playerKey, existing)
    })

    return Array.from(playerMap.values()).map((player) => {
      const currentName = player.playerId
        ? currentDisplayNames.get(player.playerId)
        : undefined
      const resolvedName =
        currentName && currentName.trim().length > 0
          ? currentName
          : player.latestDisplayName || player.displayName

      const membershipById = player.playerId
        ? playerMembershipMap.get(player.playerId)
        : undefined
      const membershipByName =
        membershipById === undefined
          ? playerMembershipMap.get(normalizeDisplayName(resolvedName))
          : undefined
      const resolvedActive =
        membershipById !== undefined
          ? membershipById
          : membershipByName !== undefined
            ? membershipByName
            : player.isActive

      return {
        displayName: resolvedName,
        playerId: player.playerId,
        avg_vs_cluster:
          player.totalWeight > 0
            ? player.weightedClusterSum / player.totalWeight
            : 0,
        avg_vs_guild:
          player.totalWeight > 0
            ? player.weightedGuildSum / player.totalWeight
            : 0,
        avg_vs_cluster_boss_only:
          player.bossOnlyWeight > 0
            ? player.weightedClusterBossSum / player.bossOnlyWeight
            : 0,
        avg_vs_guild_boss_only:
          player.bossOnlyWeight > 0
            ? player.weightedGuildBossSum / player.bossOnlyWeight
            : 0,
        total_battles: player.totalBattles,
        bosses_played: player.uniqueBosses.size,
        primes_played: player.uniquePrimes.size,
        boss_hits: Math.floor(player.bossOnlyWeight),
        prime_hits: player.totalBattles - Math.floor(player.bossOnlyWeight),
        isActive: resolvedActive === undefined ? true : resolvedActive
      } as PerformanceSummary
    })
  }, [
    showFiveSeasonAvg,
    playerFiveSeasonData,
    compareMode,
    latestDisplayNames,
    currentDisplayNames,
    playerMembershipMap,
    selectedGuild
  ])

  if (computedSummaries.length > 0) {
    return computedSummaries
  }

  return fallbackSummaries
}

import { useState, useMemo } from 'react'
import type {
  PlayerStats,
  BossStatDetail
} from '@/app/components/playerstats/types'
import { useGuildBossAverages } from './useGuildBossAverages'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

/** The guild has not fought this boss. */
export const VS_GUILD_NA = -9999

export interface GuildComparisonOverlay {
  isCompareToUserGuild: boolean
  setCompareToUserGuild: (value: boolean) => void
  canCompare: boolean
  isLoadingUserGuildAverages: boolean
  effectiveStats: PlayerStats
  comparisonGuildLabel: string
}

function buildBossKey(
  bossName: string,
  rarity: string,
  setNum?: number
): string {
  return `${bossName}_${rarity}_${setNum ?? 0}`
}

function parseBossStatsKey(
  key: string
): { bossName: string; rarity: string; set: number } | null {
  const parts = key.split('_')
  if (parts.length < 2) return null
  const bossName = parts[0]
  const rarity = parts[1]
  if (!bossName || !rarity) return null
  return {
    bossName,
    rarity,
    set: parseInt(parts[2] ?? '0', 10) || 0
  }
}

function overlayBossStats(
  original: Record<string, BossStatDetail>,
  guildAverages: Map<string, { avg_damage: number }>
): Record<string, BossStatDetail> {
  const result: Record<string, BossStatDetail> = {}
  for (const [key, stats] of Object.entries(original)) {
    const parsed = parseBossStatsKey(key)
    if (!parsed) {
      result[key] = stats
      continue
    }
    const lookupKey = buildBossKey(parsed.bossName, parsed.rarity, parsed.set)
    const guildAvg = guildAverages.get(lookupKey)

    if (guildAvg && guildAvg.avg_damage > 0 && stats.avgDamage > 0) {
      result[key] = {
        ...stats,
        vsGuildAvg: (stats.avgDamage / guildAvg.avg_damage - 1) * 100
      }
    } else {
      result[key] = { ...stats, vsGuildAvg: VS_GUILD_NA }
    }
  }
  return result
}

function computeWeightedOverall(
  bossStats: Record<string, BossStatDetail>,
  primeStats: Record<string, BossStatDetail>
): number {
  let weightedSum = 0
  let totalTokens = 0

  for (const stats of Object.values(bossStats)) {
    if (stats.vsGuildAvg === VS_GUILD_NA || !stats.tokens) continue
    weightedSum += stats.vsGuildAvg * stats.tokens
    totalTokens += stats.tokens
  }
  for (const stats of Object.values(primeStats)) {
    if (stats.vsGuildAvg === VS_GUILD_NA || !stats.tokens) continue
    weightedSum += stats.vsGuildAvg * stats.tokens
    totalTokens += stats.tokens
  }

  return totalTokens > 0 ? weightedSum / totalTokens : 0
}

export function useGuildComparisonOverlay(options: {
  playerStats: PlayerStats
  playerGuildCode: string
  userGuildCode: string
  userGuildName: string
  playerGuildName: string
  season: string
}): GuildComparisonOverlay {
  const {
    playerStats,
    playerGuildCode,
    userGuildCode,
    userGuildName,
    playerGuildName,
    season
  } = options

  const [isCompareToUserGuild, setCompareToUserGuild] = useState(false)

  const canCompare =
    !!userGuildCode &&
    !!playerGuildCode &&
    userGuildCode.toLowerCase() !== playerGuildCode.toLowerCase()

  const { data: userGuildAverages, isLoading: isLoadingUserGuildAverages } =
    useGuildBossAverages(userGuildCode, season, {
      enabled: canCompare && isCompareToUserGuild
    })

  const effectiveStats = useMemo(() => {
    if (!canCompare || !isCompareToUserGuild || !userGuildAverages) {
      return playerStats
    }

    const overlaidBoss = overlayBossStats(
      playerStats.bossStats ?? {},
      userGuildAverages
    )
    const overlaidPrime = overlayBossStats(
      playerStats.primeStats ?? {},
      userGuildAverages
    )
    const overallVsGuild = computeWeightedOverall(overlaidBoss, overlaidPrime)

    return {
      ...playerStats,
      vsGuildAvg: overallVsGuild,
      bossStats: overlaidBoss,
      primeStats: overlaidPrime
    }
  }, [canCompare, isCompareToUserGuild, playerStats, userGuildAverages])

  const comparisonGuildLabel = useMemo(() => {
    if (canCompare && isCompareToUserGuild) {
      return (
        userGuildName ||
        formatGuildDisplayLabel(null, userGuildCode || 'Your Guild')
      )
    }
    return (
      playerGuildName ||
      formatGuildDisplayLabel(null, playerGuildCode || 'Guild')
    )
  }, [
    canCompare,
    isCompareToUserGuild,
    userGuildName,
    userGuildCode,
    playerGuildName,
    playerGuildCode
  ])

  return {
    isCompareToUserGuild,
    setCompareToUserGuild,
    canCompare,
    isLoadingUserGuildAverages:
      canCompare && isCompareToUserGuild && isLoadingUserGuildAverages,
    effectiveStats,
    comparisonGuildLabel
  }
}

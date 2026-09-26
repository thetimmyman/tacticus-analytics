import { useQuery } from '@tanstack/react-query'
import { assertClientSession, dbClient } from '@/app/lib/db/client'
import type { Database } from '@tacticus/app-core/types'
import { rarityRank } from '@/app/lib/config'

export const queryKeys = {
  guildData: (guild: string, season: string) =>
    ['guild', guild, season] as const,
  guildMembers: (guild: string) => ['members', guild] as const,
  guildConfig: (guild: string) => ['config', guild] as const,
  playerStats: (player: string, season: string) =>
    ['player', player, season] as const,
  playerBattles: (player: string, season: string) =>
    ['battles', player, season] as const,
  playerProfile: (userId: string) => ['profile', userId] as const,
  bosses: (season: string, rarityFilter?: string[]) =>
    ['bosses', season, rarityFilter || ['Legendary', 'Mythic']] as const,
  bossPerformance: (boss: string, season: string) =>
    ['boss', boss, season] as const,
  bossPerformanceOverview: (guild: string, season: string, level: string) =>
    ['boss-performance-overview', guild, season, level] as const,
  tokens: (guild: string, season: string) => ['tokens', guild, season] as const,
  votlwData: (guild: string, season: string) =>
    ['votlw-data', guild, season] as const,
  upcomingAssignments: (guild: string) =>
    ['upcoming-assignments', guild] as const,
  bossData: (guild: string, rarities: string, mode: string) =>
    ['boss-data', guild, rarities, mode] as const,
  playerData: (guild: string, season: string, mode: string) =>
    ['player-data', guild, season, mode] as const,
  calculations: (guild: string, season: string, calculationIds: string[]) =>
    ['calculations', guild, season, ...calculationIds] as const,
  tokenUsageByLoop: (guild: string, season: string) =>
    ['token-usage-by-loop', guild, season] as const,
  tokenUsageByLoopAndSet: (guild: string, season: string) =>
    ['token-usage-by-loop-and-set', guild, season] as const,
  damageByBossLoop: (guild: string, season: string) =>
    ['damage-by-boss-loop', guild, season] as const,
  playerDamageByBossLoop: (
    guild: string,
    season: string,
    displayName: string
  ) => ['player-damage-by-boss-loop', guild, season, displayName] as const,
  playerDamageByLoopForBoss: (
    guild: string,
    season: string,
    bossName: string,
    level: string
  ) =>
    ['player-damage-by-loop-for-boss', guild, season, bossName, level] as const,
  bossDifficultyAnalysis: (guild: string, season: string, rarities: string[]) =>
    ['boss-difficulty-analysis', guild, season, rarities] as const
} as const

export function useGuildData(
  guild: string,
  season: string,
  limit: number = 500
) {
  return useQuery({
    queryKey: queryKeys.guildData(guild, season),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      const { data, error } = await supabase
        .from('EOT_GR_data')
        .select(
          'displayName, damageDealt, damageType, tier, set, timestamp, Name, Season, Guild, rarity, loopIndex'
        )
        .eq('Guild', guild)
        .eq('Season', season)
        .order('timestamp', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

import {
  getTokenUsageByLoop,
  getTokenUsageByLoopAndSet,
  getDamageByBossLoop,
  getBossDifficultyAnalysis,
  type TokenUsageByLoopResult,
  type TokenUsageByLoopAndSetResult,
  type DamageByBossLoopResult,
  type BossDifficultyResult,
  getPlayerDamageByBossLoop,
  type PlayerDamageByBossLoopResult,
  getPlayerDamageByLoopForBoss,
  type PlayerLoopDamage
} from '@/app/lib/data/dashboard-calculations'

export function useTokenUsageByLoop(
  guild: string,
  season: string,
  options?: { enabled?: boolean; rarities?: string[] }
) {
  const rarities = options?.rarities ?? ['Legendary', 'Mythic']
  const isEnabled = options?.enabled ?? (!!guild && !!season)

  return useQuery({
    queryKey: [...queryKeys.tokenUsageByLoop(guild, season), rarities],
    queryFn: () => getTokenUsageByLoop(guild, season, rarities),
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useTokenUsageByLoopAndSet(
  guild: string,
  season: string,
  options?: { enabled?: boolean; rarities?: string[] }
) {
  const rarities = options?.rarities ?? ['Legendary', 'Mythic']
  return useQuery({
    queryKey: [...queryKeys.tokenUsageByLoopAndSet(guild, season), rarities],
    queryFn: () => getTokenUsageByLoopAndSet(guild, season, rarities),
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useDamageByBossLoop(
  guild: string,
  season: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.damageByBossLoop(guild, season),
    queryFn: () => getDamageByBossLoop(guild, season),
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function usePlayerDamageByBossLoop(
  guild: string,
  season: string,
  displayName: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.playerDamageByBossLoop(guild, season, displayName),
    queryFn: () => getPlayerDamageByBossLoop(guild, season, displayName),
    enabled: options?.enabled ?? (!!guild && !!season && !!displayName),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useBossDifficultyAnalysis(
  guild: string,
  season: string,
  rarities: string[] = ['Legendary', 'Mythic'],
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.bossDifficultyAnalysis(guild, season, rarities),
    queryFn: () => getBossDifficultyAnalysis(guild, season, rarities),
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function usePlayerDamageByLoopForBoss(
  guild: string,
  season: string,
  bossName: string,
  level: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.playerDamageByLoopForBoss(
      guild,
      season,
      bossName,
      level
    ),
    queryFn: () => getPlayerDamageByLoopForBoss(guild, season, bossName, level),
    enabled: options?.enabled ?? (!!guild && !!season && !!bossName && !!level),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export type {
  TokenUsageByLoopResult,
  TokenUsageByLoopAndSetResult,
  DamageByBossLoopResult,
  PlayerDamageByBossLoopResult,
  BossDifficultyResult,
  PlayerLoopDamage
}

import {
  getPlayerBossPerformanceRPC,
  type PlayerBossPerformanceRow
} from '@/app/lib/calculations/experimental/player-boss-performance'
import { getPlayerPerformanceSummaryRPC } from '@/app/lib/calculations/experimental/player-performance-summary'
import {
  getGuildVsClusterBossPerformanceRPC,
  type GuildVsClusterBossRow
} from '@/app/lib/calculations/experimental/guild-vs-cluster'
import {
  getGuildTrendsBatchRPC,
  type GuildTrendsRow
} from '@/app/lib/calculations/experimental/guild-trends'

export const playerQueryKeys = {
  playerBossPerformance: (guild: string, season: string, rarities?: string[]) =>
    [
      'player-boss-performance',
      guild,
      season,
      rarities ?? ['Legendary', 'Mythic']
    ] as const,
  playerPerformanceSummary: (
    guild: string,
    season: string,
    rarities?: string[]
  ) =>
    [
      'player-performance-summary',
      guild,
      season,
      rarities ?? ['Legendary', 'Mythic']
    ] as const,
  guildVsClusterBoss: (guild: string, season: string, rarities?: string[]) =>
    [
      'guild-vs-cluster-boss',
      guild,
      season,
      rarities ?? ['Legendary', 'Mythic']
    ] as const,
  guildTrendsBatch: (guild: string, seasons: string[]) =>
    ['guild-trends-batch', guild, ...seasons] as const
}

export function usePlayerBossPerformance(
  guild: string,
  season: string,
  options?: { enabled?: boolean; rarities?: string[] }
) {
  return useQuery({
    queryKey: playerQueryKeys.playerBossPerformance(
      guild,
      season,
      options?.rarities
    ),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      return getPlayerBossPerformanceRPC(supabase, {
        Guild: guild,
        Season: season,
        displayName: '',
        rarities: options?.rarities
      })
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function usePlayerPerformanceSummary(
  guild: string,
  season: string,
  options?: { enabled?: boolean; rarities?: string[] }
) {
  return useQuery({
    queryKey: playerQueryKeys.playerPerformanceSummary(
      guild,
      season,
      options?.rarities
    ),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      return getPlayerPerformanceSummaryRPC(supabase, {
        Guild: guild,
        Season: season,
        rarities: options?.rarities
      })
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useGuildVsClusterBossPerformance(
  guild: string,
  season: string,
  options?: {
    enabled?: boolean
    rarities?: string[]
    initialData?: GuildVsClusterBossRow[]
  }
) {
  return useQuery({
    queryKey: playerQueryKeys.guildVsClusterBoss(
      guild,
      season,
      options?.rarities
    ),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      return getGuildVsClusterBossPerformanceRPC(supabase, {
        Guild: guild,
        Season: season,
        rarities: options?.rarities
      })
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    initialData: options?.initialData
  })
}

export type { PlayerBossPerformanceRow }
export type { GuildTrendsRow }

export function useGuildTrendsBatch(
  guild: string,
  seasons: string[],
  options?: { enabled?: boolean; initialData?: GuildTrendsRow[] }
) {
  return useQuery({
    queryKey: playerQueryKeys.guildTrendsBatch(guild, seasons),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      return getGuildTrendsBatchRPC(supabase, {
        guild_code: guild,
        seasons
      })
    },
    enabled: options?.enabled ?? (!!guild && seasons.length > 0),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    initialData: options?.initialData
  })
}

import {
  getGuildVsClusterPrimePerformanceRPC,
  type GuildVsClusterPrimeRow
} from '@/app/lib/calculations/experimental/guild-vs-cluster-primes'

export type { GuildVsClusterBossRow }
export type { GuildVsClusterPrimeRow }

export const bossQueryKeys = {
  bossPerformanceMetrics: (guild: string, season: string) =>
    ['boss-performance-metrics', guild, season] as const,
  guildVsClusterBossPerformance: (guild: string, season: string) =>
    ['guild-vs-cluster-boss-performance', guild, season] as const,
  guildVsClusterPrimePerformance: (guild: string, season: string) =>
    ['guild-vs-cluster-prime-performance', guild, season] as const,
  totalDamage: (guild: string, season: string) =>
    ['total-damage', guild, season] as const,
  maxLoop: (guild: string, season: string) =>
    ['max-loop', guild, season] as const
}

export type BossPerformanceMetric = {
  bossName: string | null
  Name: string | null
  tier: number | null
  set: number | null
  rarity: string
  encounterId: number | null
  avgDamage: number
  maxDamage: number
  totalDamage: number
  hitCount: number
  maxHp: number
}

export function useBossPerformanceMetrics(
  guild: string,
  season: string,
  options?: { enabled?: boolean; rarities?: string[] }
) {
  const rarities = options?.rarities ?? ['Legendary', 'Mythic']

  return useQuery({
    queryKey: [
      ...bossQueryKeys.bossPerformanceMetrics(guild, season),
      rarities
    ],
    queryFn: async (): Promise<BossPerformanceMetric[]> => {
      await assertClientSession()
      const supabase = dbClient()

      const { data, error } = await supabase
        .from('EOT_GR_data')
        .select('Name, tier, set, encounterId, damageDealt, maxHp, rarity')
        .eq('Guild', guild)
        .eq('Season', season)
        .eq('damageType', 'Battle')
        .in('rarity', rarities)
        .not('damageDealt', 'is', null)
        .gt('damageDealt', 0)
        .order('startedOn', { ascending: false })

      if (error) throw error

      type BattleRecord = Pick<
        Database['public']['Tables']['EOT_GR_data']['Row'],
        | 'Name'
        | 'tier'
        | 'set'
        | 'encounterId'
        | 'damageDealt'
        | 'maxHp'
        | 'rarity'
      >

      type BossAccumulator = {
        bossName: string | null
        Name: string | null
        tier: number | null
        set: number | null
        rarity: string
        encounterId: number | null
        totalDamage: number
        hitCount: number
        maxDamage: number
        maxHp: number
      }

      const bossMetrics = new Map<string, BossAccumulator>()

      for (const record of (data ?? []) satisfies BattleRecord[]) {
        const damage = record.damageDealt ?? 0
        const key = `${record.rarity ?? 'Unknown'}_${record.set ?? 0}_${record.Name ?? ''}_${record.encounterId ?? 0}`

        if (!bossMetrics.has(key)) {
          bossMetrics.set(key, {
            bossName: record.Name,
            Name: record.Name,
            tier: record.tier,
            set: record.set,
            rarity: record.rarity ?? 'Common',
            encounterId: record.encounterId,
            totalDamage: 0,
            hitCount: 0,
            maxDamage: 0,
            maxHp: record.maxHp ?? 0
          })
        }

        const metrics = bossMetrics.get(key)!
        metrics.totalDamage += damage
        metrics.hitCount++
        metrics.maxDamage = Math.max(metrics.maxDamage, damage)
      }

      const results: BossPerformanceMetric[] = []
      bossMetrics.forEach((metrics) => {
        results.push({
          bossName: metrics.bossName,
          Name: metrics.Name,
          tier: metrics.tier,
          set: metrics.set,
          rarity: metrics.rarity,
          encounterId: metrics.encounterId,
          avgDamage:
            metrics.hitCount > 0 ? metrics.totalDamage / metrics.hitCount : 0,
          maxDamage: metrics.maxDamage,
          totalDamage: metrics.totalDamage,
          hitCount: metrics.hitCount,
          maxHp: metrics.maxHp
        })
      })

      return results.sort((a, b) => {
        const rarityA = rarityRank(a.rarity)
        const rarityB = rarityRank(b.rarity)
        if (rarityA !== rarityB) return rarityB - rarityA

        const setA = a.set ?? a.tier ?? 0
        const setB = b.set ?? b.tier ?? 0
        if (setA !== setB) return setB - setA

        return b.totalDamage - a.totalDamage
      })
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useGuildVsClusterBoss(
  guild: string,
  season: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: bossQueryKeys.guildVsClusterBossPerformance(guild, season),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      return getGuildVsClusterBossPerformanceRPC(supabase, {
        Guild: guild,
        Season: season
      })
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useGuildVsClusterPrime(
  guild: string,
  season: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: bossQueryKeys.guildVsClusterPrimePerformance(guild, season),
    queryFn: async () => {
      await assertClientSession()
      const supabase = dbClient()
      return getGuildVsClusterPrimePerformanceRPC(supabase, {
        Guild: guild,
        Season: season
      })
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useTotalDamage(
  guild: string,
  season: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: bossQueryKeys.totalDamage(guild, season),
    queryFn: async (): Promise<number> => {
      await assertClientSession()
      const supabase = dbClient()

      const { data, error } = await supabase
        .from('EOT_GR_data')
        .select('damageDealt')
        .eq('Guild', guild)
        .eq('Season', season)
        .gt('damageDealt', 0)
        .order('startedOn', { ascending: false })

      if (error) throw error

      return (data ?? []).reduce((sum, row) => sum + (row.damageDealt ?? 0), 0)
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

export function useMaxLoop(
  guild: string,
  season: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: bossQueryKeys.maxLoop(guild, season),
    queryFn: async (): Promise<number> => {
      await assertClientSession()
      const supabase = dbClient()

      const { data, error } = await supabase
        .from('EOT_GR_data')
        .select('loopIndex')
        .eq('Guild', guild)
        .eq('Season', season)
        .not('loopIndex', 'is', null)
        .order('loopIndex', { ascending: false })
        .limit(1)

      if (error) throw error

      const maxLoopIndex = data?.[0]?.loopIndex ?? -1
      return maxLoopIndex + 1
    },
    enabled: options?.enabled ?? (!!guild && !!season),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}

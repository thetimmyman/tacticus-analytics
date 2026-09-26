import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { apiCache } from '@tacticus/app-core/unified-cache'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.dashboard.cached-widgets')
import type { PostgrestError } from '@supabase/supabase-js'

const WIDGET_CACHE_TTL = {
  GUILD_SUMMARY: 1800000,
  PLAYER_SUMMARY: 900000
}

interface GuildSummary {
  totalDamage: number
  totalBattles: number
  activeMembers: number
  avgDamage: number
  topPerformer: string
  currentRank?: number
}

interface PlayerSummary {
  totalDamage: number
  totalBattles: number
  avgDamage: number
  bestDamage: number
  guildRank?: number
  clusterRank?: number
  avg_vs_guild?: number
  avg_vs_cluster?: number
}

export async function getCachedGuildSummary(
  guildCode: string,
  season: string
): Promise<GuildSummary> {
  const result = await apiCache.getOrFetch(
    `guild_summary:${guildCode}:${season}`,
    async () => {
      const supabase = serviceDb()

      const { data: battleData, error: battleError } = await supabase
        .from('EOT_GR_data')
        .select('damageDealt, displayName')
        .eq('Guild', guildCode)
        .eq('Season', season)
        .order('startedOn', { ascending: false })

      if (battleError) {
        logger.error({ err: battleError }, 'Error fetching guild battle data:')
        throw battleError
      }

      if (!battleData || battleData.length === 0) {
        return {
          totalDamage: 0,
          totalBattles: 0,
          activeMembers: 0,
          avgDamage: 0,
          topPerformer: 'No data'
        }
      }

      const totalDamage = battleData.reduce(
        (sum, battle) => sum + (battle.damageDealt || 0),
        0
      )
      const totalBattles = battleData.length
      const activeMembers = new Set(battleData.map((b) => b.displayName)).size
      const avgDamage = totalBattles > 0 ? totalDamage / totalBattles : 0

      const playerDamage = battleData.reduce(
        (acc, battle) => {
          const player = battle.displayName ?? 'Unknown'
          acc[player] = (acc[player] || 0) + (battle.damageDealt || 0)
          return acc
        },
        {} as Record<string, number>
      )

      const topPerformer =
        Object.entries(playerDamage).sort(([, a], [, b]) => b - a)[0]?.[0] ||
        'No data'

      // guild_rankings_public does not exist, so rank is omitted.
      return {
        totalDamage,
        totalBattles,
        activeMembers,
        avgDamage,
        topPerformer,
        currentRank: undefined
      }
    },
    {
      ttl: WIDGET_CACHE_TTL.GUILD_SUMMARY,
      priority: 'medium',
      tags: ['guild_summary', guildCode, season]
    }
  )
  return result as GuildSummary
}

export async function getCachedPlayerSummary(
  playerId: string,
  season: string,
  guildCode?: string
): Promise<PlayerSummary> {
  const result = await apiCache.getOrFetch(
    `player_summary:${playerId}:${season}:${guildCode || 'any'}`,
    async () => {
      const supabase = serviceDb()

      const identifierCandidates: Array<{ column: string; value: string }> = []

      if (playerId) {
        identifierCandidates.push({ column: 'userId', value: playerId })
      }

      let battleData: Array<{ damageDealt: number | null }> = []
      let battleError: PostgrestError | null = null

      for (const candidate of identifierCandidates) {
        const { data, error } = await supabase
          .from('EOT_GR_data')
          .select('damageDealt')
          .eq(candidate.column, candidate.value)
          .eq('Season', season)
          .order('startedOn', { ascending: false })

        if (error?.code === '42703') {
          continue
        }

        if (error) {
          battleError = error
          break
        }

        if (data && Array.isArray(data) && data.length > 0) {
          battleData = data as unknown as Array<{ damageDealt: number | null }>
          break
        }
      }

      if (!battleData.length && !battleError && guildCode) {
        const { data: mapping } = await guildRosterQuery(
          supabase,
          guildCode,
          'display_name'
        )
          .eq('user_id', playerId)
          .maybeSingle()

        const displayName = mapping?.display_name

        if (displayName) {
          const { data, error } = await supabase
            .from('EOT_GR_data')
            .select('damageDealt')
            .eq('displayName', displayName)
            .eq('Season', season)
            .order('startedOn', { ascending: false })

          if (error) {
            battleError = error
          } else if (data && Array.isArray(data) && data.length > 0) {
            battleData = data as unknown as Array<{
              damageDealt: number | null
            }>
          }
        }
      }

      if (battleError) {
        const err = battleError as {
          message?: string
          code?: string
          hint?: string
          details?: string
        }
        logger.warn(
          { error: err?.message, code: err?.code },
          'Error fetching player battle data (returning empty)'
        )
        return {
          totalDamage: 0,
          totalBattles: 0,
          avgDamage: 0,
          bestDamage: 0,
          guildRank: undefined,
          clusterRank: undefined,
          avg_vs_guild: undefined,
          avg_vs_cluster: undefined
        }
      }

      if (!battleData || battleData.length === 0) {
        return {
          totalDamage: 0,
          totalBattles: 0,
          avgDamage: 0,
          bestDamage: 0,
          guildRank: undefined,
          clusterRank: undefined,
          avg_vs_guild: undefined,
          avg_vs_cluster: undefined
        }
      }

      const damages = battleData.map((b) => b.damageDealt || 0)
      const totalDamage = damages.reduce((sum, damage) => sum + damage, 0)
      const totalBattles = damages.length
      const avgDamage = totalBattles > 0 ? totalDamage / totalBattles : 0
      const bestDamage = Math.max(...damages)

      return {
        totalDamage,
        totalBattles,
        avgDamage,
        bestDamage,
        guildRank: undefined,
        clusterRank: undefined,
        avg_vs_guild: undefined,
        avg_vs_cluster: undefined
      }
    },
    {
      ttl: WIDGET_CACHE_TTL.PLAYER_SUMMARY,
      priority: 'medium',
      tags: ['player_summary', playerId, season, guildCode || 'any']
    }
  )
  return result as PlayerSummary
}

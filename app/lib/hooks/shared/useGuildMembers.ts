import { useMemo } from 'react'
import { dbClient } from '@/app/lib/db/client'
import type { Database } from '@tacticus/app-core/types'
import {
  useMemberStatsMaterialized,
  type MemberStatsSummary
} from '@/app/lib/hooks/member-stats-materialized'
import { useBaseQuery } from './useBaseQuery'
import type { GuildMember } from './types'

type GuildMemberRpcRow =
  Database['public']['Functions']['get_guild_members_browser_safe']['Returns'][number]

type TokenAvailability = {
  tokensAvailable: number
  tokenCooldown: string | null
  nextTokenSeconds: number | null
}

type GuildTokenRow = {
  player_id?: unknown
  tokens_available?: unknown
  token_cooldown?: unknown
  next_token_seconds?: unknown
}

type GuildTokensResponse = {
  players?: unknown
  error?: string
}

const fetchGuildTokens = async (
  guildCode: string,
  seasonNumber: string | null
): Promise<GuildTokensResponse> => {
  const params = new URLSearchParams()
  params.set('guild', guildCode)
  // Unpinned, the server resolves the current season; the static schedule drifts on boundary days.
  if (seasonNumber && seasonNumber.length > 0) {
    params.set('season', seasonNumber)
  }

  const response = await fetch(`/api/guild-tokens?${params.toString()}`)
  const payload = (await response
    .json()
    .catch(() => null)) as GuildTokensResponse | null

  if (!response.ok) {
    const message = payload?.error || 'Failed to load guild tokens'
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid guild tokens response')
  }

  return payload
}

export interface UseGuildMembersOptions {
  guildCode: string
  includeStats?: boolean
  includeTokens?: boolean
  activeOnly?: boolean
  roles?: string[]
  seasonNumber?: string | number
  enabled?: boolean
}

export function useGuildMembers(options: UseGuildMembersOptions) {
  const enabled = options.enabled ?? Boolean(options.guildCode)
  const shouldIncludeStats = Boolean(options.includeStats && enabled)
  const shouldIncludeTokens = Boolean(options.includeTokens && enabled)

  const membersQuery = useBaseQuery<GuildMemberRpcRow[]>({
    queryKey: ['guild-members', options.guildCode],
    queryFn: async () => {
      const supabase = dbClient()
      const { data, error } = await supabase.rpc(
        'get_guild_members_browser_safe'
      )
      if (error) throw error
      return data ?? []
    },
    enabled,
    cacheDuration: 2 * 60 * 1000
  })

  const statsQuery = useMemberStatsMaterialized(options.guildCode, {
    enabled: shouldIncludeStats
  })

  const resolvedSeason = useMemo(() => {
    if (!shouldIncludeTokens) return null
    if (
      typeof options.seasonNumber === 'string' &&
      options.seasonNumber.trim().length > 0
    ) {
      return options.seasonNumber
    }
    if (
      typeof options.seasonNumber === 'number' &&
      Number.isFinite(options.seasonNumber)
    ) {
      return String(options.seasonNumber)
    }
    return null
  }, [options.seasonNumber, shouldIncludeTokens])

  const tokensQuery = useBaseQuery<GuildTokensResponse>({
    queryKey: [
      'guild-token-availability',
      options.guildCode,
      resolvedSeason ?? 'current'
    ],
    queryFn: () => fetchGuildTokens(options.guildCode, resolvedSeason),
    enabled: shouldIncludeTokens,
    cacheDuration: 15 * 1000,
    retryCount: 1
  })

  const tokenMap = useMemo(() => {
    const map = new Map<string, TokenAvailability>()
    if (!tokensQuery.data || !Array.isArray(tokensQuery.data.players))
      return map

    tokensQuery.data.players.forEach((row) => {
      const entry = row as GuildTokenRow
      if (typeof entry.player_id !== 'string') return
      if (
        typeof entry.tokens_available !== 'number' ||
        !Number.isFinite(entry.tokens_available)
      )
        return

      const tokenCooldown =
        typeof entry.token_cooldown === 'string' ? entry.token_cooldown : null
      const nextTokenSeconds =
        typeof entry.next_token_seconds === 'number' &&
        Number.isFinite(entry.next_token_seconds)
          ? Math.max(0, Math.trunc(entry.next_token_seconds))
          : null

      map.set(entry.player_id, {
        tokensAvailable: Math.max(0, Math.trunc(entry.tokens_available)),
        tokenCooldown,
        nextTokenSeconds
      })
    })

    return map
  }, [tokensQuery.data])

  const statsMap = useMemo(() => {
    const map = new Map<string, MemberStatsSummary>()
    if (!statsQuery.data) return map

    statsQuery.data.forEach((entry) => {
      if (entry.player_id) {
        map.set(entry.player_id, entry)
      }
      if (entry.display_name) {
        map.set(entry.display_name, entry)
      }
    })

    return map
  }, [statsQuery.data])

  const members = useMemo<GuildMember[]>(() => {
    const rows = membersQuery.data ?? []
    const roleFilter =
      options.roles && options.roles.length > 0
        ? new Set(options.roles.map((role) => role.toLowerCase()))
        : null

    return rows
      .filter((row) => row.guild_code === options.guildCode)
      .filter((row) => (options.activeOnly ? Boolean(row.is_current) : true))
      .filter((row) => {
        if (!roleFilter) return true
        return roleFilter.has(String(row.role ?? '').toLowerCase())
      })
      .map((row) => {
        const tokenData = tokenMap.get(row.player_id)
        const stats =
          statsMap.get(row.player_id) ?? statsMap.get(row.display_name)

        return {
          playerId: row.player_id,
          displayName: row.display_name,
          role: row.role ?? null,
          isActive: Boolean(row.is_current),
          guildCode: row.guild_code ?? null,
          userId: row.user_id ?? null,
          isClaimed: row.is_claimed,
          avatarUnitId: row.avatar_unit_id ?? null,
          playerLevel: row.player_level ?? null,
          primaryBoss: row.primary_boss ?? null,
          secondaryBoss: row.secondary_boss ?? null,
          bossPreferences:
            (row.boss_preferences as Record<string, unknown> | string | null) ??
            null,
          lastSyncAt: row.last_sync_at ?? null,
          lastSyncTokens: row.last_sync_tokens ?? null,
          lastSyncBombs: row.last_sync_bombs ?? null,
          tokensAvailable: tokenData?.tokensAvailable ?? null,
          tokenCooldown: tokenData?.tokenCooldown ?? null,
          nextTokenSeconds: tokenData?.nextTokenSeconds ?? null,
          stats: stats ?? null
        }
      })
  }, [
    membersQuery.data,
    options.activeOnly,
    options.guildCode,
    options.roles,
    statsMap,
    tokenMap
  ])

  const refetch = async () => {
    await Promise.all([
      membersQuery.refetch(),
      shouldIncludeStats ? statsQuery.refetch() : Promise.resolve(),
      shouldIncludeTokens ? tokensQuery.refetch() : Promise.resolve()
    ])
  }

  return {
    members,
    isLoading:
      membersQuery.isLoading || statsQuery.isLoading || tokensQuery.isLoading,
    error: membersQuery.error ?? statsQuery.error ?? tokensQuery.error ?? null,
    refetch,
    getMemberById: (playerId: string) =>
      members.find((member) => member.playerId === playerId)
  }
}

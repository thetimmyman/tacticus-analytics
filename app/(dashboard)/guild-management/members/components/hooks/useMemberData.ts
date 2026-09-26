'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import type {
  TokenUsageData,
  TokenUsageResponse,
  BossPerformanceData,
  Boss
} from '../types'
import { BOSS_DISPLAY_NAMES } from '../types'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { extractErrorMessage } from '@/app/lib/utils/error-message'

interface UseMemberDataOptions {
  userGuildCode: string
  selectedSeason: string
}

interface UseMemberDataReturn {
  tokenData: Record<string, TokenUsageData>
  tokenDataError: string | null
  refetchTokenData: () => void
  bossPerformanceData: Record<string, BossPerformanceData[]>
  availableBosses: Boss[]
  isLoading: boolean
}

export const memberDataKeys = {
  bosses: () => ['memberData', 'bosses'] as const,
  tokenUsage: (guild: string, season: string) =>
    ['memberData', 'tokenUsage', guild, season] as const,
  bossPerformance: (guild: string, season: string) =>
    ['memberData', 'bossPerformance', guild, season] as const
}

export function useMemberData({
  userGuildCode,
  selectedSeason
}: UseMemberDataOptions): UseMemberDataReturn {
  const supabase = useMemo(() => dbClient(), [])

  const { data: availableBosses = [] } = useQuery({
    queryKey: memberDataKeys.bosses(),
    queryFn: async () => {
      const { data } = await supabase
        .from('boss_mapping')
        .select('boss_type')
        .order('boss_type')

      if (!data) return []

      const bossData = data as Array<{ boss_type: string }>
      const uniqueBossTypes = [
        ...new Set(bossData.map((item) => item.boss_type))
      ]
      return uniqueBossTypes.map((bossType) => ({
        boss_type: bossType,
        display_name:
          BOSS_DISPLAY_NAMES[bossType] || getBossDisplayName(bossType),
        encounter_index: 0,
        boss_name: bossType
      }))
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000
  })

  const tokenUsageQuery = useQuery({
    queryKey: memberDataKeys.tokenUsage(userGuildCode, selectedSeason),
    queryFn: async () => {
      const response = await fetch(
        `/api/members/token-usage?guild=${userGuildCode}&season=${selectedSeason}`,
        { cache: 'no-store' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(
            payload,
            'Token availability data is temporarily unavailable'
          )
        )
      }

      const data = Array.isArray(payload)
        ? (payload as TokenUsageResponse[])
        : []
      const tokenMap: Record<string, TokenUsageData> = {}
      const norm = (name?: string | null) => (name ?? '').trim().toLowerCase()

      data.forEach(
        ({
          display_name,
          player_id,
          user_id,
          bombs_available = 0,
          bombs_used = 0,
          ...usage
        }) => {
          const entry: TokenUsageData = {
            ...usage,
            player_id,
            user_id,
            bombs_available,
            bombs_used
          }
          const nameKey = display_name ?? ''
          if (nameKey) tokenMap[nameKey] = entry
          if (player_id) tokenMap[player_id] = entry
          if (user_id) tokenMap[user_id] = entry
          const normalized = norm(nameKey)
          if (normalized) tokenMap[`norm:${normalized}`] = entry
        }
      )
      return tokenMap
    },
    enabled: !!selectedSeason,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })
  const tokenData = tokenUsageQuery.data ?? {}
  const tokenDataError =
    tokenUsageQuery.error instanceof Error
      ? tokenUsageQuery.error.message
      : tokenUsageQuery.error
        ? 'Token availability data is temporarily unavailable'
        : null

  const { data: bossPerformanceData = {}, isLoading: isPerfLoading } = useQuery(
    {
      queryKey: memberDataKeys.bossPerformance(userGuildCode, selectedSeason),
      queryFn: async () => {
        const response = await fetch(
          `/api/members/boss-performance?guild=${userGuildCode}&season=${selectedSeason}`
        )
        if (!response.ok) return {}
        return response.json()
      },
      enabled: !!selectedSeason,
      staleTime: 2 * 60 * 1000,
      gcTime: 5 * 60 * 1000
    }
  )

  return {
    tokenData,
    tokenDataError,
    refetchTokenData: () => {
      void tokenUsageQuery.refetch()
    },
    bossPerformanceData,
    availableBosses,
    isLoading: tokenUsageQuery.isLoading || isPerfLoading
  }
}

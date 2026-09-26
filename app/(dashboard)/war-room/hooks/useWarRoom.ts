'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  HeroUsage,
  MetaTeam,
  TeamReadiness,
  WarRoomData,
  WarRoomGuildOption
} from '../types'

async function fetchWarRoom(
  minRankIndex: number,
  guildCode: string | null
): Promise<WarRoomData> {
  const params = new URLSearchParams()
  if (guildCode) {
    params.set('guild', guildCode)
  }
  if (Number.isFinite(minRankIndex)) {
    params.set('min_rank_index', String(minRankIndex))
  }

  const response = await fetch(`/api/guild-war/war-room?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Failed to load the War Room')
  }

  const payload = (await response.json()) as {
    guildCode?: unknown
    ownGuildCode?: unknown
    isOwnGuild?: unknown
    guilds?: unknown
    minRankIndex?: unknown
    teams?: unknown
    readiness?: unknown
    usage?: unknown
    myUsage?: unknown
  }
  if (
    (typeof payload.guildCode !== 'string' && payload.guildCode !== null) ||
    (typeof payload.ownGuildCode !== 'string' &&
      payload.ownGuildCode !== null) ||
    typeof payload.isOwnGuild !== 'boolean' ||
    !Array.isArray(payload.guilds) ||
    !Array.isArray(payload.teams) ||
    !Array.isArray(payload.readiness) ||
    !Array.isArray(payload.usage) ||
    !Array.isArray(payload.myUsage)
  ) {
    throw new Error('The War Room returned an invalid response')
  }

  return {
    guildCode: payload.guildCode,
    ownGuildCode: payload.ownGuildCode,
    isOwnGuild: payload.isOwnGuild,
    guilds: payload.guilds as WarRoomGuildOption[],
    minRankIndex:
      typeof payload.minRankIndex === 'number'
        ? payload.minRankIndex
        : minRankIndex,
    teams: payload.teams as MetaTeam[],
    readiness: payload.readiness as TeamReadiness[],
    usage: payload.usage as HeroUsage[],
    myUsage: payload.myUsage as HeroUsage[]
  }
}

/** `guildCode` null means the caller's own guild. */
export function useWarRoom(minRankIndex = 9, guildCode: string | null = null) {
  return useQuery({
    queryKey: ['war-room', minRankIndex, guildCode],
    queryFn: () => fetchWarRoom(minRankIndex, guildCode),
    // Keep the current guild on screen while another loads.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    retry: 1
  })
}

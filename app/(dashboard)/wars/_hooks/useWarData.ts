'use client'

import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import type {
  WarInfo,
  WarStats,
  PlayerStats,
  ZoneCell,
  RecentAttempt
} from '../_types'
import type { WarBoardSides } from '../[warId]/board/board-utils'

const STALE_TIME = 1000 * 60 * 2
const GC_TIME = 1000 * 60 * 10

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return res.json()
}

export function useWarInfo(warId: string) {
  return useQuery({
    queryKey: ['war-info', warId],
    queryFn: () => fetchJson<WarInfo>(`/api/wars/${warId}`),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!warId
  })
}

export function useWarStats(warId: string) {
  return useQuery({
    queryKey: ['war-stats', warId],
    queryFn: () => fetchJson<WarStats>(`/api/wars/${warId}/stats`),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!warId
  })
}

export function useWarPlayers(warId: string, side: 'guild' | 'opponent') {
  return useQuery({
    queryKey: ['war-players', warId, side],
    queryFn: () =>
      fetchJson<PlayerStats[]>(`/api/wars/${warId}/players?side=${side}`),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!warId
  })
}

/** Attackers and defenders, including zero-token members. */
export function useWarBoard(warId: string) {
  return useQuery({
    queryKey: ['war-board', warId],
    queryFn: () => fetchJson<WarBoardSides>(`/api/wars/${warId}/board`),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!warId
  })
}

export function useWarZones(warId: string) {
  return useQuery({
    queryKey: ['war-zones', warId],
    queryFn: () => fetchJson<ZoneCell[]>(`/api/wars/${warId}/zones`),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!warId
  })
}

export type RecentActivityFilter =
  'all' | 'guild' | 'opponent' | 'perfect' | 'failed'

export function useWarRecentActivity(
  warId: string,
  filter: RecentActivityFilter = 'all',
  cursor?: string
) {
  return useQuery({
    queryKey: ['war-recent', warId, filter, cursor],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('filter', filter)
      if (cursor) params.set('cursor', cursor)

      const url = `/api/wars/${warId}/recent${params.toString() ? `?${params}` : ''}`
      return fetchJson<{
        attempts: RecentAttempt[]
        nextCursor?: string
      }>(url)
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!warId
  })
}

export function useRecentActivity(warId: string, filter: RecentActivityFilter) {
  return useInfiniteQuery({
    queryKey: ['war-recent-activity', warId, filter],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' })
      if (filter !== 'all') params.set('filter', filter)
      if (pageParam) params.set('cursor', pageParam)
      const res = await fetch(`/api/wars/${warId}/recent?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(
          (err as { error?: string }).error || 'Failed to fetch activity'
        )
      }
      return res.json() as Promise<{
        attempts: RecentAttempt[]
        nextCursor?: string
      }>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60 * 1000,
    enabled: !!warId
  })
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import type { PlayerCurrentTeamsResponse } from '../types'

async function fetchPlayerCurrentTeams(
  season: string
): Promise<PlayerCurrentTeamsResponse> {
  const params = new URLSearchParams()
  if (season) params.set('season', season)
  const res = await fetch(`/api/meta/player-current-teams?${params}`)
  const data = await res.json()
  if (!res.ok)
    throw new Error(extractErrorMessage(data, 'Failed to fetch current teams'))
  return data
}

export function usePlayerCurrentTeams(season: string, enabled: boolean) {
  return useQuery({
    queryKey: ['playerCurrentTeams', season],
    queryFn: () => fetchPlayerCurrentTeams(season),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

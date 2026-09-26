'use client'

import { useQuery } from '@tanstack/react-query'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type { PlayerCurrentTeamsResponse, RosterRoiResponse } from '../types'

async function fetchRosterRoi(payload: {
  roster: RosterInputEntry[]
  season?: string
  currentTeams?: PlayerCurrentTeamsResponse['current_teams']
}): Promise<RosterRoiResponse> {
  const res = await fetch('/api/meta/roster-roi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roster: payload.roster,
      season: payload.season,
      ...(payload.currentTeams && payload.currentTeams.length > 0
        ? { current_teams: payload.currentTeams }
        : {})
    })
  })
  const data = await res.json()
  if (!res.ok)
    throw new Error(extractErrorMessage(data, 'Failed to fetch roster ROI'))
  return data
}

export function useRosterRoi(options: {
  rosterEntries: RosterInputEntry[]
  season: string
  currentTeams: PlayerCurrentTeamsResponse['current_teams']
  rosterSignatureKey: string | number
  enabled: boolean
}) {
  return useQuery({
    queryKey: [
      'rosterRoi',
      options.season,
      options.rosterSignatureKey,
      options.currentTeams.length
    ],
    queryFn: () =>
      fetchRosterRoi({
        roster: options.rosterEntries,
        season: options.season,
        currentTeams: options.currentTeams
      }),
    enabled:
      options.enabled && options.rosterEntries.length > 0 && !!options.season,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

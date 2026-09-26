'use client'

import { useQuery } from '@tanstack/react-query'

export type TeamFloorUnit = {
  unit_id: string
  min_rank_name: string | null
  min_rank_index: number | null
  min_stars: number | null
}

export type TeamFloorResponse = {
  team_hash: string
  boss_type: string
  boss_unit_id: string | null
  encounter_index: number
  rarity_set: string
  season: string
  p90_damage: number | null
  sample_hits: number
  sample_players: number
  units: TeamFloorUnit[]
}

const fetchTeamFloor = async (payload: {
  teamHash: string
  bossType: string
  bossUnitId?: string | null
  encounterIndex: number
  raritySet: string
  season: string
}): Promise<TeamFloorResponse> => {
  const res = await fetch('/api/meta/team-floor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      team_hash: payload.teamHash,
      boss_type: payload.bossType,
      boss_unit_id: payload.bossUnitId ?? null,
      encounter_index: payload.encounterIndex,
      rarity_set: payload.raritySet,
      season: payload.season
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error || 'Failed to fetch team floor requirements'
    throw new Error(message)
  }

  return data as TeamFloorResponse
}

export function useMetaAtlasTeamFloor(options: {
  teamHash?: string | null
  bossType?: string | null
  bossUnitId?: string | null
  encounterIndex?: number | null
  raritySet?: string | null
  season?: string | null
  enabled?: boolean
}) {
  const canFetch = Boolean(
    options.enabled !== false &&
    options.teamHash &&
    options.bossType &&
    options.raritySet &&
    options.season &&
    typeof options.encounterIndex === 'number'
  )

  return useQuery({
    queryKey: [
      'metaAtlasTeamFloor',
      options.teamHash,
      options.bossType,
      options.bossUnitId,
      options.encounterIndex,
      options.raritySet,
      options.season
    ],
    queryFn: () =>
      fetchTeamFloor({
        teamHash: options.teamHash as string,
        bossType: options.bossType as string,
        bossUnitId: options.bossUnitId ?? null,
        encounterIndex: options.encounterIndex as number,
        raritySet: options.raritySet as string,
        season: options.season as string
      }),
    enabled: canFetch,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

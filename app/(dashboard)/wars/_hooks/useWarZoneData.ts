'use client'

import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import { buildActiveWarVisibilityFilter } from '@/app/lib/war/active-wars'

// No shape has `zone_name`; names derive from `zone_type` via `zoneDisplayName()`.
export interface LiveZoneAssignment {
  zone_id: string
  zone_number: number
  zone_type: string
  zone_status: string
  assigned_players: string[]
  war_id: string
  updated_at: string
}

export interface PlannedZoneAssignment {
  zone_id: string
  assigned_players: string[]
  updated_at: string
}

export interface ZoneDifference {
  /** The zone TYPE, or the row UUID when `zone_type` is empty. Never rendered. */
  zoneId: string
  zoneType: string
  livePlayers: string[]
  plannedPlayers: string[]
  addedToLive: string[]
  removedFromLive: string[]
  status: 'match' | 'different' | 'only_live' | 'only_planned'
}

type GuildWarZoneRow = {
  id: string
  zone_number: number
  zone_type: string
  zone_status: string
  assigned_players: string[] | null
  war_id: string
  updated_at: string
}

export function useActiveWar(guildCode: string) {
  const supabase = dbClient()

  return useQuery({
    queryKey: ['activeWar', guildCode],
    queryFn: async () => {
      // Same visibility window as the dashboard; limit(1) not .single(): prep can have several active rows.
      const { data, error } = await supabase
        .from('guild_war_matches')
        .select(
          'war_id, war_status, opponent_guild_name, guild_score, opponent_score, war_start_date, war_end_date, battlefield_level'
        )
        .eq('guild_code', guildCode)
        .eq('war_status', 'active')
        .or(buildActiveWarVisibilityFilter())
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error
      return Array.isArray(data) && data.length > 0 ? data[0] : null
    },
    staleTime: 30 * 1000
  })
}

export function useLiveZoneAssignments(guildCode: string, warId?: string) {
  const supabase = dbClient()

  return useQuery({
    queryKey: ['liveZones', guildCode, warId],
    queryFn: async () => {
      if (!warId) return []

      const { data, error } = await supabase
        .from('guild_war_zones')
        .select(
          'id, zone_number, zone_type, zone_status, assigned_players, war_id, updated_at'
        )
        .eq('guild_code', guildCode)
        .eq('war_id', warId)
        .order('zone_number', { ascending: true })

      if (error) throw error

      const rows = Array.isArray(data) ? (data as GuildWarZoneRow[]) : []
      return rows.map((z) => ({
        zone_id: z.id,
        zone_number: z.zone_number,
        zone_type: z.zone_type,
        zone_status: z.zone_status,
        assigned_players: Array.isArray(z.assigned_players)
          ? z.assigned_players
          : [],
        war_id: z.war_id,
        updated_at: z.updated_at
      }))
    },
    enabled: !!warId,
    staleTime: 30 * 1000
  })
}

export function useWarParticipation(guildCode: string, warId?: string) {
  const supabase = dbClient()

  return useQuery({
    queryKey: ['warParticipation', guildCode, warId],
    queryFn: async () => {
      if (!warId) return []

      const { data, error } = await supabase
        .from('guild_war_participation')
        .select(
          'user_id, display_name, opted_in, attempts_used, attempts_remaining, score, exhausted_units, last_activity_on, snapshot_at'
        )
        .eq('guild_code', guildCode)
        .eq('war_id', warId)
        .order('score', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!warId,
    staleTime: 30 * 1000
  })
}

export function computeZoneDifferences(
  liveZones: LiveZoneAssignment[],
  plannedZones: PlannedZoneAssignment[]
): ZoneDifference[] {
  const plannedMap = new Map<string, string[]>()
  plannedZones.forEach((p) => plannedMap.set(p.zone_id, p.assigned_players))

  const differences: ZoneDifference[] = []
  const liveZoneTypes = new Set<string>()

  for (const live of liveZones) {
    // Planned assignments key by zone type; the UUID only separates empty-type rows and never renders.
    const zoneKey = live.zone_type || live.zone_id
    liveZoneTypes.add(zoneKey)

    const planned = plannedMap.get(zoneKey) || []
    const liveSet = new Set(live.assigned_players)
    const plannedSet = new Set(planned)

    const addedToLive = live.assigned_players.filter((p) => !plannedSet.has(p))
    const removedFromLive = planned.filter((p) => !liveSet.has(p))

    let status: ZoneDifference['status'] = 'match'
    if (addedToLive.length > 0 || removedFromLive.length > 0) {
      status = 'different'
    } else if (live.assigned_players.length > 0 && planned.length === 0) {
      status = 'only_live'
    } else if (live.assigned_players.length === 0 && planned.length > 0) {
      status = 'only_planned'
    }

    differences.push({
      zoneId: zoneKey,
      zoneType: live.zone_type,
      livePlayers: live.assigned_players,
      plannedPlayers: planned,
      addedToLive,
      removedFromLive,
      status
    })
  }

  for (const planned of plannedZones) {
    if (liveZoneTypes.has(planned.zone_id)) continue

    differences.push({
      zoneId: planned.zone_id,
      zoneType: planned.zone_id,
      livePlayers: [],
      plannedPlayers: planned.assigned_players,
      addedToLive: [],
      removedFromLive: planned.assigned_players,
      status: 'only_planned'
    })
  }

  return differences
}

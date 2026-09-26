'use client'

import { useMemo } from 'react'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import { usePlayerCurrentTeams } from './usePlayerCurrentTeams'

const LEGACY_RARITY_SET_MAP: Record<string, string> = {
  MYTHIC: 'M5',
  LEGENDARY: 'L5'
}

const normalizeRaritySet = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const upper = value.trim().toUpperCase()
  if (!upper) return null
  const legacyMatch = LEGACY_RARITY_SET_MAP[upper]
  if (legacyMatch) return legacyMatch
  return /^[LM]\d+$/.test(upper) ? upper : null
}

type CurrentTeamsLookup = Record<
  string,
  {
    current_team?: string | null
    current_team_hash?: string | null
    encounter_index?: number | null
    rarity_set?: string | null
    season?: string | null
  }
>

export function useMetaAtlasPersonalization(options: {
  season: string
  canPersonalize: boolean
  enabled?: boolean
  rosterEntries: RosterInputEntry[]
  rosterSignature: string
  rosterNames: string[]
}) {
  const enabled = options.enabled ?? true
  const {
    data: currentTeamsData,
    isLoading: currentTeamsLoading,
    isFetched: currentTeamsFetched,
    isError: currentTeamsError
  } = usePlayerCurrentTeams(
    options.season,
    enabled && options.canPersonalize && !!options.season
  )
  const currentTeams = useMemo(
    () => currentTeamsData?.current_teams || [],
    [currentTeamsData?.current_teams]
  )
  const currentTeamsLookup = useMemo<CurrentTeamsLookup>(() => {
    const lookup: CurrentTeamsLookup = {}
    currentTeams.forEach((team) => {
      const normalizedRarity =
        normalizeRaritySet(team.rarity_set) ?? normalizeRaritySet(team.rarity)
      lookup[team.boss_type] = {
        current_team: team.current_team,
        current_team_hash: team.current_team_hash,
        encounter_index: team.encounter_index ?? null,
        rarity_set: normalizedRarity,
        season: options.season || null
      }
    })
    return lookup
  }, [currentTeams, options.season])

  const hasRosterEntries = options.rosterEntries.length > 0
  const shouldWaitForCurrentTeams =
    enabled && options.canPersonalize && Boolean(options.season)
  const currentTeamsReady =
    !shouldWaitForCurrentTeams || currentTeamsFetched || currentTeamsError
  const personalizedEnabled =
    enabled &&
    options.canPersonalize &&
    currentTeamsReady &&
    (currentTeams.length > 0 || hasRosterEntries)
  const personalizedKey = useMemo(() => {
    if (!personalizedEnabled) return 'global'
    const teamKey = currentTeams
      .map(
        (team) =>
          `${team.boss_type}:${team.current_team_hash || team.current_team}`
      )
      .join('|')
    const rosterKey =
      options.rosterSignature || String(options.rosterNames.length)
    return `personal-${options.season}-${rosterKey}-${teamKey}`
  }, [
    personalizedEnabled,
    currentTeams,
    options.rosterSignature,
    options.rosterNames.length,
    options.season
  ])

  const personalizedPayload = personalizedEnabled
    ? {
        roster: options.rosterEntries,
        currentTeams: currentTeamsLookup,
        key: personalizedKey
      }
    : undefined

  return {
    currentTeams,
    currentTeamsLookup,
    currentTeamsLoading,
    personalizedPayload,
    personalizedEnabled
  }
}

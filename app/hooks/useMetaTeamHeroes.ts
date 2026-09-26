'use client'

import { useState, useEffect, useMemo } from 'react'
import { RAID_TEAMS } from '@/app/lib/constants/guild-raid-teams'
import type { MetaTeam } from './useMetaTeams'

/**
 * Lowercased hero ids for the selected meta teams: a synchronous curated baseline
 * unioned with Meta Atlas heroes from the API (meta_atlas_data is service_role-only).
 */
export function useMetaTeamHeroes(
  selectedTeamIds: string[],
  metaTeams: MetaTeam[]
) {
  const selectedTeams = useMemo(
    () => metaTeams.filter((t) => selectedTeamIds.includes(t.id)),
    [selectedTeamIds, metaTeams]
  )

  const baselineHeroNames = useMemo(() => {
    const names = new Set<string>()
    for (const team of selectedTeams) {
      const curated = RAID_TEAMS.find((rt) => rt.name === team.team_name)
      if (curated) {
        for (const hero of curated.heroes) {
          names.add(hero.unitId.toLowerCase())
          names.add(hero.displayName.toLowerCase())
        }
      }
      for (const trigger of team.trigger_heroes ?? []) {
        const name = trigger.trim().toLowerCase()
        if (name) names.add(name)
      }
    }
    return names
  }, [selectedTeams])

  const teamsKey = useMemo(
    () => selectedTeams.map((t) => t.team_name).join(','),
    [selectedTeams]
  )

  const [atlasHeroNames, setAtlasHeroNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!teamsKey) {
      setAtlasHeroNames(new Set())
      setError(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/meta/team-heroes?teams=${encodeURIComponent(teamsKey)}`,
          { signal: controller.signal }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setAtlasHeroNames(
          new Set(Array.isArray(data?.heroes) ? (data.heroes as string[]) : [])
        )
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return
        setAtlasHeroNames(new Set())
        setError('Failed to load meta atlas heroes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [teamsKey])

  const expandedHeroNames = useMemo(() => {
    if (atlasHeroNames.size === 0) return baselineHeroNames
    const merged = new Set(baselineHeroNames)
    for (const hero of atlasHeroNames) merged.add(hero)
    return merged
  }, [baselineHeroNames, atlasHeroNames])

  return {
    expandedHeroNames,
    loading,
    error,
    teamCount: selectedTeams.length
  }
}

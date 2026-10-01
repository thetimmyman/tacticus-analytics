'use client'

import { useState, useEffect } from 'react'
import { dbClient } from '@/app/lib/db/client'

export interface MetaTeam {
  id: string
  team_name: string
  description: string | null
  is_meta: boolean | null
  sort_order: number | null
  trigger_heroes: string[]
  match_type: 'any' | 'all' | 'exact' | null
}

function useMetaTeamsQuery(includeBadgeOnly: boolean, enabled: boolean) {
  const [metaTeams, setMetaTeams] = useState<MetaTeam[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setMetaTeams([])
      setError(null)
      setLoading(false)
      return
    }

    const fetchMetaTeams = async () => {
      setLoading(true)
      try {
        const supabase = dbClient()
        let query = supabase
          .from('meta_teams')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('team_name', { ascending: true })

        if (!includeBadgeOnly) {
          query = query.eq('is_meta', true)
        }

        const { data, error } = await query

        if (error) {
          throw error
        }

        const parsed: MetaTeam[] = (data || []).map((team) => ({
          ...team,
          trigger_heroes: Array.isArray(team.trigger_heroes)
            ? (team.trigger_heroes as unknown as string[])
            : [],
          match_type: team.match_type as 'any' | 'all' | 'exact' | null
        }))
        setMetaTeams(parsed)
      } catch (err) {
        setError(
          'Unable to connect to Supabase - meta teams could not be loaded'
        )
        setMetaTeams([])
      } finally {
        setLoading(false)
      }
    }

    fetchMetaTeams()
  }, [enabled, includeBadgeOnly])

  return { metaTeams, loading, error }
}

// Classifier teams only (is_meta=true), for archetype semantics.
export function useMetaTeams(enabled = true) {
  return useMetaTeamsQuery(false, enabled)
}

// Also badge-only entries (is_meta=false): leader-hero replay tags, not archetypes.

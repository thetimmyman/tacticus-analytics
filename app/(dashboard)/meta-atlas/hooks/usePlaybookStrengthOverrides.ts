'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  HeroRequirement,
  PlaybookStrengthOverrides
} from '@/app/lib/meta/roster-strength'
import { normalizeHeroKey } from '../utils/hero-mapping'

type StrengthOverrideRow = {
  id: string
  boss_id: string
  difficulty: string | null
  meta_team_id: string | null
  team_name: string | null
  hero_requirements: HeroRequirement[]
  overall_notes: string | null
  updated_at: string
}

type FetchOptions = {
  bossId?: string | null
  bossType?: string | null
  bossName?: string | null
  metaTeamId?: string | null
  metaTeam?: string | null
  difficulty?: string | null
}

const fetchPlaybookStrengthOverrides = async (
  options: FetchOptions
): Promise<PlaybookStrengthOverrides | null> => {
  const params = new URLSearchParams()
  if (options.bossId) params.set('boss_id', options.bossId)
  if (options.bossType) params.set('boss_type', options.bossType)
  if (options.bossName) params.set('boss_name', options.bossName)
  if (options.metaTeamId) params.set('meta_team_id', options.metaTeamId)
  if (options.metaTeam) params.set('meta_team', options.metaTeam)
  if (options.difficulty) params.set('difficulty', options.difficulty)

  const query = params.toString()
  const res = await fetch(
    `/api/meta/strength-overrides${query ? `?${query}` : ''}`
  )
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const message = data?.error || 'Failed to fetch playbook minimums'
    throw new Error(message)
  }

  const overrides = data?.overrides as StrengthOverrideRow | null
  if (!overrides || !Array.isArray(overrides.hero_requirements)) {
    return null
  }

  const heroes = new Map<string, HeroRequirement>()
  for (const req of overrides.hero_requirements) {
    if (!req?.hero_name) continue
    const key = normalizeHeroKey(req.hero_name)
    if (key) heroes.set(key, req)
  }

  return {
    boss_id: overrides.boss_id,
    team_id: overrides.meta_team_id ?? null,
    difficulty: overrides.difficulty ?? null,
    heroes,
    source: 'playbook'
  }
}

export function usePlaybookStrengthOverrides(
  options: FetchOptions & { enabled?: boolean }
) {
  const canFetch = Boolean(
    options.enabled !== false &&
    (options.bossId || options.bossType || options.bossName) &&
    (options.metaTeamId || options.metaTeam)
  )

  return useQuery({
    queryKey: [
      'playbookStrengthOverrides',
      options.bossId,
      options.bossType,
      options.bossName,
      options.metaTeamId,
      options.metaTeam,
      options.difficulty
    ],
    queryFn: () => fetchPlaybookStrengthOverrides(options),
    enabled: canFetch,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

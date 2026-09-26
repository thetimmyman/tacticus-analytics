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

type BatchRequest = {
  bossType?: string | null
  bossName?: string | null
  metaTeam: string
}

type BatchResult = Record<string, StrengthOverrideRow | null>

const fetchBatchOverrides = async (
  requests: BatchRequest[]
): Promise<BatchResult> => {
  if (requests.length === 0) return {}

  const res = await fetch('/api/meta/strength-overrides/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const message = data?.error || 'Failed to fetch playbook minimums'
    throw new Error(message)
  }

  return data?.results ?? {}
}

const parseOverride = (
  row: StrengthOverrideRow | null
): PlaybookStrengthOverrides | null => {
  if (!row || !Array.isArray(row.hero_requirements)) {
    return null
  }

  const heroes = new Map<string, HeroRequirement>()
  for (const req of row.hero_requirements) {
    if (!req?.hero_name) continue
    const key = normalizeHeroKey(req.hero_name)
    if (key) heroes.set(key, req)
  }

  return {
    boss_id: row.boss_id,
    team_id: row.meta_team_id ?? null,
    difficulty: row.difficulty ?? null,
    heroes,
    source: 'playbook'
  }
}

export type StrengthOverridesLookup = Map<
  string,
  PlaybookStrengthOverrides | null
>

/** Map keyed by "bossType:metaTeam" or "bossName:metaTeam". */
export function usePlaybookStrengthOverridesBatch(
  requests: BatchRequest[],
  options: { enabled?: boolean } = {}
) {
  const validRequests = requests.filter(
    (r) => (r.bossType || r.bossName) && r.metaTeam
  )

  const canFetch = options.enabled !== false && validRequests.length > 0

  return useQuery({
    queryKey: ['playbookStrengthOverridesBatch', validRequests],
    queryFn: async (): Promise<StrengthOverridesLookup> => {
      const results = await fetchBatchOverrides(validRequests)
      const lookup = new Map<string, PlaybookStrengthOverrides | null>()

      Object.entries(results).forEach(([key, row]) => {
        lookup.set(key, parseOverride(row))
      })

      return lookup
    },
    enabled: canFetch,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

export function getStrengthOverrideKey(
  bossType: string | null | undefined,
  bossName: string | null | undefined,
  metaTeam: string | null | undefined
): string | null {
  if (!metaTeam) return null
  const bossKey = bossType || bossName
  if (!bossKey) return null
  return `${bossKey}:${metaTeam}`
}

'use client'

// The module-scoped mutable `heroRequirementIdCounter` is declared only here.

import type { HeroRequirement } from '../HeroRequirementRow'

export type RaidTeam = {
  team_hash: string | null
  team_composition: string | null
  meta_team: string | null
  meta_team_id?: string | null
  rarity_set: string | null
  damage_p90?: number | null
}

export type RequirementEntry = {
  id: string
  boss_id: string
  difficulty: string | null
  meta_team_id: string | null
  team_name: string | null
  hero_requirements: HeroRequirement[]
  overall_notes: string | null
  is_verified: boolean
  updated_at?: string | null
  guild_code?: string | null
  cluster_code?: string | null
}

export const RARITY_OPTIONS = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic'
]

// "Hero1, Hero2, Hero3 + MOW" → hero names.
export const parseTeamComposition = (
  composition: string | null | undefined
): string[] => {
  if (!composition) return []
  const parts = composition.split(' + ')
  const heroPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null
  const heroes = heroPart
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)
  if (mowPart) {
    heroes.push(mowPart)
  }
  return heroes
}

let heroRequirementIdCounter = 0
const generateHeroRequirementId = () =>
  `hero-req-${Date.now()}-${++heroRequirementIdCounter}`

export const createHeroRequirement = (heroName: string): HeroRequirement => ({
  _id: generateHeroRequirementId(),
  hero_name: heroName,
  min_rank: null,
  min_rank_index: null,
  min_ability_active: null,
  min_ability_passive: null,
  min_ability_mythic: null,
  min_rarity: null,
  min_stars: null,
  notes: null
})

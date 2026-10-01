import type { StrengthState } from '@/app/lib/meta/roster-strength'
import {
  normalizeHeroKey,
  resolveHeroMapping,
  type HeroMapping
} from '../utils/hero-mapping'

export type MetroTone = 'current' | 'next' | 'final' | 'step'
export type PortraitMode = 'full' | 'compact' | 'micro' | 'hidden'

export type HeroInfo = {
  name: string
  icon_url?: string | null
}

export type TeamUnitInfo = {
  unitId: string
  displayName: string
  iconUrl: string | null
}

export type StepInvestmentUnit = TeamUnitInfo & {
  state: StrengthState
}

export type StepStrengthInfo = {
  unitStates: Map<string, StrengthState>
  needsInvestment: StepInvestmentUnit[]
  lockedUnits: StepInvestmentUnit[]
}

export type SwapUnitInfo = {
  name: string
  icon_url?: string | null
}

const splitSwapUnits = (value: string | null | undefined): string[] => {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const parseCompositionUnits = (composition?: string | null): string[] => {
  if (!composition) return []
  const parts = composition.split(' + ')
  const heroPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null
  const heroes = heroPart
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (mowPart) {
    heroes.push(mowPart)
  }
  return heroes
}

export const parseTeamUnits = (
  composition: string | null | undefined,
  heroMappings?: Map<string, HeroMapping>
): TeamUnitInfo[] => {
  if (!composition) return []
  const parts = composition.split(' + ')
  const heroPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null

  const heroNames = heroPart
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)

  const buildUnit = (name: string): TeamUnitInfo => {
    const mapping = heroMappings ? resolveHeroMapping(name, heroMappings) : null
    const displayName = mapping?.display_name || name
    const unitId = mapping?.unit_id || name
    return {
      unitId,
      displayName,
      iconUrl: mapping?.web_icon_url || null
    }
  }

  const units = heroNames.map((name) => buildUnit(name))
  if (mowPart) {
    units.push(buildUnit(mowPart))
  }
  return units
}

export const inferSwapUnits = (
  fromTeam?: string | null,
  toTeam?: string | null
) => {
  const fromUnits = parseCompositionUnits(fromTeam)
  const toUnits = parseCompositionUnits(toTeam)
  if (fromUnits.length === 0 || toUnits.length === 0) {
    return { swapOut: [] as string[], swapIn: [] as string[] }
  }
  const fromSet = new Set(fromUnits.map((unit) => normalizeHeroKey(unit)))
  const toSet = new Set(toUnits.map((unit) => normalizeHeroKey(unit)))
  const swapOut = fromUnits.filter((unit) => {
    const key = normalizeHeroKey(unit)
    return key && !toSet.has(key)
  })
  const swapIn = toUnits.filter((unit) => {
    const key = normalizeHeroKey(unit)
    return key && !fromSet.has(key)
  })
  return { swapOut, swapIn }
}

export const resolveSwapUnits = (
  value: string | null | undefined,
  heroMappings?: Map<string, HeroMapping>
): SwapUnitInfo[] => {
  const entries = splitSwapUnits(value)
  if (entries.length === 0) return []
  return entries
    .filter((entry) => normalizeHeroKey(entry) !== 'openslot')
    .map((entry) => {
      const mapping = heroMappings
        ? resolveHeroMapping(entry, heroMappings)
        : null
      return {
        name: mapping?.display_name || entry,
        icon_url: mapping?.web_icon_url || null
      }
    })
}

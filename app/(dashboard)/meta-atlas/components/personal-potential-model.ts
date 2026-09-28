import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import { resolveRankName } from '@/app/lib/tacticus/ranks'
import type { StrengthOverridesLookup } from '../hooks/usePlaybookStrengthOverridesBatch'
import type { BossData, MetaTeamProgression } from '../types'
import {
  normalizeHeroKey,
  resolveHeroMapping,
  type HeroMapping
} from '../utils/hero-mapping'

export type PersonalPotentialViewProps = {
  data: BossData | null
  loading: boolean
  heroMappings: Map<string, HeroMapping>
  rosterEntries: RosterInputEntry[]
  hasBattleHistory: boolean
  hasRoster: boolean
  strengthOverridesLookup?: StrengthOverridesLookup
}

export type PersonalPotentialContentProps = Omit<
  PersonalPotentialViewProps,
  'data' | 'loading'
> & {
  data: BossData
  strengthOverridesLookup?: StrengthOverridesLookup
}

export type SourceMode = 'history' | 'roster'

export type TeamUnitInfo = {
  unitId: string
  displayName: string
  iconUrl: string | null
  isMow: boolean
}

export const resolveRankLabel = resolveRankName

export const resolveStarTierFromProgressionIndex = (
  progressionIndex: number
): number => {
  if (progressionIndex >= 16) return 6
  if (progressionIndex >= 12) return 5
  if (progressionIndex >= 9) return 4
  if (progressionIndex >= 6) return 3
  if (progressionIndex >= 3) return 2
  return 1
}

export const META_TEAM_CUSTOM_KEY = '__custom__'

export type MetaTeamBadgeState = MetaTeamProgression['worst_state'] | 'Unknown'

export const META_TEAM_BADGES: Record<
  Exclude<MetaTeamBadgeState, null>,
  { label: string; className: string }
> = {
  Optimal: {
    label: 'Optimal',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  },
  Strong: {
    label: 'Strong',
    className: 'border-sky-500/40 bg-sky-500/10 text-sky-200'
  },
  Suitable: {
    label: 'Suitable',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  },
  Weak: {
    label: 'Weak',
    className: 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  },
  Locked: {
    label: 'Locked',
    className: 'border-slate-500/40 bg-slate-500/10 text-primary-wh40k'
  },
  Owned: {
    label: 'Owned',
    className: 'border-blue-500/40 bg-blue-500/10 text-blue-200'
  },
  Invalid: {
    label: 'Owned',
    className: 'border-blue-500/40 bg-blue-500/10 text-blue-200'
  },
  Unknown: {
    label: 'Unknown',
    className: 'border-(--card-border) bg-card/50 text-secondary-wh40k'
  }
}

export const resolveMetaTeamBadge = (
  state: MetaTeamBadgeState | null | undefined
) => {
  if (!state) return META_TEAM_BADGES.Unknown
  return META_TEAM_BADGES[state] ?? META_TEAM_BADGES.Unknown
}

export type MetaTeamAvailabilityState = 'available' | 'invest' | 'unknown'

export const META_TEAM_AVAILABILITY_BADGES: Record<
  MetaTeamAvailabilityState,
  { label: string; className: string }
> = {
  available: {
    label: 'Available Now',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  },
  invest: {
    label: 'Needs Investment',
    className: 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  },
  unknown: {
    label: 'Unknown',
    className: 'border-(--card-border) bg-card/50 text-secondary-wh40k'
  }
}

export const resolveMetaTeamAvailabilityBadge = (
  isBuildable: boolean | null | undefined
) => {
  if (isBuildable === true) return META_TEAM_AVAILABILITY_BADGES.available
  if (isBuildable === false) return META_TEAM_AVAILABILITY_BADGES.invest
  return META_TEAM_AVAILABILITY_BADGES.unknown
}

export const META_TEAM_LABEL_STYLES: Record<
  string,
  { base: string; selected: string }
> = {
  Orkz: {
    base: 'bg-green-500/20 text-green-400 border-green-500/30',
    selected: 'bg-green-500/40 text-green-300 border-green-400'
  },
  Helbrecht: {
    base: 'bg-card/30 text-white border-white/30',
    selected: 'bg-card/50 text-white border-white'
  },
  Neuro: {
    base: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
    selected: 'bg-purple-600/40 text-purple-300 border-purple-400'
  },
  AdMech: {
    base: 'bg-red-600/20 text-red-400 border-red-600/30',
    selected: 'bg-red-600/40 text-red-300 border-red-400'
  },
  Forcasmo: {
    base: 'bg-emerald-800/20 text-emerald-400 border-emerald-800/30',
    selected: 'bg-emerald-800/40 text-emerald-300 border-emerald-600'
  },
  Custodes: {
    base: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    selected: 'bg-amber-500/40 text-amber-200 border-amber-400'
  },
  'Double Howl': {
    base: 'bg-slate-500/20 text-primary-wh40k border-slate-500/30',
    selected: 'bg-slate-500/40 text-primary-wh40k border-slate-300'
  }
}

export const resolveMetaTeamLabelClass = (
  team: string | null,
  isSelected: boolean
) => {
  const fallback = isSelected
    ? 'bg-gray-400/40 text-primary-wh40k border-gray-300'
    : 'bg-gray-400/20 text-primary-wh40k border-gray-500/30'
  if (!team) return fallback
  const palette = META_TEAM_LABEL_STYLES[team]
  if (!palette) return fallback
  return isSelected ? palette.selected : palette.base
}

export const resolveMetaTeamKey = (value: string | null) =>
  value ?? META_TEAM_CUSTOM_KEY

export function resolveDefaultMetaTeamKey(
  data: BossData,
  progressions: MetaTeamProgression[]
) {
  if (progressions.length === 0) return null
  const preferred =
    data.best_buildable_info?.meta_team ??
    data.target_team_info?.meta_team ??
    data.recommendations[0]?.meta_team ??
    progressions[0]?.meta_team ??
    null
  const preferredKey = resolveMetaTeamKey(preferred)
  return progressions.some(
    (entry) => resolveMetaTeamKey(entry.meta_team) === preferredKey
  )
    ? preferredKey
    : resolveMetaTeamKey(progressions[0]?.meta_team ?? null)
}

export function rankMetaTeamProgressions(progressions: MetaTeamProgression[]) {
  const ranked = [...progressions].sort((a, b) => {
    const damageDelta =
      (b.target_team?.damage_p90 ?? 0) - (a.target_team?.damage_p90 ?? 0)
    return damageDelta || (a.meta_team || '').localeCompare(b.meta_team || '')
  })
  return new Map(
    ranked.map((entry, index) => [
      resolveMetaTeamKey(entry.meta_team),
      index + 1
    ])
  )
}

export function selectMetaTeamProgression(
  progressions: MetaTeamProgression[],
  selectedKey: string | null
) {
  if (progressions.length === 0) return null
  const key = selectedKey ?? resolveMetaTeamKey(null)
  return (
    progressions.find((entry) => resolveMetaTeamKey(entry.meta_team) === key) ??
    progressions[0]
  )
}

export function buildRosterEntryIndex(entries: RosterInputEntry[]) {
  const index = new Map<string, RosterInputEntry>()
  entries.forEach((entry) => {
    const record = typeof entry === 'string' ? { name: entry } : entry
    ;[record.id, record.engineId, record.name]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      )
      .forEach((token) => {
        const key = normalizeHeroKey(token)
        if (key) index.set(key, entry)
      })
  })
  return index
}

export function resolvePotentialDelta(
  currentDamage: number | null,
  targetDamage: number | null,
  fallbackIncrease: number
) {
  if (currentDamage != null && targetDamage != null) {
    return Math.round(targetDamage - currentDamage)
  }
  return fallbackIncrease ? Math.round(fallbackIncrease) : null
}

// Deliberately diverges from upgrade-path-metro-model.ts's parseTeamUnits; do not dedupe.
export const parseTeamUnits = (
  composition: string | null | undefined,
  heroMappings: Map<string, HeroMapping>
): TeamUnitInfo[] => {
  if (!composition) return []
  const parts = composition.split(' + ')
  const heroPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null

  const heroNames = heroPart
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)

  const buildUnit = (name: string, isMow: boolean): TeamUnitInfo => {
    const mapping = resolveHeroMapping(name, heroMappings)
    const displayName = mapping?.display_name || name
    const unitId = mapping?.unit_id || name
    return {
      unitId,
      displayName,
      iconUrl: mapping?.web_icon_url || null,
      isMow
    }
  }

  const units = heroNames.map((name) => buildUnit(name, false))
  if (mowPart) {
    units.push(buildUnit(mowPart, true))
  }
  return units
}

export const resolveRankBadgeClass = (rank: number | null) => {
  if (!rank || rank <= 0) {
    return 'border-(--card-border) bg-card/60 text-primary-wh40k'
  }
  if (rank === 1) {
    return 'border-amber-400/60 bg-amber-500/15 text-amber-200'
  }
  if (rank === 2) {
    return 'border-slate-300/60 bg-slate-400/15 text-primary-wh40k'
  }
  if (rank === 3) {
    return 'border-orange-400/60 bg-orange-500/15 text-orange-200'
  }
  return 'border-(--card-border) bg-card/60 text-primary-wh40k'
}

export const resolveRosterStars = (entry: RosterInputEntry | null) => {
  if (!entry || typeof entry === 'string') return null
  if (typeof entry.stars === 'number' && Number.isFinite(entry.stars))
    return entry.stars
  if (
    typeof entry.progressionIndex === 'number' &&
    Number.isFinite(entry.progressionIndex)
  ) {
    return resolveStarTierFromProgressionIndex(entry.progressionIndex)
  }
  return null
}

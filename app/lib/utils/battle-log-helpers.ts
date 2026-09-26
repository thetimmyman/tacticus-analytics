import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import type { HeroCatalog } from '@/app/lib/catalogs'

/** Render model: `loopIndex` is normalized, `categories` derived, and `id` may be a client string. */
export interface BattleLogEntry {
  id: string | number
  displayName: string | null
  Name: string | null
  damageDealt: number | null
  damageType: string | null
  tier: number | null
  set?: number | null
  rarity?: string | null
  loopIndex: number | null
  completedOn: string | null
  remainingHp: number | null
  maxHp: number | null
  encounterId?: number | null
  heroDetails?: string | null
  machineOfWarDetails?: string | null
  Guild?: string | null
  categories?: string[]
}

export interface HeroMapping {
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
}

export function buildHeroMappingMap(
  catalog: Pick<HeroCatalog, 'getById'>,
  unitIds: Iterable<string>
): Map<string, HeroMapping> {
  const map = new Map<string, HeroMapping>()
  for (const id of unitIds) {
    const hero = catalog.getById(id)
    if (hero) {
      map.set(id, {
        unit_id: hero.unitId,
        display_name: hero.displayName,
        web_icon_url: hero.iconUrl || null
      })
    }
  }
  return map
}

export interface MetaTeamNormalized {
  team_name: string | null
  trigger_heroes: string[] | null
  match_type: 'all' | 'any' | null
}

export function parseHeroDetails(
  heroDetails: string | null | undefined
): string[] {
  if (!heroDetails) return []

  try {
    if (heroDetails.startsWith('[')) {
      const parsed = JSON.parse(heroDetails)
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (typeof item === 'object' && item !== null && item.unitId) {
              return item.unitId as string
            }
            return null
          })
          .filter((h): h is string => h !== null)
          .sort()
      }
    }
    return []
  } catch {
    return []
  }
}

export function parseMachineOfWarDetails(
  machineDetails: string | null | undefined
): string | null {
  if (!machineDetails) return null

  try {
    if (machineDetails.startsWith('{')) {
      const parsed = JSON.parse(machineDetails)
      if (parsed && parsed.unitId) {
        return parsed.unitId as string
      }
    }
    return null
  } catch {
    return null
  }
}

/** trigger_heroes may be an array, a JSON string, or comma-separated. */
export function parseTriggerHeroes(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.filter((hero): hero is string => typeof hero === 'string')
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.filter((hero): hero is string => typeof hero === 'string')
      }
    } catch {
      const segments = value
        .split(',')
        .map((segment) => segment.trim())
        .filter(Boolean)
      return segments.length > 0 ? segments : null
    }
  }

  return null
}

export function detectCategories(
  heroNames: string[],
  teams: MetaTeamNormalized[]
): string[] {
  const matchingCategories: string[] = []

  for (const team of teams) {
    if (!team) continue
    const triggerHeroes = Array.isArray(team.trigger_heroes)
      ? team.trigger_heroes
      : []
    const matchType = team.match_type ?? 'all'
    const teamName = team.team_name ?? ''

    if (triggerHeroes.length === 0 || !teamName) {
      continue
    }

    if (matchType === 'all') {
      const hasAllHeroes = triggerHeroes.every((trigger) =>
        heroNames.some((hero) => hero === trigger)
      )
      if (hasAllHeroes) {
        matchingCategories.push(teamName)
      }
    } else {
      const hasAnyHero = triggerHeroes.some((trigger) =>
        heroNames.some((hero) => hero === trigger)
      )
      if (hasAnyHero) {
        matchingCategories.push(teamName)
      }
    }
  }

  return matchingCategories.length > 0 ? matchingCategories : ['Other']
}

export function normalizeMetaTeams(teams: unknown[]): MetaTeamNormalized[] {
  if (!Array.isArray(teams)) return []
  return teams.map((team) => {
    const t = team as Record<string, unknown>
    return {
      team_name: typeof t?.team_name === 'string' ? t.team_name : null,
      trigger_heroes: parseTriggerHeroes(t?.trigger_heroes),
      match_type:
        t?.match_type === 'any' || t?.match_type === 'all' ? t.match_type : null
    }
  })
}

/** Returns '-' until mounted, to stay hydration-safe. */
export function formatBattleLogTime(
  timestamp: string | null,
  hasMounted: boolean
): string {
  if (!timestamp || !hasMounted) return '-'

  const date = new Date(timestamp)

  const day = date.getDate()
  const month = date.toLocaleString('en-US', { month: 'short' })
  const dateStr = `${day}-${month}`

  const time = date
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    .replace(' ', '')

  const timeZone =
    date
      .toLocaleTimeString('en-US', {
        timeZoneName: 'short'
      })
      .split(' ')
      .pop() || 'UTC'

  return `${dateStr} ${time} ${timeZone}`
}

export function getDamageTypeIcon(type: string | null): string {
  return type === 'Bomb' ? '\u{1F4A3}' : '\u{2694}\u{FE0F}'
}

export function isKillingBlow(
  entry: Pick<BattleLogEntry, 'remainingHp'>
): boolean {
  return entry.remainingHp === 0
}

export function getBossLevel(
  entry: Pick<BattleLogEntry, 'set' | 'rarity' | 'tier'>
): string {
  if (entry.set !== undefined && entry.set !== null) {
    return getBossLevelFromSetAndRarity(entry.set, entry.rarity || 'Common')
  }
  if (entry.tier && entry.tier >= 1 && entry.tier <= 5) {
    return `L${entry.tier}`
  }
  return 'L?'
}

import { formatNumber } from './formatters'
import { normalizeObfuscationPercent } from './privacy'
import type { BossHit } from './rarity-utils'

export type ExplorePrivacyMode =
  'public' | 'hide_primes' | 'hide_players' | 'obfuscate_values' | 'hide_all'
export type ExplorePrivacyModes = ExplorePrivacyMode[]

/** Redaction label for per-player names; explore-privacy-label-agreement.test.ts pins the SQL copies. */
export const ANONYMOUS_PLAYER_LABEL = 'Anonymous Warrior'

export interface GuildDataWithPrivacy {
  guild_code: string
  guild_name: string
  cluster_code: string | null
  cluster_name: string | null
  season: string
  current_gr_ranking?: number | null
  current_war_rank?: number | null
  war_rank?: number | null
  total_battles: number
  active_players: number
  total_damage: number
  avg_damage_per_battle: number
  top_boss_hits: BossHit[]
  available_rarities?: unknown[]
  veteran_count: number
  votlw_champions?: unknown[]
  last_updated: string
  explore_privacy_mode?: ExplorePrivacyModes | ExplorePrivacyMode | string
  explore_obfuscation_percent?: number | null
  obfuscationPercent?: number
  originalTotalDamage?: number
  originalAvgDamagePerBattle?: number
  isObfuscated?: boolean
  [key: string]: unknown // Allow additional properties
}

/** Privacy modes arrive as a JSONB array, a JSON string, or a bare mode name. */
export function parseExplorePrivacyModes(value: unknown): ExplorePrivacyModes {
  if (Array.isArray(value)) return value as ExplorePrivacyModes

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ['public']

    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed as ExplorePrivacyModes
    } catch {
      // Not JSON: treat it as a single mode name.
    }

    return [trimmed as ExplorePrivacyMode]
  }

  return ['public']
}

export function applyPrivacyFilter(
  guild: GuildDataWithPrivacy,
  privacyModes: ExplorePrivacyModes | ExplorePrivacyMode | string = ['public']
): GuildDataWithPrivacy | null {
  const modes = parseExplorePrivacyModes(privacyModes)

  if (modes.includes('hide_all')) {
    return null
  }

  let filteredGuild: GuildDataWithPrivacy = { ...guild }
  filteredGuild.top_boss_hits = Array.isArray(filteredGuild.top_boss_hits)
    ? filteredGuild.top_boss_hits
    : []

  for (const mode of modes) {
    switch (mode) {
      case 'hide_primes':
        // Encounters 1 and 2 are the prime bosses.
        filteredGuild.top_boss_hits = filteredGuild.top_boss_hits.filter(
          (hit) => {
            const encounterId = hit.encounterId ?? 0
            return encounterId !== 1 && encounterId !== 2
          }
        )
        break

      case 'hide_players':
        filteredGuild.top_boss_hits = filteredGuild.top_boss_hits.map(
          (hit) => ({
            ...hit,
            player: ANONYMOUS_PLAYER_LABEL
          })
        )
        // Mirrors public.public_guild_snapshots_explore.
        filteredGuild.votlw_champions = Array.isArray(
          filteredGuild.votlw_champions
        )
          ? filteredGuild.votlw_champions.map((champion) =>
              champion && typeof champion === 'object'
                ? { ...champion, player: ANONYMOUS_PLAYER_LABEL }
                : champion
            )
          : filteredGuild.votlw_champions
        break

      case 'obfuscate_values': {
        // Pass-through: the view already scales each row by a secret-salted factor; a second transform would
        // leave the chosen band. The band width is never served (it helps invert the perturbation): no default.
        const servedPercent =
          typeof guild.explore_obfuscation_percent === 'number'
            ? normalizeObfuscationPercent(guild.explore_obfuscation_percent)
            : typeof guild.obfuscationPercent === 'number'
              ? normalizeObfuscationPercent(guild.obfuscationPercent)
              : undefined

        filteredGuild.top_boss_hits = filteredGuild.top_boss_hits.map(
          (hit) => ({
            ...hit,
            // originalDamage is the obfuscated fallback midpoint, never the truth.
            originalDamage:
              typeof hit.originalDamage === 'number'
                ? hit.originalDamage
                : hit.damage,
            isObfuscated: true,
            obfuscationPercent: servedPercent
          })
        )

        filteredGuild.originalTotalDamage = filteredGuild.total_damage
        filteredGuild.originalAvgDamagePerBattle =
          filteredGuild.avg_damage_per_battle
        filteredGuild.isObfuscated = true
        filteredGuild.obfuscationPercent = servedPercent
        filteredGuild.explore_obfuscation_percent = servedPercent ?? null
        break
      }

      case 'public':
      default:
        break
    }
  }

  return filteredGuild
}

export function formatDamageWithPrivacy(
  damage: number,
  privacyMode: ExplorePrivacyMode = 'public',
  originalDamage?: number,
  obfuscationPercent?: number | null
): string {
  if (privacyMode === 'obfuscate_values') {
    const midpoint =
      Number.isFinite(damage) && damage > 0 ? damage : (originalDamage ?? 0)
    const base = Math.max(0, midpoint)

    // No band width is served, so any range would be invented; say approximate only.
    if (obfuscationPercent === undefined || obfuscationPercent === null) {
      return `~${formatNumber(base)}`
    }

    const percent = normalizeObfuscationPercent(obfuscationPercent)
    const variance = Math.max(0, Math.round(base * (percent / 100)))
    const lowerBound = Math.max(0, base - variance)
    const upperBound = base + variance

    const lowerFormatted = formatNumber(lowerBound)
    const upperFormatted = formatNumber(upperBound)

    return `${lowerFormatted} - ${upperFormatted}`
  }

  return formatNumber(damage)
}

export function filterGuildsByPrivacy(
  guilds: GuildDataWithPrivacy[]
): GuildDataWithPrivacy[] {
  return guilds
    .map((guild) => {
      const privacyModes = guild.explore_privacy_mode || ['public']
      return applyPrivacyFilter(guild, privacyModes)
    })
    .filter((guild): guild is GuildDataWithPrivacy => guild !== null)
}

export function isGuildVisibleOnExplore(
  privacyMode: ExplorePrivacyMode = 'public'
): boolean {
  return privacyMode !== 'hide_all'
}

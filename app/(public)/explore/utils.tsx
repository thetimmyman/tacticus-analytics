import {
  normalizeRarity,
  getAllRaritiesWithData
} from '@tacticus/app-core/rarity-utils'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('explore.utils')
import type { ExplorePrivacyMode } from '@tacticus/app-core/explore-privacy'
import type { GuildSnapshot } from '@tacticus/app-core/database-extensions'
import type { BossHit, RawBossHit, VOTLWChampion, GuildData } from './types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

export const EXPLORE_PRIVACY_MODES: ExplorePrivacyMode[] = [
  'public',
  'hide_primes',
  'hide_players',
  'obfuscate_values',
  'hide_all'
]

const isExplorePrivacyMode = (value: string): value is ExplorePrivacyMode =>
  EXPLORE_PRIVACY_MODES.includes(value as ExplorePrivacyMode)

export function getGuildCardClasses(guild: GuildData): string {
  const isPremium = guild.is_premium === true

  if (isPremium) {
    return 'rounded-lg border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-[var(--card-bg)] to-yellow-500/5 overflow-hidden shadow-lg shadow-amber-500/10 transition-all duration-300 hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/20 relative guild-card-premium'
  }
  return 'rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden shadow-sm transition-all duration-200 hover:border-[color-mix(in_srgb,var(--primary)_30%,transparent)] hover:shadow-lg'
}

export const generateParticles = (rarity: string, count: number = 30) => {
  const particles = []
  const particleConfigs = {
    Mythic: {
      className: 'mythic-particle',
      colors: [
        'rgba(255, 140, 0, 0.8)',
        'rgba(255, 195, 0, 0.7)',
        'rgba(255, 69, 0, 0.9)',
        'rgba(255, 107, 53, 0.6)',
        'rgba(255, 159, 67, 0.8)'
      ]
    },
    Legendary: {
      className: 'diamond-particle',
      colors: [
        'rgba(147, 197, 253, 0.6)',
        'rgba(196, 181, 253, 0.5)',
        'rgba(255, 255, 255, 0.4)',
        'rgba(185, 242, 255, 0.5)',
        'rgba(180, 220, 255, 0.6)'
      ]
    },
    Epic: {
      className: 'epic-particle',
      colors: [
        'rgba(255, 215, 0, 0.8)',
        'rgba(255, 235, 59, 0.7)',
        'rgba(255, 223, 105, 0.6)'
      ]
    },
    Rare: {
      className: 'rare-particle',
      colors: [
        'rgba(59, 130, 246, 0.6)',
        'rgba(96, 165, 250, 0.5)',
        'rgba(147, 197, 253, 0.4)'
      ]
    },
    Uncommon: {
      className: 'uncommon-particle',
      colors: [
        'rgba(34, 197, 94, 0.5)',
        'rgba(74, 222, 128, 0.4)',
        'rgba(22, 163, 74, 0.6)'
      ]
    },
    Common: {
      className: 'common-particle',
      colors: ['rgba(148, 163, 184, 0.3)', 'rgba(100, 116, 139, 0.2)']
    }
  }

  const config = particleConfigs[rarity as keyof typeof particleConfigs]
  if (!config) return []

  for (let i = 0; i < count; i++) {
    const size = Math.random() * 4 + 1 // 1-5px
    const left = Math.random() * 100 // 0-100%
    const top = Math.random() * 100 // 0-100%
    const delay = Math.random() * 8 // 0-8s delay
    const color =
      config.colors[Math.floor(Math.random() * config.colors.length)]

    particles.push(
      <div
        key={`particle-${rarity}-${i}`}
        className={config.className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          left: `${left}%`,
          top: `${top}%`,
          animationDelay: `${delay}s`,
          position: 'absolute',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />
    )
  }

  return particles
}

const normalizeSnapshotMetaTeam = (value: unknown): string => {
  if (typeof value !== 'string') return 'Other'

  const trimmedValue = value.trim()
  if (!trimmedValue || trimmedValue.toLowerCase() === 'unknown') return 'Other'

  // The DB owns classification; stay open so a new label needs no browser release.
  return trimmedValue
}

// Old data format lacks set info.
export const inferSetFromBossName = (bossName: string): number | null => {
  if (!bossName) return null

  const name = bossName.toLowerCase()

  if (name.includes('belisarius')) return 0 // M1
  if (name.includes('kharn') || name.includes('khan')) return 1 // M2
  if (name.includes('fulgrim')) return 2 // M3
  if (name.includes('sanguinius')) return 3 // M4
  if (name.includes('kara')) return 4 // M5

  if (name.includes('eldyron')) return 0 // L1 - Eldyron Captain Aurelia
  if (
    name.includes('avatarofkhaine') ||
    name.includes('avatar of khaine') ||
    name.includes('avatarof')
  )
    return 1 // L2
  if (name.includes('screamerkiller') || name.includes('screamer')) return 2 // L3
  if (name.includes('hivetyrant') || name.includes('tyrant')) return 3 // L4
  if (name.includes('swarmlord')) return 4 // L5

  if (
    (name.includes('captain') || name.includes('lieutenant')) &&
    !name.includes('eldyron')
  )
    return 0 // L1
  if (name.includes('major') || name.includes('colonel')) return 1 // L2
  if (name.includes('general') || name.includes('commander')) return 2 // L3
  if (name.includes('marshal') || name.includes('lord')) return 3 // L4
  if (name.includes('primarch') || name.includes('emperor')) return 4 // L5

  const hash = Array.from(name).reduce(
    (acc, char) => acc + char.charCodeAt(0),
    0
  )
  return hash % 5 // Distribute across sets 0-4
}

export const normalizeTopBossHits = (rawHits: unknown): BossHit[] => {
  let hits: RawBossHit[] = []

  if (Array.isArray(rawHits)) {
    hits = rawHits as RawBossHit[]
  } else if (typeof rawHits === 'string') {
    try {
      const parsed = JSON.parse(rawHits)
      if (Array.isArray(parsed)) {
        hits = parsed as RawBossHit[]
      }
    } catch (error) {
      logger.warn({ error: error }, 'Failed to parse top_boss_hits payload')
    }
  }

  return hits.reduce((acc: BossHit[], hit: RawBossHit) => {
    if (!hit) return acc

    const rawRarity = hit.rarity ?? hit?.rarity_name ?? null
    const finalRarity = normalizeRarity(rawRarity) || 'Common'

    const rawDamage = Number(
      hit.damage ?? hit.damageDealt ?? hit.damage_dealt ?? 0
    )
    const damage = Number.isFinite(rawDamage) ? rawDamage : 0

    const rawSetValue = hit.set ?? hit.boss_set ?? hit.set_level
    let setNumber = Number(rawSetValue)

    if (!Number.isFinite(setNumber)) {
      const bossName = (hit.boss ?? hit.boss_name ?? hit.Name ?? '') as string
      setNumber = inferSetFromBossName(bossName) ?? 0
    }

    const rawEncounterId = hit.encounterId ?? hit.encounter_id ?? null
    let encounterId =
      rawEncounterId !== null && rawEncounterId !== undefined
        ? Number(rawEncounterId)
        : null

    if (encounterId === null || !Number.isFinite(encounterId)) {
      encounterId = 0
    }
    const heroDetails = hit.heroDetails ?? hit.hero_details ?? null
    const tier = hit.tier ?? hit.boss_tier ?? null

    const normalizedHit: BossHit = {
      boss: hit.boss ?? hit.boss_name ?? hit.Name ?? 'Unknown Boss',
      player:
        hit.player ?? hit.player_name ?? hit.displayName ?? 'Unknown Player',
      damage,
      rarity: finalRarity,
      set: Number.isFinite(setNumber) ? setNumber : 0,
      encounterId,
      tier,
      heroDetails,
      metaTeam: normalizeSnapshotMetaTeam(hit.metaTeam)
    }

    acc.push(normalizedHit)
    return acc
  }, [])
}

export const isVotlwChampion = (value: unknown): value is VOTLWChampion => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VOTLWChampion>
  return (
    typeof candidate.player === 'string' && typeof candidate.points === 'number'
  )
}

export const transformGuildSnapshot = (snapshot: GuildSnapshot): GuildData => {
  const normalizedHits = normalizeTopBossHits(snapshot.top_boss_hits ?? null)
  const rarities = getAllRaritiesWithData(normalizedHits)
  const champions: VOTLWChampion[] = Array.isArray(snapshot.votlw_champions)
    ? (snapshot.votlw_champions as unknown[]).filter(isVotlwChampion)
    : []
  const rawPrivacyMode = snapshot.explore_privacy_mode
  // PostgREST returns text columns as strings.
  let parsedPrivacyMode: unknown = rawPrivacyMode
  if (typeof rawPrivacyMode === 'string' && rawPrivacyMode.startsWith('[')) {
    try {
      parsedPrivacyMode = JSON.parse(rawPrivacyMode)
    } catch {
      /* keep as string */
    }
  }
  const normalizedPrivacyMode = Array.isArray(parsedPrivacyMode)
    ? parsedPrivacyMode
        .filter((m): m is string => typeof m === 'string')
        .filter(isExplorePrivacyMode)
    : typeof parsedPrivacyMode === 'string' &&
        isExplorePrivacyMode(parsedPrivacyMode)
      ? parsedPrivacyMode
      : 'public'
  const resolvedPrivacyMode =
    Array.isArray(normalizedPrivacyMode) && normalizedPrivacyMode.length === 0
      ? 'public'
      : normalizedPrivacyMode

  return {
    guild_code: snapshot.guild_code,
    // useGuildData merges guild_tag from guild_config.
    guild_tag: null,
    guild_name: formatGuildDisplayLabel(
      { display_name: snapshot.guild_name, guild_code: snapshot.guild_code },
      snapshot.guild_code
    ),
    cluster_code: snapshot.cluster_code,
    cluster_name: snapshot.cluster_name,
    season: snapshot.season?.toString() || '83',
    current_gr_ranking: snapshot.rank ?? null,
    current_war_rank: snapshot.war_rank ?? null,
    war_rank: snapshot.war_rank ?? null,
    total_battles: snapshot.total_battles ?? 0,
    active_players: snapshot.active_players ?? 0,
    total_damage: snapshot.total_damage ?? 0,
    avg_damage_per_battle: snapshot.avg_damage_per_battle ?? 0,
    top_boss_hits: normalizedHits,
    available_rarities: rarities,
    veteran_count: snapshot.veteran_count || 0,
    votlw_champions: champions,
    last_updated: snapshot.last_updated || new Date().toISOString(),
    explore_privacy_mode: resolvedPrivacyMode,
    explore_obfuscation_percent: snapshot.explore_obfuscation_percent ?? null,
    obfuscationPercent: snapshot.obfuscationPercent ?? undefined,
    originalTotalDamage: snapshot.originalTotalDamage ?? undefined,
    originalAvgDamagePerBattle:
      snapshot.originalAvgDamagePerBattle ?? undefined,
    isObfuscated: snapshot.isObfuscated ?? undefined
  }
}

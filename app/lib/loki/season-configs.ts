import 'server-only'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveEffectiveGlobalConfig } from './effective-global-config'

export interface SeasonBoss {
  boss_type: string
  boss_name: string
  set: number
  encounter_id: number
  rarity: string
  canonical: string
  variant?: string | null
}

export interface SeasonConfig {
  id: string
  bosses: SeasonBoss[]
  canonicalOrder: string[]
}

export interface GlobalConfig {
  guildBoss: {
    misc: {
      bufferAfterSeasonEnd?: number
      seasonDuration?: number
      firstSeasonStart?: number
      [key: string]: unknown
    }
    guildBossSeasonDataConfigsGDTO: Record<string, unknown>
    guildBossSeasonConfigRotation: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

import { VARIANT_LABELS, prettyBossName } from './boss-display'
export { prettyBossName } from './boss-display'

import type {
  ProgressionConfig,
  SeasonLoopPolicy
} from '@/app/lib/boss-assignments/progression-config-shared'
import {
  deriveProgressionConfig,
  ladderStagesFromEncounters,
  resolveSeasonLoopPolicy
} from '@/app/lib/boss-assignments/progression-config-shared'

const DATA_DIR = path.join(process.cwd(), 'data', 'loki-api')

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  guildBoss: {
    misc: {},
    guildBossSeasonDataConfigsGDTO: {},
    guildBossSeasonConfigRotation: []
  }
}

let GLOBAL_CONFIG_META: {
  overrideActive: boolean
  extractedAt: string | null
} = { overrideActive: false, extractedAt: null }

const loadGlobalConfig = (): GlobalConfig => {
  try {
    const { effective, overrideActive } = resolveEffectiveGlobalConfig({
      dataDir: DATA_DIR
    })
    if (!effective) {
      console.warn('[season-configs] GlobalConfig JSON missing', {
        dataDir: DATA_DIR
      })
      return DEFAULT_GLOBAL_CONFIG
    }
    console.info('[season-configs] GlobalConfig source', {
      source: effective.source,
      configVersion: effective.configVersion,
      overrideActive
    })
    GLOBAL_CONFIG_META = { overrideActive, extractedAt: effective.extractedAt }
    return effective.raw as unknown as GlobalConfig
  } catch (error) {
    console.warn('[season-configs] Failed to load GlobalConfig JSON', {
      error: error instanceof Error ? error.message : String(error)
    })
    return DEFAULT_GLOBAL_CONFIG
  }
}

export const GLOBAL_CONFIG = loadGlobalConfig()

// A GlobalConfig snapshot only describes its own ~5-season rotation window, so
// season-lineups.json accumulates every refresh's window keyed by season number.

export interface SeasonLineupEncounter {
  rarityIndex: number | null
  set: number
  encounterIndex: number
  encounterType: string | null
  bossType: string
  unitId: string | null
  boardId: string | null
}

export interface SeasonLineupEntry {
  season: number
  configId: string
  configVersion: string
  capturedAt: string
  loopFromTier?: number | null
  loopFromSet?: number | null
  encounters: SeasonLineupEncounter[]
}

interface SeasonLineupsOverlay {
  schemaVersion: string
  generatedAt: string | null
  sources: Array<{
    configVersion: string
    capturedAt: string
    captureSeason: number
    window: [number, number]
  }>
  seasons: Record<string, SeasonLineupEntry>
}

const loadSeasonLineups = (): SeasonLineupsOverlay => {
  const empty: SeasonLineupsOverlay = {
    schemaVersion: 'loki-season-lineups.v1',
    generatedAt: null,
    sources: [],
    seasons: {}
  }
  try {
    const lineupsPath = path.join(DATA_DIR, 'season-lineups.json')
    if (!existsSync(lineupsPath)) {
      console.warn('[season-configs] season-lineups overlay missing', {
        lineupsPath
      })
      return empty
    }
    return JSON.parse(readFileSync(lineupsPath, 'utf8')) as SeasonLineupsOverlay
  } catch (error) {
    console.warn('[season-configs] Failed to load season-lineups overlay', {
      error: error instanceof Error ? error.message : String(error)
    })
    return empty
  }
}

export const SEASON_LINEUPS = loadSeasonLineups()

/** Null outside the captured range; callers then fall back to rotation math. */
export const getSeasonLineup = (
  seasonNumber: number
): SeasonLineupEntry | null =>
  SEASON_LINEUPS.seasons[String(seasonNumber)] ?? null

/** Display only (legacy default for uncaptured seasons); progression uses getSeasonProgressionConfig(). */
export const getSeasonLoopPolicy = (seasonNumber: number): SeasonLoopPolicy =>
  resolveSeasonLoopPolicy(getSeasonLineup(seasonNumber))

/** The season's own ladder and loop policy, so historical seasons keep theirs. Null when
 * uncaptured or the ladder is empty (the planner would otherwise project zero bosses). */
export const getSeasonProgressionConfig = (
  seasonNumber: number
): ProgressionConfig | null => {
  const lineup = getSeasonLineup(seasonNumber)
  if (!lineup) return null
  const stages = ladderStagesFromEncounters(lineup.encounters)
  if (stages.length === 0) {
    console.warn('[season-configs] lineup has no ladder stages; rejecting', {
      season: seasonNumber,
      configId: lineup.configId,
      encounters: lineup.encounters.length
    })
    return null
  }
  return deriveProgressionConfig({
    stages,
    policy: resolveSeasonLoopPolicy(lineup),
    gameVersion: lineup.configVersion
  })
}

export const SEASON_LINEUP_RANGE: { min: number; max: number } | null = (() => {
  const nums = Object.keys(SEASON_LINEUPS.seasons)
    .map(Number)
    .sort((a, b) => a - b)
  return nums.length ? { min: nums[0]!, max: nums[nums.length - 1]! } : null
})()

const RAW_SEASON_CONFIGS =
  GLOBAL_CONFIG?.guildBoss?.guildBossSeasonDataConfigsGDTO ?? {}

const GLOBAL_MISC = GLOBAL_CONFIG?.guildBoss?.misc ?? {}

const TIER_TO_RARITY = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic'
] as const

const getRarityFromTier = (tierIndex: number): string => {
  return TIER_TO_RARITY[tierIndex] ?? 'Mythic'
}

export const SEASON_ROTATION: string[] =
  GLOBAL_CONFIG?.guildBoss?.guildBossSeasonConfigRotation ?? []

export const SEASON_DURATION_SECONDS: number =
  typeof GLOBAL_MISC?.seasonDuration === 'number'
    ? GLOBAL_MISC.seasonDuration
    : 0

export const SEASON_GAP_SECONDS: number =
  typeof GLOBAL_MISC?.bufferAfterSeasonEnd === 'number' &&
  Number.isFinite(GLOBAL_MISC.bufferAfterSeasonEnd) &&
  GLOBAL_MISC.bufferAfterSeasonEnd >= 0
    ? GLOBAL_MISC.bufferAfterSeasonEnd
    : 86_400

export const FIRST_SEASON_START_MS: number =
  typeof GLOBAL_MISC?.firstSeasonStart === 'number'
    ? GLOBAL_MISC.firstSeasonStart
    : 0

const SEASON_DURATION_MS = SEASON_DURATION_SECONDS * 1000
const SEASON_GAP_MS = SEASON_GAP_SECONDS * 1000

// Displayed season = seasons elapsed since `firstSeasonStart` + 1 - offset.
export const SEASON_NUMBER_OFFSET = 10

// Aligns `guildBossSeasonConfigRotation` indices with live game data (verified empirically).
export const ROTATION_INDEX_OFFSET = 1

// Live GlobalConfig has loopFromTier/loopFromSet as integer strings; the overlay
// stores numbers, and null would fall back to a full-ladder loop from L1.
const toNullableInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) ? number : null
}

// The baked overlay is read first and would shadow a newer runtime override, so
// derive the override's future seasons as merge-season-lineups.cjs would. Fails soft.
const deriveOverrideFutureSeasonEntries = (
  effectiveConfig: GlobalConfig,
  extractedAt: string | null
): SeasonLineupEntry[] => {
  const mod = (value: number, divisor: number) =>
    ((value % divisor) + divisor) % divisor

  try {
    if (!extractedAt) return []
    const guildBoss = effectiveConfig?.guildBoss
    const misc = guildBoss?.misc
    const rotation = guildBoss?.guildBossSeasonConfigRotation
    const configs = guildBoss?.guildBossSeasonDataConfigsGDTO
    const configVersion = (effectiveConfig as { configVersion?: unknown })
      ?.configVersion

    if (
      !Array.isArray(rotation) ||
      rotation.length !== 5 ||
      !configs ||
      typeof configs !== 'object' ||
      typeof configVersion !== 'string' ||
      !configVersion
    ) {
      return []
    }

    const firstSeasonStart = misc?.firstSeasonStart
    const seasonDuration = misc?.seasonDuration
    const seasonGap =
      typeof misc?.bufferAfterSeasonEnd === 'number' &&
      Number.isFinite(misc.bufferAfterSeasonEnd) &&
      misc.bufferAfterSeasonEnd >= 0
        ? misc.bufferAfterSeasonEnd
        : 0

    if (
      typeof firstSeasonStart !== 'number' ||
      typeof seasonDuration !== 'number' ||
      seasonDuration <= 0
    ) {
      return []
    }

    const extractedAtMs = Date.parse(extractedAt)
    if (!Number.isFinite(extractedAtMs)) return []
    const firstPlayableSeasonStart = firstSeasonStart + seasonGap * 1000
    if (extractedAtMs < firstPlayableSeasonStart) return []

    const seasonsElapsed = Math.floor(
      (extractedAtMs - firstPlayableSeasonStart) / (seasonDuration * 1000)
    )
    const captureSeason = seasonsElapsed + 1 - SEASON_NUMBER_OFFSET
    const rotationIndex = mod(
      seasonsElapsed + ROTATION_INDEX_OFFSET,
      rotation.length
    )

    const entries: SeasonLineupEntry[] = []
    for (let offset = 1; offset < 5; offset += 1) {
      const configId = rotation[mod(rotationIndex + offset, rotation.length)]
      if (typeof configId !== 'string') continue
      const rawConfig = (configs as Record<string, unknown>)[configId] as
        | { tiers?: unknown; loopFromTier?: unknown; loopFromSet?: unknown }
        | undefined
      if (!rawConfig || !Array.isArray(rawConfig.tiers)) continue

      const encounters: SeasonLineupEncounter[] = []
      rawConfig.tiers.forEach((rawTier: unknown, rarityIndex: number) => {
        const sets = Array.isArray((rawTier as { sets?: unknown })?.sets)
          ? ((rawTier as { sets?: unknown }).sets as unknown[])
          : []
        sets.forEach((rawSet) => {
          const set = (rawSet as { set?: unknown })?.set
          const rawEncounters = Array.isArray(
            (rawSet as { encounters?: unknown })?.encounters
          )
            ? ((rawSet as { encounters?: unknown }).encounters as unknown[])
            : []
          rawEncounters.forEach((rawEncounter) => {
            const encounter = rawEncounter as {
              encounterIndex?: unknown
              bossType?: unknown
              guildBossEncounterType?: unknown
              encounterType?: unknown
              unitId?: unknown
              boardId?: unknown
            }
            if (
              typeof encounter?.encounterIndex !== 'number' ||
              typeof encounter?.bossType !== 'string' ||
              !encounter.bossType
            ) {
              return
            }
            encounters.push({
              rarityIndex,
              set: typeof set === 'number' ? set : -1,
              encounterIndex: encounter.encounterIndex,
              encounterType:
                typeof encounter.guildBossEncounterType === 'string'
                  ? encounter.guildBossEncounterType
                  : typeof encounter.encounterType === 'string'
                    ? encounter.encounterType
                    : null,
              bossType: encounter.bossType,
              unitId:
                typeof encounter.unitId === 'string' ? encounter.unitId : null,
              boardId:
                typeof encounter.boardId === 'string' ? encounter.boardId : null
            })
          })
        })
      })
      if (encounters.length === 0) continue

      entries.push({
        season: captureSeason + offset,
        configId,
        configVersion,
        capturedAt: new Date(extractedAtMs).toISOString(),
        loopFromTier: toNullableInteger(rawConfig.loopFromTier),
        loopFromSet: toNullableInteger(rawConfig.loopFromSet),
        encounters
      })
    }
    return entries
  } catch (error) {
    console.warn('[season-configs] override lineup derivation failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

/** Mutates `overlaySeasons`; replaces an entry only when strictly newer by `capturedAt`. */
export const patchOverlaySeasonsWithOverride = (
  overlaySeasons: Record<string, SeasonLineupEntry>,
  effectiveConfig: GlobalConfig,
  meta: { overrideActive: boolean; extractedAt: string | null }
): Record<string, SeasonLineupEntry> => {
  if (!meta.overrideActive) return overlaySeasons
  const derived = deriveOverrideFutureSeasonEntries(
    effectiveConfig,
    meta.extractedAt
  )
  derived.forEach((entry) => {
    const existing = overlaySeasons[String(entry.season)]
    const existingMs = existing ? Date.parse(existing.capturedAt) : NaN
    const entryMs = Date.parse(entry.capturedAt)
    if (!Number.isFinite(existingMs) || entryMs > existingMs) {
      overlaySeasons[String(entry.season)] = entry
    }
  })
  return overlaySeasons
}

patchOverlaySeasonsWithOverride(
  SEASON_LINEUPS.seasons,
  GLOBAL_CONFIG,
  GLOBAL_CONFIG_META
)

export const canonicalizeBossId = (value: string): string => {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (cleaned.startsWith('tervigon')) return 'tervigon'
  if (cleaned.startsWith('hivetyrant')) return 'hive_tyrant'
  return cleaned
}

const seasonLineupToConfig = (lineup: SeasonLineupEntry): SeasonConfig => {
  const bosses: SeasonBoss[] = []
  const canonicalOrder: string[] = []
  const seenCanonicals = new Set<string>()

  lineup.encounters.forEach((encounter) => {
    const canonical = canonicalizeBossId(encounter.bossType)
    bosses.push({
      boss_type: encounter.bossType,
      boss_name: prettyBossName(encounter.bossType),
      set: typeof encounter.set === 'number' ? encounter.set : -1,
      encounter_id: encounter.encounterIndex,
      rarity: getRarityFromTier(encounter.rarityIndex ?? -1),
      canonical,
      variant: null
    })

    if (encounter.encounterIndex === 0 && !seenCanonicals.has(canonical)) {
      seenCanonicals.add(canonical)
      canonicalOrder.push(canonical)
    }
  })

  return {
    id: lineup.configId,
    bosses,
    canonicalOrder
  }
}

const SEASON_CONFIG_BY_NUMBER = new Map(
  Object.values(SEASON_LINEUPS.seasons).map((lineup) => [
    lineup.season,
    seasonLineupToConfig(lineup)
  ])
)

export const getSeasonConfigForSeasonNumber = (
  seasonNumber: number
): SeasonConfig | null => SEASON_CONFIG_BY_NUMBER.get(seasonNumber) ?? null

const extractSeasonConfigs = (): SeasonConfig[] => {
  const configs: SeasonConfig[] = []

  type RawEncounter = {
    encounterIndex?: number
    bossType?: string
    unitId?: string
    difficulty?: string
    tier?: string
  }

  type RawSet = {
    set?: number
    chestId?: string
    encounters?: unknown
  }

  type RawTier = {
    sets?: unknown
  }

  const entries = Object.entries(RAW_SEASON_CONFIGS) as Array<[string, unknown]>

  entries.forEach(([configId, configData]) => {
    const bosses: SeasonBoss[] = []
    const canonicalOrder: string[] = []
    const seenCanonicals = new Set<string>()

    const tiers = Array.isArray((configData as { tiers?: unknown }).tiers)
      ? ((configData as { tiers?: unknown }).tiers as RawTier[])
      : []

    tiers.forEach((tier, tierIndex) => {
      const sets = Array.isArray(tier?.sets) ? (tier.sets as RawSet[]) : []
      const rarity = getRarityFromTier(tierIndex)

      sets.forEach((set) => {
        const setLevel = typeof set?.set === 'number' ? set.set : -1
        const encounters = Array.isArray(set?.encounters)
          ? (set.encounters as RawEncounter[])
          : []

        encounters.forEach((encounter) => {
          if (!encounter?.bossType) return

          const bossType: string = encounter.bossType
          const canonical = canonicalizeBossId(bossType)
          const encounterIndex = encounter.encounterIndex ?? 0

          const variant = VARIANT_LABELS.has(encounter?.difficulty ?? '')
            ? encounter?.difficulty
            : VARIANT_LABELS.has(encounter?.tier ?? '')
              ? encounter?.tier
              : null

          bosses.push({
            boss_type: bossType,
            boss_name: prettyBossName(bossType, variant),
            set: setLevel,
            encounter_id: encounterIndex,
            rarity,
            canonical,
            variant
          })

          if (encounterIndex === 0 && !seenCanonicals.has(canonical)) {
            seenCanonicals.add(canonical)
            canonicalOrder.push(canonical)
          }
        })
      })
    })

    configs.push({
      id: configId,
      bosses,
      canonicalOrder
    })
  })

  return configs
}

export const SEASON_CONFIGS = extractSeasonConfigs()

const CONFIG_BY_ID = new Map(
  SEASON_CONFIGS.map((config) => [config.id, config])
)

export const CANONICAL_SEQUENCE = SEASON_CONFIGS.map((config) => config.id)

const DEFAULT_CONFIG: SeasonConfig = SEASON_CONFIGS[0] ?? {
  id: 'unknown',
  bosses: [],
  canonicalOrder: []
}

export const canonicalizeObservedName = (name: string): string => {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (cleaned.startsWith('tervigon')) return 'tervigon'
  if (cleaned.startsWith('hivetyrant')) return 'hive_tyrant'
  return cleaned
}

export interface MatchedSeasonConfig {
  config: SeasonConfig
  matches: number
}

export const matchSeasonConfig = (
  observedNames: string[]
): MatchedSeasonConfig => {
  const canonicalObserved = new Set(observedNames.map(canonicalizeObservedName))

  let bestMatch: SeasonConfig | null = null
  let bestScore = -1

  SEASON_CONFIGS.forEach((config) => {
    const score = config.canonicalOrder.reduce((sum, canonical) => {
      return canonicalObserved.has(canonical) ? sum + 1 : sum
    }, 0)

    if (score > bestScore) {
      bestScore = score
      bestMatch = config
    }
  })

  return {
    config: bestMatch ?? DEFAULT_CONFIG,
    matches: Math.max(bestScore, 0)
  }
}

export const getNextSeasonConfig = (currentId: string): SeasonConfig => {
  const index = SEASON_CONFIGS.findIndex((config) => config.id === currentId)
  if (index === -1) {
    return DEFAULT_CONFIG
  }
  const nextIndex = (index + 1) % SEASON_CONFIGS.length
  return SEASON_CONFIGS[nextIndex] ?? DEFAULT_CONFIG
}

export const getSeasonConfigById = (configId: string): SeasonConfig => {
  const config = CONFIG_BY_ID.get(configId)
  if (!config) {
    return DEFAULT_CONFIG
  }
  return config
}

export const getSeasonPosition = (reference: Date | number = Date.now()) => {
  const rotationLength = SEASON_ROTATION.length

  if (
    !rotationLength ||
    SEASON_DURATION_MS <= 0 ||
    FIRST_SEASON_START_MS <= 0
  ) {
    return {
      index: 0,
      seasonNumber: 1,
      rotationLength
    }
  }

  const referenceMs =
    reference instanceof Date ? reference.getTime() : reference
  // firstSeasonStart precedes the leading gap; as in season-timing-service, the
  // next season must not become current during the rollover gap.
  const elapsedMs = Math.max(
    0,
    referenceMs - FIRST_SEASON_START_MS - SEASON_GAP_MS
  )
  const seasonsElapsed = Math.floor(elapsedMs / SEASON_DURATION_MS)

  const adjustedSeasons = seasonsElapsed + ROTATION_INDEX_OFFSET

  return {
    index:
      ((adjustedSeasons % rotationLength) + rotationLength) % rotationLength,
    seasonNumber: seasonsElapsed + 1 - SEASON_NUMBER_OFFSET,
    rotationLength
  }
}

export const getSeasonConfigIdForOffset = (
  offset: number,
  reference?: Date | number
): { id: string; seasonNumber: number } => {
  const { index, seasonNumber, rotationLength } = getSeasonPosition(reference)

  if (rotationLength > 0) {
    const targetIndex =
      (((index + offset) % rotationLength) + rotationLength) % rotationLength
    return {
      id: SEASON_ROTATION[targetIndex] ?? DEFAULT_CONFIG.id,
      seasonNumber: seasonNumber + offset
    }
  }

  const fallbackLength = SEASON_CONFIGS.length
  if (fallbackLength === 0) {
    return {
      id: DEFAULT_CONFIG.id,
      seasonNumber: seasonNumber + offset
    }
  }

  const targetIndex =
    (((index + offset) % fallbackLength) + fallbackLength) % fallbackLength
  const fallbackConfig = SEASON_CONFIGS[targetIndex] ?? DEFAULT_CONFIG
  return {
    id: fallbackConfig.id,
    seasonNumber: seasonNumber + offset
  }
}

import { getRankIndexFromName } from '@/app/lib/tacticus/ranks'
import type { RosterHeroInput, RosterInputEntry } from './roster-input'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

export type OwnershipState = 'missing' | 'owned' | 'unknown'
export type StrengthState =
  'Locked' | 'Invalid' | 'Weak' | 'Suitable' | 'Strong' | 'Optimal'

export type HeroRequirement = {
  hero_name: string
  min_rank: string | null
  min_rank_index: number | null
  min_ability_active: number | null
  min_ability_passive: number | null
  min_ability_mythic: number | null
  min_rarity: string | null
  min_stars: number | null
  notes?: string | null
}

type AbilityThresholds = {
  suitable: number
  strong: number
  optimal: number
}

type RankThresholds = {
  weak: number
  suitable: number
  strong: number
  optimal: number
}

export type StrengthThresholds = {
  suitable: number
  strong: number
  optimal: number
  source: 'data' | 'fallback' | 'none'
  sampleSize: number
  abilityMinimums: AbilityThresholds | null
  rankThresholds: RankThresholds | null
  rarity: string | null
}

export type PlaybookStrengthOverrides = {
  boss_id: string
  team_id: string | null
  difficulty: string | null
  heroes: Map<string, HeroRequirement>
  source: 'playbook'
}

type PowerInfo = {
  power: number | null
  powerSource: 'provided' | 'derived' | null
  score: number | null
  hasStrengthData: boolean
}

type NormalizedRosterEntry = {
  raw: RosterHeroInput
  tokens: string[]
  power: number | null
  powerSource: 'provided' | 'derived' | null
  strengthScore: number | null
  hasStrengthData: boolean
}

export type RosterLookup = {
  entries: NormalizedRosterEntry[]
  hasEntries: boolean
  hasStrengthData: boolean
  find: (name: string) => NormalizedRosterEntry | null
}

const WEIGHTS = {
  rank: 0.35,
  rarity: 0.2,
  stars: 0.1,
  ability: 0.1
}

const RARITY_SET_PATTERN = /^([CURELM])(\d+)$/i
const RARITY_NAME_BY_PREFIX: Record<string, string> = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  E: 'Epic',
  L: 'Legendary',
  M: 'Mythic'
}
const RARITY_TO_PROGRESSION_INDEX: Record<string, number> = {
  Common: 0,
  Uncommon: 3,
  Rare: 6,
  Epic: 9,
  Legendary: 12,
  Mythic: 16
}
const ABILITY_MINIMUMS_BY_RARITY: Record<string, AbilityThresholds> = {
  Common: { suitable: 4, strong: 8, optimal: 8 },
  Uncommon: { suitable: 8, strong: 16, optimal: 16 },
  Rare: { suitable: 16, strong: 26, optimal: 26 },
  Epic: { suitable: 26, strong: 35, optimal: 35 },
  Legendary: { suitable: 30, strong: 42, optimal: 50 },
  Mythic: { suitable: 36, strong: 50, optimal: 55 }
}

const resolveRankIndex = getRankIndexFromName

const buildRankThresholds = (
  weak: string,
  suitable: string,
  strong: string,
  optimal: string
): RankThresholds | null => {
  const weakIndex = resolveRankIndex(weak)
  const suitableIndex = resolveRankIndex(suitable)
  const strongIndex = resolveRankIndex(strong)
  const optimalIndex = resolveRankIndex(optimal)
  if (
    weakIndex == null ||
    suitableIndex == null ||
    strongIndex == null ||
    optimalIndex == null
  ) {
    return null
  }
  return {
    weak: weakIndex,
    suitable: suitableIndex,
    strong: strongIndex,
    optimal: optimalIndex
  }
}

const resolveRankThresholds = (
  rarity: string,
  setNumber: number
): RankThresholds | null => {
  switch (rarity) {
    case 'Common':
      return buildRankThresholds('Iron I', 'Bronze I', 'Silver I', 'Gold I')
    case 'Uncommon':
      return buildRankThresholds('Bronze I', 'Silver I', 'Gold I', 'Diamond I')
    case 'Rare':
      return buildRankThresholds(
        'Gold I',
        'Diamond I',
        'Diamond II',
        'Adamantium I'
      )
    case 'Epic':
      return buildRankThresholds(
        'Diamond I',
        'Diamond II',
        'Diamond III',
        'Adamantium I'
      )
    case 'Legendary':
      return setNumber >= 3
        ? buildRankThresholds(
            'Diamond II',
            'Diamond III',
            'Diamond III',
            'Adamantium I'
          )
        : buildRankThresholds(
            'Diamond I',
            'Diamond II',
            'Diamond III',
            'Adamantium I'
          )
    case 'Mythic':
      return setNumber >= 3
        ? buildRankThresholds(
            'Adamantium I',
            'Adamantium II',
            'Adamantium III',
            'Adamantium III'
          )
        : buildRankThresholds(
            'Diamond II',
            'Diamond III',
            'Adamantium I',
            'Adamantium I'
          )
    default:
      return null
  }
}

const clampScore = (value: number): number => Math.min(1, Math.max(0, value))

const normalizeToken = normalizeIdentifier

const resolveAbilityLevels = (entry: RosterHeroInput) => {
  const levels = Array.isArray(entry.abilities)
    ? entry.abilities
        .map((ability) => ability.level)
        .filter(
          (level): level is number =>
            typeof level === 'number' && Number.isFinite(level)
        )
    : []
  let activeLevel: number | null = null
  let passiveLevel: number | null = null
  let mythicLevel: number | null = null

  if (Array.isArray(entry.abilities)) {
    for (const ability of entry.abilities) {
      const id = typeof ability.id === 'string' ? ability.id.toLowerCase() : ''
      if (!id || typeof ability.level !== 'number') continue
      if (id.includes('active') && activeLevel == null)
        activeLevel = ability.level
      if (id.includes('passive') && passiveLevel == null)
        passiveLevel = ability.level
      if (id.includes('mythic') && mythicLevel == null)
        mythicLevel = ability.level
    }
  }

  if (levels.length > 0) {
    if (activeLevel == null) activeLevel = levels[0] ?? null
    if (passiveLevel == null) {
      passiveLevel =
        levels.length > 1
          ? (levels[1] ?? levels[0] ?? null)
          : (levels[0] ?? null)
    }
    if (mythicLevel == null && levels.length > 2) {
      mythicLevel = levels[2] ?? null
    }
  }

  const mow = isMowEntry(entry)
  if (mow) {
    passiveLevel = activeLevel
  }

  return { levels, activeLevel, passiveLevel, mythicLevel, isMow: mow }
}

const resolveOverrideState = (
  entry: RosterHeroInput,
  override: HeroRequirement
): StrengthState => {
  const requiredRank =
    override.min_rank_index ?? resolveRankIndex(override.min_rank ?? '')
  if (requiredRank != null) {
    const rankValue =
      typeof entry.rank === 'number' && Number.isFinite(entry.rank)
        ? entry.rank
        : null
    if (rankValue == null) return 'Invalid'
    if (rankValue < requiredRank) return 'Weak'
  }

  if (override.min_rarity) {
    const requiredProgression =
      RARITY_TO_PROGRESSION_INDEX[override.min_rarity] ?? null
    const progressionIndex =
      typeof entry.progressionIndex === 'number' &&
      Number.isFinite(entry.progressionIndex)
        ? entry.progressionIndex
        : null
    if (requiredProgression != null) {
      if (progressionIndex == null) return 'Invalid'
      if (progressionIndex < requiredProgression) return 'Weak'
    }
  }

  if (override.min_stars != null) {
    const resolvedStars =
      typeof entry.stars === 'number' && Number.isFinite(entry.stars)
        ? entry.stars
        : typeof entry.progressionIndex === 'number' &&
            Number.isFinite(entry.progressionIndex)
          ? entry.progressionIndex
          : null
    if (resolvedStars == null) return 'Invalid'
    if (resolvedStars < override.min_stars) return 'Weak'
  }

  const { activeLevel, passiveLevel, mythicLevel, isMow } =
    resolveAbilityLevels(entry)
  if (override.min_ability_active != null) {
    if (activeLevel == null) return 'Invalid'
    if (activeLevel < override.min_ability_active) return 'Weak'
  }
  if (override.min_ability_passive != null && !isMow) {
    if (passiveLevel == null) return 'Invalid'
    if (passiveLevel < override.min_ability_passive) return 'Weak'
  }
  if (override.min_ability_mythic != null && isMow) {
    if (mythicLevel == null) return 'Invalid'
    if (mythicLevel < override.min_ability_mythic) return 'Weak'
  }

  return 'Suitable'
}

const isMowEntry = (entry: RosterHeroInput): boolean => {
  const category =
    typeof entry.category === 'string' ? entry.category.toLowerCase() : ''
  return category === 'mow' || category.includes('machine')
}

const resolveMowAbilityLevel = (levels: number[]): number | null => {
  if (levels.length === 0) return null
  const topLevels = levels.slice(0, 2)
  return Math.min(...topLevels)
}

const getRarityTierFromProgressionIndex = (
  progressionIndex: number
): number => {
  if (progressionIndex >= 16) return 6
  if (progressionIndex >= 12) return 5
  if (progressionIndex >= 9) return 4
  if (progressionIndex >= 6) return 3
  if (progressionIndex >= 3) return 2
  return 1
}

const getStarTierFromProgressionIndex = (progressionIndex: number): number => {
  if (progressionIndex >= 16) return 6
  if (progressionIndex >= 12) return 5
  if (progressionIndex >= 9) return 4
  if (progressionIndex >= 6) return 3
  if (progressionIndex >= 3) return 2
  return 1
}

const hasStrengthFields = (entry: RosterHeroInput): boolean => {
  if (typeof entry.power === 'number' && Number.isFinite(entry.power))
    return true
  if (typeof entry.rank === 'number' && Number.isFinite(entry.rank)) return true
  if (
    typeof entry.progressionIndex === 'number' &&
    Number.isFinite(entry.progressionIndex)
  )
    return true
  if (typeof entry.stars === 'number' && Number.isFinite(entry.stars))
    return true
  if (
    Array.isArray(entry.abilities) &&
    entry.abilities.some((a) => typeof a.level === 'number')
  ) {
    return true
  }
  return false
}

type DerivePowerOptions = {
  includeStars?: boolean
  includeAbilities?: boolean
  allowProvided?: boolean
}

const derivePower = (
  entry: RosterHeroInput,
  options: DerivePowerOptions = {}
): PowerInfo => {
  const includeStars = options.includeStars === true
  const includeAbilities = options.includeAbilities !== false
  const allowProvided = options.allowProvided !== false

  if (
    allowProvided &&
    typeof entry.power === 'number' &&
    Number.isFinite(entry.power)
  ) {
    return {
      power: Math.round(entry.power),
      powerSource: 'provided',
      score: clampScore(entry.power / 1000),
      hasStrengthData: true
    }
  }

  const components: Array<{ weight: number; score: number }> = []

  if (typeof entry.rank === 'number' && Number.isFinite(entry.rank)) {
    components.push({
      weight: WEIGHTS.rank,
      score: clampScore(entry.rank / 23)
    })
  }
  let starTier: number | null = null

  if (
    typeof entry.progressionIndex === 'number' &&
    Number.isFinite(entry.progressionIndex)
  ) {
    const rarityTier = getRarityTierFromProgressionIndex(entry.progressionIndex)
    components.push({
      weight: WEIGHTS.rarity,
      score: clampScore(rarityTier / 6)
    })
    if (includeStars) {
      if (typeof entry.stars === 'number' && Number.isFinite(entry.stars)) {
        starTier = entry.stars
      } else {
        starTier = getStarTierFromProgressionIndex(entry.progressionIndex)
      }
    }
  } else if (
    includeStars &&
    typeof entry.stars === 'number' &&
    Number.isFinite(entry.stars)
  ) {
    starTier = entry.stars
  }

  if (includeStars && starTier != null) {
    components.push({ weight: WEIGHTS.stars, score: clampScore(starTier / 6) })
  }

  if (
    includeAbilities &&
    Array.isArray(entry.abilities) &&
    entry.abilities.length > 0
  ) {
    const levels = entry.abilities
      .map((ability) => ability.level)
      .filter(
        (level): level is number =>
          typeof level === 'number' && Number.isFinite(level)
      )
    if (levels.length > 0) {
      const avgLevel =
        levels.reduce((sum, level) => sum + level, 0) / levels.length
      components.push({
        weight: WEIGHTS.ability,
        score: clampScore(avgLevel / 50)
      })
    }
  }

  if (components.length === 0) {
    return {
      power: null,
      powerSource: null,
      score: null,
      hasStrengthData: false
    }
  }

  const weightSum = components.reduce((sum, entry) => sum + entry.weight, 0)
  const weighted = components.reduce(
    (sum, entry) => sum + entry.weight * entry.score,
    0
  )
  const score = weightSum > 0 ? weighted / weightSum : 0
  const power = Math.round(score * 1000)

  return {
    power,
    powerSource: 'derived',
    score,
    hasStrengthData: true
  }
}

const collectTokens = (entry: RosterHeroInput): string[] => {
  const tokens = new Set<string>()
  const addToken = (value?: string | null) => {
    if (!value) return
    const normalized = normalizeToken(value)
    if (normalized) tokens.add(normalized)
  }
  addToken(entry.id)
  addToken(entry.name)
  addToken(entry.engineId)
  return Array.from(tokens)
}

const shouldReplaceEntry = (
  existing: NormalizedRosterEntry,
  incoming: NormalizedRosterEntry
) => {
  if (incoming.power != null && existing.power == null) return true
  return false
}

export const buildRosterLookup = (
  roster: RosterInputEntry[] | null | undefined
): RosterLookup => {
  const entries: NormalizedRosterEntry[] = []
  const tokenMap = new Map<string, NormalizedRosterEntry>()
  let hasStrengthData = false

  for (const entry of roster || []) {
    const raw: RosterHeroInput =
      typeof entry === 'string' ? { name: entry.trim() } : entry
    const tokens = collectTokens(raw)
    if (tokens.length === 0) continue

    const powerInfo = hasStrengthFields(raw)
      ? derivePower(raw)
      : {
          power: null,
          powerSource: null,
          score: null,
          hasStrengthData: false
        }
    hasStrengthData = hasStrengthData || powerInfo.hasStrengthData

    const normalized: NormalizedRosterEntry = {
      raw,
      tokens,
      power: powerInfo.power,
      powerSource: powerInfo.powerSource,
      strengthScore:
        powerInfo.score != null ? Math.round(powerInfo.score * 100) : null,
      hasStrengthData: powerInfo.hasStrengthData
    }

    entries.push(normalized)
    for (const token of tokens) {
      const existing = tokenMap.get(token)
      if (!existing || shouldReplaceEntry(existing, normalized)) {
        tokenMap.set(token, normalized)
      }
    }
  }

  const find = (name: string) => {
    const normalized = normalizeToken(name)
    if (!normalized) return null
    const direct = tokenMap.get(normalized)
    if (direct) return direct
    for (const entry of entries) {
      for (const token of entry.tokens) {
        if (token === normalized) return entry
        if (token.length < 4 || normalized.length < 4) continue
        if (token.startsWith(normalized) || normalized.startsWith(token)) {
          return entry
        }
      }
    }
    return null
  }

  return {
    entries,
    hasEntries: entries.length > 0,
    hasStrengthData,
    find
  }
}

const parseRaritySet = (value: string | null) => {
  if (!value) return null
  const match = value.trim().toUpperCase().match(RARITY_SET_PATTERN)
  if (!match) return null
  const prefix = match[1] ?? ''
  if (!prefix) return null
  const setNumber = Number(match[2])
  if (!Number.isFinite(setNumber) || setNumber <= 0) return null
  const rarity = RARITY_NAME_BY_PREFIX[prefix]
  if (!rarity) return null
  return {
    rarity,
    set: setNumber - 1
  }
}

const resolveThresholds = (raritySet: string | null): StrengthThresholds => {
  const parsed = parseRaritySet(raritySet)
  if (!parsed) {
    return {
      suitable: 0,
      strong: 0,
      optimal: 0,
      source: 'none',
      sampleSize: 0,
      abilityMinimums: null,
      rankThresholds: null,
      rarity: null
    }
  }

  const progressionIndex = RARITY_TO_PROGRESSION_INDEX[parsed.rarity]
  const rankThresholds = resolveRankThresholds(parsed.rarity, parsed.set)
  if (progressionIndex == null || !rankThresholds) {
    return {
      suitable: 0,
      strong: 0,
      optimal: 0,
      source: 'none',
      sampleSize: 0,
      abilityMinimums: null,
      rankThresholds,
      rarity: parsed.rarity
    }
  }

  const abilityMinimums = ABILITY_MINIMUMS_BY_RARITY[parsed.rarity] ?? null
  const resolvePowerForRank = (rankValue: number) =>
    derivePower(
      { rank: rankValue, progressionIndex },
      { includeStars: false, includeAbilities: false, allowProvided: false }
    ).power ?? 0
  const roundedBase = Math.round(resolvePowerForRank(rankThresholds.suitable))
  const roundedStrong = Math.round(resolvePowerForRank(rankThresholds.strong))
  const roundedMax = Math.round(resolvePowerForRank(rankThresholds.optimal))

  return {
    suitable: roundedBase,
    strong: roundedStrong,
    optimal: roundedMax,
    source: 'fallback',
    sampleSize: 0,
    abilityMinimums,
    rankThresholds,
    rarity: parsed.rarity
  }
}

export const getStrengthThresholdsForRaritySet = (
  raritySet: string | null
): StrengthThresholds => resolveThresholds(raritySet)

export const fetchStrengthThresholds = async (options: {
  bossName: string | null
  bossType: string | null
  raritySet: string | null
  encounterIndex: number | null
  season: string | null
}): Promise<StrengthThresholds> => {
  return resolveThresholds(options.raritySet)
}

const evaluateStrengthStateBase = (
  entry: RosterHeroInput | null,
  thresholds: StrengthThresholds | null
): StrengthState | null => {
  if (!entry || !thresholds || thresholds.source === 'none') return null

  const mowEntry = isMowEntry(entry)
  const abilityLevels = Array.isArray(entry.abilities)
    ? entry.abilities
        .map((ability) => ability.level)
        .filter(
          (level): level is number =>
            typeof level === 'number' && Number.isFinite(level)
        )
    : []
  const minAbilityLevel = mowEntry
    ? resolveMowAbilityLevel(abilityLevels)
    : abilityLevels.length >= 2
      ? Math.min(...abilityLevels)
      : null
  const abilityMinimums = thresholds.abilityMinimums
  const rankThresholds = thresholds.rankThresholds
  const meetsAbility = (required: number | null) => {
    if (required == null) return true
    if (minAbilityLevel == null) return false
    return minAbilityLevel >= required
  }

  if (mowEntry) {
    if (minAbilityLevel == null) return 'Invalid'
    if (!meetsAbility(abilityMinimums?.suitable ?? null)) return 'Weak'
    if (!meetsAbility(abilityMinimums?.strong ?? null)) return 'Suitable'
    if (!meetsAbility(abilityMinimums?.optimal ?? null)) return 'Strong'
    return 'Optimal'
  }

  if (rankThresholds) {
    const rankValue =
      typeof entry.rank === 'number' && Number.isFinite(entry.rank)
        ? entry.rank
        : null
    if (rankValue == null) return 'Invalid'
    if (
      rankValue < rankThresholds.suitable ||
      !meetsAbility(abilityMinimums?.suitable ?? null)
    )
      return 'Weak'
    if (
      rankValue < rankThresholds.strong ||
      !meetsAbility(abilityMinimums?.strong ?? null)
    )
      return 'Suitable'
    if (
      rankValue < rankThresholds.optimal ||
      !meetsAbility(abilityMinimums?.optimal ?? null)
    )
      return 'Strong'
    if (!meetsAbility(abilityMinimums?.optimal ?? null)) return 'Strong'
    return 'Optimal'
  }

  const basePowerInfo = derivePower(entry, {
    includeStars: false,
    includeAbilities: false,
    allowProvided: false
  })
  const fullPowerInfo = derivePower(entry)
  const basePower =
    basePowerInfo.power ??
    (typeof entry.power === 'number' && Number.isFinite(entry.power)
      ? Math.round(entry.power)
      : null)
  const fullPower = fullPowerInfo.power

  if (basePower == null || fullPower == null) return 'Invalid'
  if (
    basePower < thresholds.suitable ||
    !meetsAbility(abilityMinimums?.suitable ?? null)
  )
    return 'Weak'
  if (
    fullPower < thresholds.strong ||
    !meetsAbility(abilityMinimums?.strong ?? null)
  )
    return 'Suitable'
  if (
    fullPower < thresholds.optimal ||
    !meetsAbility(abilityMinimums?.optimal ?? null)
  )
    return 'Strong'
  return 'Optimal'
}

export const evaluateStrengthState = (
  entry: RosterHeroInput | null,
  thresholds: StrengthThresholds | null,
  heroOverride?: HeroRequirement | null
): StrengthState | null => {
  if (!entry) return null

  if (heroOverride) {
    const overrideState = resolveOverrideState(entry, heroOverride)
    if (overrideState !== 'Suitable') return overrideState

    const baseState = evaluateStrengthStateBase(entry, thresholds)
    if (!baseState || baseState === 'Weak' || baseState === 'Invalid') {
      return 'Suitable'
    }
    return baseState
  }

  return evaluateStrengthStateBase(entry, thresholds)
}

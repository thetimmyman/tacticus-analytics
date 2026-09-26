import {
  calculateAssignmentScore,
  calculateRosterCoverage,
  type AssignmentScoreParams
} from '../_shared/meta-analysis.ts'

export type SolverMode = 'current' | 'upcoming'

export type SolverWeights = {
  damage: number
  preference: number
  reliability: number
}

export type AssignmentConfig = {
  priority_groups: string[][]
  solver_weights: SolverWeights
  excluded_bosses: string[]
  max_tokens_per_player: number
  max_tokens_per_boss: number
  min_tokens_per_boss: number
  prime_penalty_multiplier: number
}

export type SolverRequest = {
  guild_code?: string
  mode?: SolverMode
  season?: string
  season_id?: string
  excluded_bosses?: string[]
  selected_bosses?: Array<{
    boss_name: string
    boss_type?: string
    rarity: string
    set: number
    encounter_id: number
  }>
  player_token_limits?: Record<string, number>
  config_overrides?: Partial<AssignmentConfig>
  min_attacks?: number
}

export type BossEntry = {
  id: string
  name: string
  level: string
  rarity: string
  set: number
  encounterId: number
  isPrime: boolean
  bossType: string
  requiredTokens: number
  hp: number
}

export type PlayerEntry = {
  id: string
  name: string
  userId: string | null
  maxTokens: number
  preferences?: Record<string, 'preferred' | 'avoid' | 'neutral'>
  roster: string[]
  reliability: number
}

export type PerformanceSnapshot = {
  playerAvg: Map<string, Map<string, number>>
  bossAvg: Map<string, number>
  battlesByPlayer: Map<string, number>
}

export type MetaTeam = {
  composition: string
  damageP90: number
}

export type HeroRequirement = {
  hero_name: string
  min_rank_index: number | null
  min_ability_active: number | null
  min_ability_passive: number | null
}

export type PlaybookRequirement = {
  boss_id: string
  hero_requirements: HeroRequirement[]
  tier: 'guild' | 'cluster' | 'global'
}

export type GlobalThreshold = {
  rarity: string
  strength_level: string
  min_rank_index: number
  min_ability_active: number | null
  min_ability_passive: number | null
}

export type PlayerRosterStrength = {
  playerId: string
  heroStrengths: Map<
    string,
    {
      rank: number | null
      activeAbility: number | null
      passiveAbility: number | null
    }
  >
}

export function buildAssignmentScores({
  players,
  bosses,
  performance,
  metaTeams,
  bossTeamHeroes,
  rosterStrengthMap,
  playbookCache,
  globalThresholdCache,
  config,
  priorityMap,
  primeCounts
}: {
  players: PlayerEntry[]
  bosses: BossEntry[]
  performance: PerformanceSnapshot
  metaTeams: Map<string, MetaTeam>
  bossTeamHeroes: Map<string, string[]>
  rosterStrengthMap: Map<string, PlayerRosterStrength>
  playbookCache: Map<string, PlaybookRequirement | null>
  globalThresholdCache: Map<string, GlobalThreshold[]>
  config: AssignmentConfig
  priorityMap: Map<string, number>
  primeCounts: Map<string, number>
}): Record<string, Record<string, number>> {
  const scores: Record<string, Record<string, number>> = {}

  for (const player of players) {
    const rosterSet = new Set(player.roster.map((hero) => hero.toLowerCase()))
    scores[player.id] = {}
    const playerStrength = player.userId
      ? rosterStrengthMap.get(player.userId)
      : null

    for (const boss of bosses) {
      const bossKey = makeBossLookupKey(
        boss.name,
        boss.rarity,
        boss.set,
        boss.encounterId
      )
      const playerAvg = performance.playerAvg.get(player.name)?.get(bossKey)
      const bossAvg = performance.bossAvg.get(bossKey) ?? 0
      const metaDamage = metaTeams.get(bossKey)?.damageP90 ?? 0
      const fallbackDamage =
        boss.hp > 0 && boss.requiredTokens > 0
          ? boss.hp / boss.requiredTokens
          : 750000
      const heroes = bossTeamHeroes.get(bossKey)
      let damageP90: number
      let coverageScore = 100

      if (playerAvg !== undefined) {
        damageP90 = playerAvg
        if (heroes && rosterSet.size > 0) {
          coverageScore = calculateRosterCoverage(heroes, rosterSet).score
        }
      } else if (playerStrength && playerStrength.heroStrengths.size > 0) {
        const bossId = `${boss.name}_${boss.rarity}_${boss.set}_${boss.encounterId}`
        const playbook = playbookCache.get(bossId)
        const globalThresholds = globalThresholdCache.get(boss.rarity) ?? []

        if (playbook && playbook.hero_requirements.length > 0) {
          coverageScore = evaluateRosterStrengthScore(
            playerStrength.heroStrengths,
            playbook.hero_requirements
          )
        } else if (heroes?.length && globalThresholds.length > 0) {
          coverageScore = evaluateGlobalThresholdScore(
            playerStrength.heroStrengths,
            heroes,
            globalThresholds
          )
        } else if (heroes && rosterSet.size > 0) {
          coverageScore = calculateRosterCoverage(heroes, rosterSet).score
        }
        damageP90 =
          bossAvg > 0 ? bossAvg : metaDamage > 0 ? metaDamage : fallbackDamage
      } else {
        damageP90 =
          bossAvg > 0 ? bossAvg : metaDamage > 0 ? metaDamage : fallbackDamage
        if (heroes && rosterSet.size > 0) {
          coverageScore = calculateRosterCoverage(heroes, rosterSet).score
        }
      }

      const baseScore = calculateAssignmentScore({
        damageP90,
        coverageScore,
        preference: getPreferenceForBoss(
          player.preferences,
          boss.name,
          boss.isPrime
        ),
        reliability: player.reliability,
        weights: config.solver_weights
      })
      const priorityRank =
        priorityMap.get(boss.level) ?? config.priority_groups.length
      const priorityBoost = Math.max(
        0.9,
        1 + (config.priority_groups.length - priorityRank) * 0.05
      )
      const primePenalty =
        !boss.isPrime && (primeCounts.get(boss.level) ?? 0) < 2
          ? config.prime_penalty_multiplier
          : 1

      scores[player.id][boss.id] = Math.max(
        0,
        baseScore * priorityBoost * primePenalty
      )
    }
  }

  return scores
}

// Each level L1 → M5 is its own priority tier, so bosses fill in game order and the
// most bosses are fully covered per loop. Keep in sync with boss-helpers.ts.
export const DEFAULT_CONFIG: AssignmentConfig = {
  priority_groups: [
    ['L1'],
    ['L2'],
    ['L3'],
    ['L4'],
    ['L5'],
    ['M1'],
    ['M2'],
    ['M3'],
    ['M4'],
    ['M5']
  ],
  solver_weights: { damage: 1.0, preference: 0.5, reliability: 0.2 },
  excluded_bosses: [],
  max_tokens_per_player: 3,
  max_tokens_per_boss: 3,
  min_tokens_per_boss: 1,
  prime_penalty_multiplier: 0.85
}

export const normalizeBossKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '')

export const normalizeRarity = (value: unknown) => {
  const rarityRaw = String(value ?? '').trim()
  const rarityLower = rarityRaw.toLowerCase()
  if (rarityLower === 'mythic') return 'Mythic'
  if (rarityLower === 'legendary') return 'Legendary'
  return rarityRaw || 'Legendary'
}

export const coerceSelectedBosses = (
  selected: SolverRequest['selected_bosses']
): Array<Record<string, unknown>> => {
  if (!Array.isArray(selected)) return []

  return selected
    .map((boss) => {
      if (!boss) return null
      const bossName =
        typeof boss.boss_name === 'string' ? boss.boss_name.trim() : ''
      const bossType =
        typeof boss.boss_type === 'string' ? boss.boss_type.trim() : ''
      const rarity = normalizeRarity(boss.rarity)
      const setValue = Number(boss.set)
      const encounterValue = Number(boss.encounter_id)
      const resolvedName = bossName || bossType

      if (!resolvedName) return null

      return {
        boss_name: resolvedName,
        boss_type: bossType || resolvedName,
        rarity,
        set: Number.isFinite(setValue) ? Math.max(0, Math.trunc(setValue)) : 0,
        encounter_id: Number.isFinite(encounterValue)
          ? Math.max(0, Math.trunc(encounterValue))
          : 0
      }
    })
    .filter((boss): boss is NonNullable<typeof boss> => boss !== null)
}

export const normalizeWeights = (
  weights?: Partial<SolverWeights> | null
): SolverWeights => {
  const normalize = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  return {
    damage: normalize(weights?.damage, DEFAULT_CONFIG.solver_weights.damage),
    preference: normalize(
      weights?.preference,
      DEFAULT_CONFIG.solver_weights.preference
    ),
    reliability: normalize(
      weights?.reliability,
      DEFAULT_CONFIG.solver_weights.reliability
    )
  }
}

export const parsePriorityGroups = (value: unknown): string[][] => {
  if (Array.isArray(value)) {
    const groups = value
      .filter((group) => Array.isArray(group))
      .map(
        (group) =>
          (group as unknown[]).filter(
            (item) => typeof item === 'string'
          ) as string[]
      )
      .filter((group) => group.length > 0)

    if (groups.length > 0) return groups
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsePriorityGroups(parsed)
    } catch {
      return DEFAULT_CONFIG.priority_groups
    }
  }

  return DEFAULT_CONFIG.priority_groups
}

export const normalizeExcludedBosses = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return normalizeExcludedBosses(parsed)
    } catch {
      return []
    }
  }

  return []
}

export const mergeConfig = (
  base: Partial<AssignmentConfig> | null,
  overrides: Partial<AssignmentConfig> | null
): AssignmentConfig => {
  const priorityGroups = overrides?.priority_groups
    ? parsePriorityGroups(overrides.priority_groups)
    : parsePriorityGroups(base?.priority_groups)
  const excludedBosses =
    typeof overrides?.excluded_bosses !== 'undefined'
      ? normalizeExcludedBosses(overrides.excluded_bosses)
      : normalizeExcludedBosses(base?.excluded_bosses)

  return {
    priority_groups: priorityGroups,
    solver_weights: normalizeWeights(
      overrides?.solver_weights ?? base?.solver_weights
    ),
    excluded_bosses: excludedBosses,
    max_tokens_per_player: Math.max(
      1,
      Math.trunc(
        overrides?.max_tokens_per_player ??
          base?.max_tokens_per_player ??
          DEFAULT_CONFIG.max_tokens_per_player
      )
    ),
    max_tokens_per_boss: Math.max(
      1,
      Math.trunc(
        overrides?.max_tokens_per_boss ??
          base?.max_tokens_per_boss ??
          DEFAULT_CONFIG.max_tokens_per_boss
      )
    ),
    min_tokens_per_boss: Math.max(
      0,
      Math.trunc(
        overrides?.min_tokens_per_boss ??
          base?.min_tokens_per_boss ??
          DEFAULT_CONFIG.min_tokens_per_boss
      )
    ),
    prime_penalty_multiplier: Number.isFinite(
      overrides?.prime_penalty_multiplier
    )
      ? Math.max(
          0,
          Math.min(
            1,
            overrides?.prime_penalty_multiplier ??
              DEFAULT_CONFIG.prime_penalty_multiplier
          )
        )
      : Number.isFinite(base?.prime_penalty_multiplier)
        ? Math.max(
            0,
            Math.min(
              1,
              base?.prime_penalty_multiplier ??
                DEFAULT_CONFIG.prime_penalty_multiplier
            )
          )
        : DEFAULT_CONFIG.prime_penalty_multiplier
  }
}

export const parsePreferences = (
  value: unknown
): Record<string, 'preferred' | 'avoid' | 'neutral'> | undefined => {
  if (!value) return undefined
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<
        string,
        'preferred' | 'avoid' | 'neutral'
      >
      return parsed
    } catch {
      return undefined
    }
  }
  if (typeof value === 'object') {
    return value as Record<string, 'preferred' | 'avoid' | 'neutral'>
  }
  return undefined
}

export const getPreferenceForBoss = (
  preferences: Record<string, 'preferred' | 'avoid' | 'neutral'> | undefined,
  bossName: string,
  isPrime: boolean
): AssignmentScoreParams['preference'] => {
  if (!preferences) return 'neutral'
  const normalized = normalizeBossKey(bossName)
  const key = `${isPrime ? 'side' : 'main'}_${normalized}`
  return preferences[key] || preferences[normalized] || 'neutral'
}

export const makeBossLookupKey = (
  name: string,
  rarity: string,
  set: number,
  encounterId: number
) => `${normalizeBossKey(name)}|${rarity}|${set}|${encounterId}`

export const buildPriorityMap = (groups: string[][]): Map<string, number> => {
  const map = new Map<string, number>()
  groups.forEach((group, index) => {
    group.forEach((level) => map.set(level, index))
  })
  return map
}

export const buildBossEntries = (
  rawBosses: Array<Record<string, unknown>>
): BossEntry[] => {
  return rawBosses
    .map((boss) => {
      const rarity = normalizeRarity(boss.rarity)
      const setValue = Number(boss.set ?? boss.set_level ?? boss.setLevel ?? 0)
      const encounterValue = Number(
        boss.encounter_id ?? boss.encounterId ?? boss.encounter_index ?? 0
      )
      const bossName = String(
        boss.boss_name ?? boss.Name ?? boss.boss_type ?? ''
      ).trim()
      const bossType = String(
        boss.boss_type ?? boss.boss_name ?? boss.Name ?? bossName
      ).trim()

      if (!bossName) return null

      const levelPrefix = rarity === 'Mythic' ? 'M' : 'L'
      const level = `${levelPrefix}${Number.isFinite(setValue) ? setValue + 1 : 1}`
      const isPrime = encounterValue > 0
      const id = isPrime ? `${level}_Sub${encounterValue}` : level

      return {
        id,
        name: bossName,
        level,
        rarity,
        set: Number.isFinite(setValue) ? setValue : 0,
        encounterId: Number.isFinite(encounterValue) ? encounterValue : 0,
        isPrime,
        bossType,
        requiredTokens: 0,
        hp: 0
      }
    })
    .filter((boss): boss is BossEntry => Boolean(boss))
}

export const buildExcludedSet = (excluded: string[]) => {
  const raw = new Set<string>()
  const normalized = new Set<string>()
  excluded.forEach((entry) => {
    if (!entry) return
    raw.add(entry)
    normalized.add(normalizeBossKey(entry))
  })
  return { raw, normalized }
}

export const isBossExcluded = (
  boss: BossEntry,
  excluded: { raw: Set<string>; normalized: Set<string> }
) => {
  if (
    excluded.raw.has(boss.id) ||
    excluded.raw.has(boss.name) ||
    excluded.raw.has(boss.level)
  ) {
    return true
  }

  const normalizedName = normalizeBossKey(boss.name)
  if (excluded.normalized.has(normalizedName)) return true

  const rarityLabel = `${boss.name} ${boss.rarity}`
  const rarityLabelAlt = `${boss.name} - ${boss.rarity}`
  if (
    excluded.normalized.has(normalizeBossKey(rarityLabel)) ||
    excluded.normalized.has(normalizeBossKey(rarityLabelAlt))
  ) {
    return true
  }

  return false
}

export const evaluateRosterStrengthScore = (
  heroStrengths: Map<
    string,
    {
      rank: number | null
      activeAbility: number | null
      passiveAbility: number | null
    }
  >,
  requirements: HeroRequirement[]
): number => {
  if (requirements.length === 0) return 50

  let passing = 0
  for (const req of requirements) {
    const heroName = req.hero_name.toLowerCase()
    const heroData = heroStrengths.get(heroName)
    if (!heroData) continue

    let meetsReq = true
    if (
      req.min_rank_index != null &&
      (heroData.rank == null || heroData.rank < req.min_rank_index)
    ) {
      meetsReq = false
    }
    if (
      req.min_ability_active != null &&
      (heroData.activeAbility == null ||
        heroData.activeAbility < req.min_ability_active)
    ) {
      meetsReq = false
    }
    if (
      req.min_ability_passive != null &&
      (heroData.passiveAbility == null ||
        heroData.passiveAbility < req.min_ability_passive)
    ) {
      meetsReq = false
    }

    if (meetsReq) passing++
  }

  return Math.round((passing / requirements.length) * 100)
}

export const evaluateGlobalThresholdScore = (
  heroStrengths: Map<
    string,
    {
      rank: number | null
      activeAbility: number | null
      passiveAbility: number | null
    }
  >,
  requiredHeroes: string[],
  thresholds: GlobalThreshold[]
): number => {
  if (requiredHeroes.length === 0 || thresholds.length === 0) return 50

  const suitableThreshold = thresholds.find(
    (t) => t.strength_level === 'Suitable'
  )
  if (!suitableThreshold) return 50

  let passing = 0
  for (const heroName of requiredHeroes) {
    const heroData = heroStrengths.get(heroName.toLowerCase())
    if (!heroData) continue

    let meets = true
    if (
      heroData.rank == null ||
      heroData.rank < suitableThreshold.min_rank_index
    ) {
      meets = false
    }
    if (
      suitableThreshold.min_ability_active != null &&
      (heroData.activeAbility == null ||
        heroData.activeAbility < suitableThreshold.min_ability_active)
    ) {
      meets = false
    }
    if (
      suitableThreshold.min_ability_passive != null &&
      (heroData.passiveAbility == null ||
        heroData.passiveAbility < suitableThreshold.min_ability_passive)
    ) {
      meets = false
    }

    if (meets) passing++
  }

  return Math.round((passing / requiredHeroes.length) * 100)
}

export const RANK_NAME_TO_INDEX: Record<string, number> = {
  'Stone I': 0,
  'Stone II': 1,
  'Stone III': 2,
  'Iron I': 3,
  'Iron II': 4,
  'Iron III': 5,
  'Bronze I': 6,
  'Bronze II': 7,
  'Bronze III': 8,
  'Silver I': 9,
  'Silver II': 10,
  'Silver III': 11,
  'Gold I': 12,
  'Gold II': 13,
  'Gold III': 14,
  'Diamond I': 15,
  'Diamond II': 16,
  'Diamond III': 17,
  'Adamantium I': 18,
  'Adamantium II': 19,
  'Adamantium III': 20,
  'Mythic I': 21,
  'Mythic II': 22,
  'Mythic III': 23
}

export const rankNameToIndex = (rankName: unknown): number | null => {
  if (typeof rankName !== 'string') return null
  return RANK_NAME_TO_INDEX[rankName] ?? null
}

export const buildReliability = (battleCount: number) => {
  if (!Number.isFinite(battleCount)) return 70
  const scaled = 50 + Math.min(50, battleCount * 2)
  return Math.max(40, Math.min(100, Math.round(scaled)))
}

export const resolvePlayerTokenLimit = (
  limits: Record<string, number> | undefined,
  playerId: string,
  fallback: number
) => {
  if (!limits) return fallback
  const raw = limits[playerId]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(0, Math.min(fallback, Math.trunc(raw)))
}

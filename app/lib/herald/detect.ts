import 'server-only'
import { prettyBossName } from '@/app/lib/loki/season-configs'
import {
  buildBossId,
  parseEncounterIndexFromBossId
} from '@/app/lib/resolvers/boss-identity'
import {
  type BombCalculationMode,
  DEFAULT_BOMB_CALCULATION_MODE,
  bombDamageRangeForGuildLevel,
  bombScenariosForHp,
  bombsNeededForKill
} from '@/app/lib/tacticus/bomb-damage'
import {
  DEFAULT_RARITY_FILTER,
  DEFAULT_RECENCY_WINDOW_MS,
  COMBINE_PRIME_WINDOW_MS,
  type HeraldBattle,
  type DefeatTransition,
  type AvailabilityTransition,
  type BombRangeTransition
} from './contracts'

export interface DetectOptions {
  rarityFilter?: string[]
  recencyWindowMs?: number
  nowMs?: number
  // Missing or 0 means defeat fires on actual HP=0.
  killThresholdMap?: Map<string, number>
}

export const normalizeCompletedOn = (value: number): number =>
  value < 1e12 ? value * 1000 : value

const toInt = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}

// Battle `set` is zero-based; convert so set=4 never inherits an L4 threshold.
const seasonLevelForBattle = (rarity: string, setIndex: number): string =>
  `${rarity.toLowerCase().startsWith('m') ? 'M' : 'L'}${setIndex + 1}`

export const detectDefeatTransitions = (
  battles: HeraldBattle[],
  options: DetectOptions = {}
): DefeatTransition[] => {
  const rarityFilter = options.rarityFilter ?? DEFAULT_RARITY_FILTER
  const rarityAllowed = new Set(rarityFilter.map((r) => r.toLowerCase()))
  const recencyWindowMs = options.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
  const nowMs = options.nowMs ?? Date.now()
  const killThresholdMap = options.killThresholdMap ?? new Map<string, number>()

  const byKey = new Map<string, DefeatTransition>()
  const earlyDefeatBuckets = new Set<string>()

  const sorted = [...battles].sort((a, b) => {
    const ta = typeof a.completedOn === 'number' ? a.completedOn : 0
    const tb = typeof b.completedOn === 'number' ? b.completedOn : 0
    return ta - tb
  })

  for (const battle of sorted) {
    if (!battle.type) continue
    if (typeof battle.completedOn !== 'number') continue
    if (typeof battle.remainingHp !== 'number') continue

    const rarity = battle.rarity ?? ''
    if (!rarityAllowed.has(rarity.toLowerCase())) continue

    const completedOnMs = normalizeCompletedOn(battle.completedOn)
    if (nowMs - completedOnMs > recencyWindowMs) continue
    if (completedOnMs > nowMs + 60_000) continue

    const encounterIndex = toInt(battle.encounterIndex)
    const bossType = battle.type
    const bossId = buildBossId(bossType, encounterIndex)
    const season = toInt(battle.Season)
    const loopIndex = toInt(battle.loopIndex) ?? 0
    const setNum = toInt(battle.set)

    // Fire once below maxHp * pct, then suppress HP=0.
    if ((encounterIndex === 1 || encounterIndex === 2) && setNum !== null) {
      const level = seasonLevelForBattle(rarity, setNum)
      const pct =
        season !== null
          ? (killThresholdMap.get(`${season}|${level}|${encounterIndex}`) ?? 0)
          : 0
      const bucketKey = `${bossId}|${season ?? 'null'}|${loopIndex}`

      if (pct > 0) {
        if (earlyDefeatBuckets.has(bucketKey)) continue
        const maxHp = typeof battle.maxHp === 'number' ? battle.maxHp : null
        if (maxHp === null || maxHp <= 0) continue
        const thresholdHp = maxHp * (pct / 100)
        if (battle.remainingHp > thresholdHp) continue
        const key = `${bossId}:${completedOnMs}`
        if (byKey.has(key)) continue
        byKey.set(key, {
          boss_id: bossId,
          boss_type: bossType,
          boss_display_name: prettyBossName(bossType),
          rarity,
          tier: toInt(battle.tier),
          set: setNum,
          completed_on: completedOnMs,
          killer_display_name: battle.displayName ?? null,
          killer_user_id: battle.userId ?? null,
          season,
          loop_index: loopIndex
        })
        earlyDefeatBuckets.add(bucketKey)
        continue
      }
    }

    if (battle.remainingHp !== 0) continue

    const key = `${bossId}:${completedOnMs}`
    if (byKey.has(key)) continue

    byKey.set(key, {
      boss_id: bossId,
      boss_type: bossType,
      boss_display_name: prettyBossName(bossType),
      rarity,
      tier: toInt(battle.tier),
      set: setNum,
      completed_on: completedOnMs,
      killer_display_name: battle.displayName ?? null,
      killer_user_id: battle.userId ?? null,
      season,
      loop_index: loopIndex
    })
  }

  return Array.from(byKey.values()).sort(
    (a, b) => a.completed_on - b.completed_on
  )
}

export const deriveDeadPrimeCandidates = (
  battles: HeraldBattle[]
): DefeatTransition[] => {
  const seen = new Set<string>()
  const results: DefeatTransition[] = []
  for (const b of battles) {
    if (!b.type) continue
    if (typeof b.remainingHp !== 'number' || b.remainingHp !== 0) continue
    const enc = toInt(b.encounterIndex)
    if (enc !== 1 && enc !== 2) continue
    const setNum = toInt(b.set)
    if (setNum === null) continue
    const rarity = b.rarity ?? ''
    const season = toInt(b.Season)
    const loopIndex = toInt(b.loopIndex) ?? 0
    const key = `${b.type}|${enc}|${season}|${setNum}|${loopIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      boss_id: buildBossId(b.type, enc),
      boss_type: b.type,
      boss_display_name: prettyBossName(b.type),
      rarity,
      tier: toInt(b.tier),
      set: setNum,
      completed_on:
        typeof b.completedOn === 'number'
          ? normalizeCompletedOn(b.completedOn)
          : 0,
      killer_display_name: null,
      killer_user_id: null,
      season,
      loop_index: loopIndex
    })
  }
  return results
}

// `consumed` holds the partner so callers can pre-claim its dedup row.
type CombinePrimeDecision =
  boolean | ((transition: DefeatTransition) => boolean)

const shouldCombinePrimeTransition = (
  decision: CombinePrimeDecision,
  transition: DefeatTransition
): boolean => (typeof decision === 'function' ? decision(transition) : decision)

export const collapseCombinedPrimeDefeats = (
  transitions: DefeatTransition[],
  combineDecision: CombinePrimeDecision
): { dispatched: DefeatTransition[]; consumed: DefeatTransition[] } => {
  if (transitions.length < 2) {
    return { dispatched: transitions, consumed: [] }
  }
  const dispatched: DefeatTransition[] = []
  const consumed: DefeatTransition[] = []
  const used = new Set<number>()

  for (let i = 0; i < transitions.length; i += 1) {
    if (used.has(i)) continue
    const a = transitions[i]
    if (!a) continue
    const aEnc = parseEncounterIndexFromBossId(a.boss_id)
    if (aEnc !== 1 && aEnc !== 2) {
      dispatched.push(a)
      used.add(i)
      continue
    }
    if (!shouldCombinePrimeTransition(combineDecision, a)) {
      dispatched.push(a)
      used.add(i)
      continue
    }

    let partnerIdx = -1
    for (let j = i + 1; j < transitions.length; j += 1) {
      if (used.has(j)) continue
      const b = transitions[j]
      if (!b) continue
      const bEnc = parseEncounterIndexFromBossId(b.boss_id)
      if (bEnc !== 1 && bEnc !== 2) continue
      if (!shouldCombinePrimeTransition(combineDecision, b)) continue
      if (aEnc === bEnc) continue
      if (a.boss_type !== b.boss_type) continue
      if (a.rarity !== b.rarity) continue
      if (a.set !== b.set) continue
      if (a.season !== b.season) continue
      if (a.loop_index !== b.loop_index) continue
      if (Math.abs(a.completed_on - b.completed_on) > COMBINE_PRIME_WINDOW_MS) {
        continue
      }
      partnerIdx = j
      break
    }

    if (partnerIdx < 0) {
      dispatched.push(a)
      used.add(i)
      continue
    }

    const b = transitions[partnerIdx]
    if (!b) {
      dispatched.push(a)
      used.add(i)
      continue
    }
    const first = a.completed_on <= b.completed_on ? a : b
    const second = a.completed_on <= b.completed_on ? b : a
    const combined: DefeatTransition = {
      ...first,
      boss_display_name: `${first.boss_display_name} & ${second.boss_display_name}`
    }
    dispatched.push(combined)
    consumed.push(second)
    used.add(i)
    used.add(partnerIdx)
  }

  return { dispatched, consumed }
}

export const collapseCombinedPrimeAvailabilities = (
  transitions: AvailabilityTransition[],
  combineDecision: (transition: AvailabilityTransition) => boolean
): {
  dispatched: AvailabilityTransition[]
  consumed: AvailabilityTransition[]
  partnerByDispatchedBossId: Map<string, AvailabilityTransition>
} => {
  if (transitions.length < 2) {
    return {
      dispatched: transitions,
      consumed: [],
      partnerByDispatchedBossId: new Map()
    }
  }
  const dispatched: AvailabilityTransition[] = []
  const consumed: AvailabilityTransition[] = []
  const partnerByDispatchedBossId = new Map<string, AvailabilityTransition>()
  const used = new Set<number>()

  for (let i = 0; i < transitions.length; i += 1) {
    if (used.has(i)) continue
    const a = transitions[i]
    if (!a) continue
    if (a.encounter_index !== 1 && a.encounter_index !== 2) {
      dispatched.push(a)
      used.add(i)
      continue
    }
    if (!combineDecision(a)) {
      dispatched.push(a)
      used.add(i)
      continue
    }

    let partnerIdx = -1
    for (let j = i + 1; j < transitions.length; j += 1) {
      if (used.has(j)) continue
      const b = transitions[j]
      if (!b) continue
      if (b.encounter_index !== 1 && b.encounter_index !== 2) continue
      if (!combineDecision(b)) continue
      if (a.encounter_index === b.encounter_index) continue
      if (a.boss_type !== b.boss_type) continue
      if (a.rarity !== b.rarity) continue
      if (a.set !== b.set) continue
      if (a.season !== b.season) continue
      if (a.loop_index !== b.loop_index) continue
      partnerIdx = j
      break
    }

    if (partnerIdx < 0) {
      dispatched.push(a)
      used.add(i)
      continue
    }

    const b = transitions[partnerIdx]
    if (!b) {
      dispatched.push(a)
      used.add(i)
      continue
    }
    const first = a.encounter_index <= b.encounter_index ? a : b
    const second = a.encounter_index <= b.encounter_index ? b : a
    const combined: AvailabilityTransition = {
      ...first,
      boss_display_name: `${first.boss_display_name} & ${second.boss_display_name}`
    }
    dispatched.push(combined)
    consumed.push(second)
    partnerByDispatchedBossId.set(combined.boss_id, second)
    used.add(i)
    used.add(partnerIdx)
  }

  return { dispatched, consumed, partnerByDispatchedBossId }
}

export interface BombRangeDetectOptions extends DetectOptions {
  bombsAvailable: number
  overkillThreshold: number
  guildLevel?: number | null
  calculationMode?: BombCalculationMode
  // killThresholdMap marks primes at/below threshold as under_kill_threshold.
}

export const detectBombRangeTransitions = (
  battles: HeraldBattle[],
  options: BombRangeDetectOptions
): BombRangeTransition[] => {
  if (options.bombsAvailable <= 0) return []
  if (options.overkillThreshold <= 0) return []
  if (battles.length === 0) return []

  const guildLevel = options.guildLevel ?? null
  const mode = options.calculationMode ?? DEFAULT_BOMB_CALCULATION_MODE
  const damageRange = bombDamageRangeForGuildLevel(guildLevel)

  const rarityFilter = options.rarityFilter ?? DEFAULT_RARITY_FILTER
  const rarityAllowed = new Set(rarityFilter.map((r) => r.toLowerCase()))
  // Floor, so a fractional one-bomb threshold does not alert.
  const usableBombs = Math.floor(
    options.bombsAvailable * options.overkillThreshold
  )
  if (usableBombs <= 0) return []

  interface EncounterSnapshot {
    boss_type: string
    encounter_index: number
    season: number
    loop_index: number
    rarity: string
    set: number | null
    tier: number | null
    remaining_hp: number
    max_hp: number | null
    completed_on: number
  }
  const latestByKey = new Map<string, EncounterSnapshot>()

  for (const battle of battles) {
    if (typeof battle.remainingHp !== 'number') continue
    if (battle.remainingHp <= 0) continue
    if (typeof battle.completedOn !== 'number') continue
    const rarity = battle.rarity ?? ''
    if (!rarityAllowed.has(rarity.toLowerCase())) continue
    const bossType = battle.type
    if (!bossType) continue
    const encounterIndex = toInt(battle.encounterIndex)
    if (encounterIndex === null) continue
    const season = toInt(battle.Season)
    if (season === null) continue
    const loopIndex = toInt(battle.loopIndex) ?? 0

    const completedOnMs = normalizeCompletedOn(battle.completedOn)
    const bossId = buildBossId(bossType, encounterIndex)
    const key = `${bossId}|${season}|${loopIndex}`

    const existing = latestByKey.get(key)
    if (existing && existing.completed_on >= completedOnMs) continue

    latestByKey.set(key, {
      boss_type: bossType,
      encounter_index: encounterIndex,
      season,
      loop_index: loopIndex,
      rarity,
      set: toInt(battle.set),
      tier: toInt(battle.tier),
      remaining_hp: battle.remainingHp,
      max_hp: typeof battle.maxHp === 'number' ? battle.maxHp : null,
      completed_on: completedOnMs
    })
  }

  const killThresholdMap = options.killThresholdMap ?? new Map<string, number>()

  const out: BombRangeTransition[] = []
  for (const [, snap] of latestByKey) {
    const bombsNeeded = bombsNeededForKill(snap.remaining_hp, guildLevel, mode)
    if (bombsNeeded <= 0) continue
    if (bombsNeeded > usableBombs) continue
    const bossId = buildBossId(snap.boss_type, snap.encounter_index)
    const scenarios = bombScenariosForHp(snap.remaining_hp, guildLevel)

    // A prime at/below its threshold counts as dead, so no call-to-bomb.
    let killThresholdPct: number | null = null
    let underKillThreshold = false
    if (
      (snap.encounter_index === 1 || snap.encounter_index === 2) &&
      snap.set !== null
    ) {
      const level = seasonLevelForBattle(snap.rarity, snap.set)
      const pct =
        killThresholdMap.get(
          `${snap.season}|${level}|${snap.encounter_index}`
        ) ?? 0
      if (pct > 0) {
        killThresholdPct = pct
        if (snap.max_hp !== null && snap.max_hp > 0) {
          underKillThreshold = snap.remaining_hp <= snap.max_hp * (pct / 100)
        }
      }
    }

    out.push({
      boss_id: bossId,
      boss_type: snap.boss_type,
      boss_display_name: prettyBossName(snap.boss_type),
      rarity: snap.rarity,
      tier: snap.tier,
      set: snap.set,
      encounter_index: snap.encounter_index,
      season: snap.season,
      loop_index: snap.loop_index,
      remaining_hp: snap.remaining_hp,
      bombs_available: options.bombsAvailable,
      bombs_needed: bombsNeeded,
      overkill_threshold: options.overkillThreshold,
      under_kill_threshold: underKillThreshold,
      kill_threshold_pct: killThresholdPct,
      guild_level: guildLevel,
      mode,
      damage_per_bomb: scenarios[mode].damage_per_bomb,
      damage_range: damageRange,
      scenarios,
      observed_at: snap.completed_on
    })
  }

  return out.sort((a, b) => a.observed_at - b.observed_at)
}

export interface AvailabilityDetectOptions {
  rarityFilter?: string[]
}

/** The caller persists them after posting. */
export const detectAvailabilityTransitions = (
  battles: HeraldBattle[],
  alreadySeen: Set<string>,
  options: AvailabilityDetectOptions = {}
): AvailabilityTransition[] => {
  const rarityFilter = options.rarityFilter ?? DEFAULT_RARITY_FILTER
  const rarityAllowed = new Set(rarityFilter.map((r) => r.toLowerCase()))

  // Emit both primes so one already-seen prime cannot suppress its sibling.
  interface StageActivity {
    bossType: string
    season: number
    set: number | null
    rarity: string
    loopIndex: number
    tier: number | null
  }
  const stages = new Map<string, StageActivity>()

  for (const battle of battles) {
    if (!battle.type) continue
    const season = toInt(battle.Season)
    if (season === null) continue
    const rarity = battle.rarity ?? ''
    if (!rarityAllowed.has(rarity.toLowerCase())) continue
    const encounterIndex = toInt(battle.encounterIndex)
    if (encounterIndex === null) continue
    if (encounterIndex !== 1 && encounterIndex !== 2) continue
    const bossType = battle.type
    const set = toInt(battle.set)
    const loopIndex = toInt(battle.loopIndex) ?? 0
    const stageKey = `${bossType}|${season}|${set ?? 'null'}|${rarity}|${loopIndex}`
    if (stages.has(stageKey)) continue
    stages.set(stageKey, {
      bossType,
      season,
      set,
      rarity,
      loopIndex,
      tier: toInt(battle.tier)
    })
  }

  // Must match loadAvailabilitySnapshot's 5-part key (the unique index).
  const transitions: AvailabilityTransition[] = []
  const emitted = new Set<string>()
  for (const stage of stages.values()) {
    for (const enc of [1, 2] as const) {
      const bossId = buildBossId(stage.bossType, enc)
      const snapshotKey = `${stage.season}|${bossId}|${stage.loopIndex}|${stage.rarity}|${stage.set ?? 'null'}`
      if (alreadySeen.has(snapshotKey)) continue
      if (emitted.has(snapshotKey)) continue
      emitted.add(snapshotKey)
      transitions.push({
        boss_id: bossId,
        boss_type: stage.bossType,
        boss_display_name: prettyBossName(stage.bossType),
        rarity: stage.rarity,
        tier: stage.tier,
        set: stage.set,
        encounter_index: enc,
        season: stage.season,
        loop_index: stage.loopIndex
      })
    }
  }

  return transitions
}

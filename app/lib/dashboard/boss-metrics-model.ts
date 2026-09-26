import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import type { Database } from '@tacticus/app-core/types'

import { formatHp } from './home-summary-utils'
import type {
  BossCombatMetrics,
  LandingPageBossOverview
} from './home-summary-types'
import {
  parseTimestampSafe,
  readNumericProp,
  readStringProp,
  toNonNegativeNumberOrNull,
  toNullableNumber,
  toNumber,
  toPositiveNumberOrNull
} from './_internal/coercion'

const DISPLAY_SET_OFFSET = 1
const RECENT_ACTIVITY_GRACE_MS = 15 * 60 * 1000

export const DEFAULT_BOSS: LandingPageBossOverview = {
  name: 'Current Boss (L1)',
  displayName: 'L1 Current Boss',
  rarity: 'Legendary',
  levelCode: 'L1',
  loop: 1,
  maxHp: 1_200_000_000,
  remainingHp: 180_000_000,
  hpPercentage: 85,
  formattedMaxHp: '1.2B',
  formattedRemainingHp: '180M',
  encounterId: 0
}

type EotGrRow = Database['public']['Tables']['EOT_GR_data']['Row']

export type BossBattleRecord = Partial<
  Pick<
    EotGrRow,
    | 'damageDealt'
    | 'damageType'
    | 'loopIndex'
    | 'set'
    | 'startedOn'
    | 'completedOn'
    | 'timestamp'
    | 'remainingHp'
    | 'maxHp'
  >
>

export type BossTimeRecord = BossBattleRecord &
  Partial<Pick<EotGrRow, 'Name' | 'rarity' | 'encounterId'>>

interface BossLoopSummary {
  set: number
  loopIndex: number
  sequence: number
  displayLoop: number
  tokens: number
  firstStart: number | null
  lastEnd: number | null
  defeated: boolean
  totalDamage: number
}

export const buildBossOverview = (
  snapshotBoss?: Record<string, unknown> | null,
  fallback?: Record<string, unknown> | null
): LandingPageBossOverview => {
  const source = snapshotBoss ?? fallback
  if (!source) return DEFAULT_BOSS

  const rarityRaw = (source.rarity ?? source.tier) as
    string | number | undefined
  let derivedRarity: 'Legendary' | 'Mythic' = 'Legendary'
  if (rarityRaw === 'Mythic' || rarityRaw === 'Legendary') {
    derivedRarity = rarityRaw
  } else if (typeof rarityRaw === 'number') {
    derivedRarity = rarityRaw >= 5 ? 'Mythic' : 'Legendary'
  }

  const rawSet =
    toNonNegativeNumberOrNull(readNumericProp(source, ['set', 'Set'])) ?? 0
  const displaySet = Math.trunc(rawSet) + DISPLAY_SET_OFFSET
  const tierLabel = readStringProp(source, ['tier_label'])
  const loopRaw = readNumericProp(source, ['loop'])
  const loop = loopRaw !== null ? Math.trunc(loopRaw) : null
  const normalizedRarity = normalizeRarity(derivedRarity)
  const prefix = normalizedRarity ? getRarityPrefix(normalizedRarity) : 'L'
  const name =
    readStringProp(source, ['boss_name', 'Name', 'name']) ?? DEFAULT_BOSS.name
  const maxHp =
    toPositiveNumberOrNull(readNumericProp(source, ['max_hp', 'maxHp'])) ??
    DEFAULT_BOSS.maxHp
  const remainingHp =
    toNonNegativeNumberOrNull(
      readNumericProp(source, ['hp_remaining', 'remainingHp'])
    ) ?? DEFAULT_BOSS.remainingHp
  const hpPercentageRaw = readNumericProp(source, ['hp_percentage'])
  const hpPercentage =
    hpPercentageRaw !== null && Number.isFinite(hpPercentageRaw)
      ? Math.max(0, Math.min(100, Math.round(hpPercentageRaw)))
      : maxHp > 0
        ? Math.max(0, Math.min(100, Math.round((remainingHp / maxHp) * 100)))
        : DEFAULT_BOSS.hpPercentage
  const levelCode = tierLabel ?? `${prefix}${displaySet}`
  const encounterRaw = readNumericProp(source, [
    'encounterId',
    'encounter_id',
    'EncounterId'
  ])
  const encounterId =
    encounterRaw !== null && Number.isFinite(encounterRaw)
      ? Math.trunc(encounterRaw)
      : 0

  return {
    name,
    displayName: `${levelCode} ${name}`.trim(),
    rarity: derivedRarity,
    levelCode,
    loop: loop ?? null,
    maxHp,
    remainingHp,
    hpPercentage,
    formattedMaxHp: formatHp(maxHp),
    formattedRemainingHp: formatHp(remainingHp),
    encounterId
  }
}

const buildLoopSummaries = (records: BossBattleRecord[]): BossLoopSummary[] => {
  if (records.length === 0) return []
  const buckets = new Map<
    string,
    { set: number; loopIndex: number; records: BossBattleRecord[] }
  >()
  for (const record of records) {
    const parsedLoop =
      typeof record.loopIndex === 'number'
        ? record.loopIndex
        : typeof record.loopIndex === 'string'
          ? Number.parseInt(record.loopIndex, 10)
          : null
    const loopIndex =
      parsedLoop !== null && Number.isFinite(parsedLoop)
        ? Math.trunc(parsedLoop)
        : 0
    const setCandidate = toNonNegativeNumberOrNull(record.set ?? null)
    const set = setCandidate !== null ? Math.trunc(setCandidate) : 0
    const key = `${set}|${loopIndex}`
    const bucket = buckets.get(key)
    if (bucket) bucket.records.push(record)
    else buckets.set(key, { set, loopIndex, records: [record] })
  }

  const entries = [...buckets.values()].sort(
    (a, b) => a.loopIndex - b.loopIndex || a.set - b.set
  )
  const loopsBySet = new Map<number, number[]>()
  for (const entry of entries) {
    loopsBySet.set(entry.set, [
      ...(loopsBySet.get(entry.set) ?? []),
      entry.loopIndex
    ])
  }
  const normalizationBySet = new Map<
    number,
    { hasZeroBased: boolean; isSkipping: boolean }
  >()
  for (const [set, loops] of loopsBySet) {
    const sorted = loops.filter(Number.isFinite).sort((a, b) => a - b)
    normalizationBySet.set(set, {
      hasZeroBased: sorted.includes(0),
      // Some API tier values step by 2.
      isSkipping:
        sorted.length >= 2 &&
        sorted.every(
          (loop, index) => index === 0 || loop === sorted[index - 1]! + 2
        )
    })
  }

  return entries.map((entry, sequence) => {
    const sorted = [...entry.records].sort(
      (a, b) => timestampForSort(a) - timestampForSort(b)
    )
    const starts = sorted
      .map(
        (row) =>
          parseTimestampSafe(row.startedOn) ??
          parseTimestampSafe(row.timestamp) ??
          parseTimestampSafe(row.completedOn)
      )
      .filter((value): value is number => value !== null)
    const ends = sorted
      .map(
        (row) =>
          parseTimestampSafe(row.completedOn) ??
          parseTimestampSafe(row.timestamp) ??
          parseTimestampSafe(row.startedOn)
      )
      .filter((value): value is number => value !== null)
    const totalDamage = sorted.reduce(
      (sum, row) => sum + toNumber(row.damageDealt),
      0
    )
    const finalRemaining = toNullableNumber(sorted.at(-1)?.remainingHp ?? null)
    // Includes 0: maxHp=0 rows must classify as defeated, or they become phantom current loops.
    const maxHp = toNullableNumber(
      sorted.find((row) => typeof row.maxHp === 'number')?.maxHp ?? null
    )
    const normalization = normalizationBySet.get(entry.set) ?? {
      hasZeroBased: false,
      isSkipping: false
    }
    const displayLoop = normalization.isSkipping
      ? Math.floor(entry.loopIndex / 2) + 1
      : normalization.hasZeroBased
        ? entry.loopIndex + 1
        : Math.max(entry.loopIndex, 0)
    return {
      set: entry.set,
      loopIndex: entry.loopIndex,
      sequence,
      displayLoop,
      tokens: sorted.length,
      firstStart: starts.length > 0 ? Math.min(...starts) : null,
      lastEnd: ends.length > 0 ? Math.max(...ends) : null,
      defeated:
        finalRemaining !== null
          ? finalRemaining <= 0
          : maxHp !== null
            ? totalDamage >= maxHp
            : false,
      totalDamage
    }
  })
}

const timestampForSort = (row: BossBattleRecord): number =>
  parseTimestampSafe(row.completedOn) ??
  parseTimestampSafe(row.timestamp) ??
  parseTimestampSafe(row.startedOn) ??
  0

export const calculateBossCombatMetrics = (
  records: BossBattleRecord[],
  now = Date.now()
): BossCombatMetrics | null => {
  if (records.length === 0) return null
  const loops = buildLoopSummaries(records)
  const current = loops.at(-1)
  if (!current) return null
  const completed = loops.filter((loop) => loop.defeated)
  const averageTokens =
    completed.length > 0
      ? completed.reduce((sum, loop) => sum + loop.tokens, 0) / completed.length
      : null
  const totalDamage = records.reduce(
    (sum, row) => sum + toNumber(row.damageDealt),
    0
  )
  let currentElapsedMs: number | null = null
  if (current.firstStart !== null) {
    if (current.defeated && current.lastEnd !== null) {
      currentElapsedMs = Math.max(0, current.lastEnd - current.firstStart)
    } else if (current.lastEnd !== null) {
      const end =
        now - current.lastEnd <= RECENT_ACTIVITY_GRACE_MS
          ? now
          : current.lastEnd
      currentElapsedMs = Math.max(0, end - current.firstStart)
    } else {
      currentElapsedMs = Math.max(0, now - current.firstStart)
    }
  }
  const previous = completed
    .filter((loop) => loop.sequence < current.sequence)
    .at(-1)
  const previousDuration =
    previous?.firstStart != null && previous.lastEnd != null
      ? Math.max(0, previous.lastEnd - previous.firstStart)
      : null
  return {
    currentLoopIndex: Math.max(0, Math.trunc(current.displayLoop) - 1),
    currentBattleCount: current.tokens,
    currentElapsedMs,
    previousLoopDurationMs: previousDuration,
    previousLoopTokens: previous?.tokens ?? null,
    averageTokensToKill:
      averageTokens !== null ? Number(averageTokens.toFixed(1)) : null,
    averageDamagePerHit:
      records.length > 0 && Number.isFinite(totalDamage / records.length)
        ? totalDamage / records.length
        : null,
    playerAverageDamagePerHit: null
  }
}

export const calculateAverageDamagePerHour = (
  records: BossTimeRecord[]
): number | null => {
  const bossGroups = new Map<string, BossTimeRecord[]>()
  for (const record of records) {
    const parsedSet =
      typeof record.set === 'number'
        ? record.set
        : typeof record.set === 'string'
          ? Number.parseInt(record.set, 10)
          : 0
    const set = Number.isFinite(parsedSet) ? parsedSet : 0
    const key = `${record.Name ?? 'Unknown Boss'}_${record.rarity ?? 'Legendary'}_${set}_${record.encounterId ?? 0}`
    bossGroups.set(key, [...(bossGroups.get(key) ?? []), record])
  }

  const rates: number[] = []
  for (const battles of bossGroups.values()) {
    const loops = new Map<number, BossTimeRecord[]>()
    for (const battle of battles) {
      const parsed =
        typeof battle.loopIndex === 'number'
          ? battle.loopIndex
          : typeof battle.loopIndex === 'string'
            ? Number.parseInt(battle.loopIndex, 10)
            : 0
      const loop = Number.isFinite(parsed) ? parsed : 0
      loops.set(loop, [...(loops.get(loop) ?? []), battle])
    }
    for (const loopBattles of loops.values()) {
      loopBattles.sort((a, b) => timestampForSort(a) - timestampForSort(b))
      const damage = loopBattles.reduce(
        (sum, row) => sum + toNumber(row.damageDealt ?? 0),
        0
      )
      const starts = loopBattles
        .map(
          (row) =>
            parseTimestampSafe(row.startedOn) ??
            parseTimestampSafe(row.timestamp) ??
            parseTimestampSafe(row.completedOn)
        )
        .filter((value): value is number => value !== null)
      const ends = loopBattles
        .map(
          (row) =>
            parseTimestampSafe(row.completedOn) ??
            parseTimestampSafe(row.timestamp) ??
            parseTimestampSafe(row.startedOn)
        )
        .filter((value): value is number => value !== null)
      const first = starts.length > 0 ? Math.min(...starts) : null
      const last = ends.length > 0 ? Math.max(...ends) : null
      const durationMinutes =
        first !== null && last !== null && last > first
          ? (last - first) / 60_000
          : null
      const remaining = toNullableNumber(
        loopBattles.at(-1)?.remainingHp ?? null
      )
      const maxHp = toPositiveNumberOrNull(
        loopBattles.find((row) => row.maxHp != null)?.maxHp ?? null
      )
      const defeated =
        (remaining !== null && remaining <= 0) ||
        (maxHp !== null && damage >= maxHp)
      if (defeated && durationMinutes !== null && durationMinutes > 0) {
        rates.push((damage * 60) / durationMinutes)
      }
    }
  }
  return rates.length > 0
    ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length)
    : null
}

import { normalizeBossKey } from '@/app/lib/utils/bossNames'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'

export interface DamageRecord {
  playerId: string
  bossName: string
  encounterId: number
  rarity: string | null
  set: number | null
  startedOn: string
  damageDealt: number
}

export type DamageTargetKey = string

export interface DamageEstimate {
  // Never default null: a synthesized value leaks into the guild mean and solver capacity.
  expectedDamage: number | null
  sampleCount: number
  confidence: 'high' | 'medium' | 'low'
  source: 'player_target' | 'player_overall' | 'guild_target' | 'no_signal'
}

export interface DamageModelOptions {
  referenceAt: string
  halfLifeDays: number
  minHighConfidenceSamples: number
  minMediumConfidenceSamples: number
}

export interface DamageModel {
  options: DamageModelOptions
  byPlayerTarget: Map<
    string,
    Map<DamageTargetKey, { expectedDamage: number; sampleCount: number }>
  >
  byPlayerOverall: Map<string, { expectedDamage: number; sampleCount: number }>
  byGuildTarget: Map<
    DamageTargetKey,
    { expectedDamage: number; sampleCount: number }
  >
}

const MS_PER_DAY = 86_400_000

const toNonNegative = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, value)
}

const parseTimestamp = (value: string): number | null => {
  const date = new Date(value)
  const ms = date.getTime()
  return Number.isFinite(ms) ? ms : null
}

const normalizeEncounterBossKey = (bossName: string): string => {
  const normalized = normalizeBossKey(bossName)
  return normalized || bossName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

export function makeDamageTargetKey(args: {
  bossName: string
  stageCode: string
  encounterId: number
}): DamageTargetKey {
  const bossKey = normalizeEncounterBossKey(args.bossName)
  return `${bossKey}|${args.stageCode}|${Math.trunc(args.encounterId)}`
}

const recencyWeight = (ageDays: number, halfLifeDays: number): number => {
  if (halfLifeDays <= 0) return 1
  return Math.pow(0.5, ageDays / halfLifeDays)
}

const weightedAverage = (
  samples: Array<{ damage: number; atMs: number }>,
  referenceMs: number,
  halfLifeDays: number
) => {
  let weightedSum = 0
  let weightSum = 0

  for (const sample of samples) {
    const ageDays = Math.max(0, (referenceMs - sample.atMs) / MS_PER_DAY)
    const weight = recencyWeight(ageDays, halfLifeDays)
    weightedSum += sample.damage * weight
    weightSum += weight
  }

  return weightSum > 0 ? weightedSum / weightSum : 0
}

const buildConfidence = (
  sampleCount: number,
  options: DamageModelOptions
): DamageEstimate['confidence'] => {
  if (sampleCount >= options.minHighConfidenceSamples) return 'high'
  if (sampleCount >= options.minMediumConfidenceSamples) return 'medium'
  return 'low'
}

export const DEFAULT_DAMAGE_MODEL_OPTIONS: DamageModelOptions = {
  referenceAt: new Date().toISOString(),
  halfLifeDays: 21,
  minHighConfidenceSamples: 5,
  minMediumConfidenceSamples: 2
}

/** Fallback divisor for display estimates; 0 renders every stage 'hard' with 0 tokens. */
export function computeMeanDamagePerBattle(
  records: ReadonlyArray<Pick<DamageRecord, 'damageDealt'>>
): number {
  if (records.length === 0) return 0
  return records.reduce((sum, r) => sum + r.damageDealt, 0) / records.length
}

export function buildDamageModel(
  records: DamageRecord[],
  options: Partial<DamageModelOptions> = {}
): DamageModel {
  const resolved: DamageModelOptions = {
    ...DEFAULT_DAMAGE_MODEL_OPTIONS,
    ...options,
    referenceAt: options.referenceAt ?? DEFAULT_DAMAGE_MODEL_OPTIONS.referenceAt
  }

  const referenceMs = parseTimestamp(resolved.referenceAt) ?? Date.now()

  const samplesByPlayerTarget = new Map<
    string,
    Map<DamageTargetKey, Array<{ damage: number; atMs: number }>>
  >()
  const samplesByPlayerOverall = new Map<
    string,
    Array<{ damage: number; atMs: number }>
  >()
  const samplesByGuildTarget = new Map<
    DamageTargetKey,
    Array<{ damage: number; atMs: number }>
  >()

  for (const record of records) {
    if (!record?.playerId) continue
    if (!record?.bossName) continue

    const atMs = parseTimestamp(record.startedOn)
    if (!atMs) continue

    const damage = toNonNegative(record.damageDealt)
    if (damage <= 0) continue

    const stageCode =
      record.rarity && typeof record.set === 'number'
        ? deriveStageCodeFromSetAndRarity(record.set, record.rarity)
        : 'Unknown'

    const targetKey = makeDamageTargetKey({
      bossName: record.bossName,
      stageCode,
      encounterId: record.encounterId
    })

    if (!samplesByPlayerTarget.has(record.playerId)) {
      samplesByPlayerTarget.set(record.playerId, new Map())
    }

    const perTarget = samplesByPlayerTarget.get(record.playerId)!
    if (!perTarget.has(targetKey)) {
      perTarget.set(targetKey, [])
    }
    perTarget.get(targetKey)!.push({ damage, atMs })

    if (!samplesByPlayerOverall.has(record.playerId)) {
      samplesByPlayerOverall.set(record.playerId, [])
    }
    samplesByPlayerOverall.get(record.playerId)!.push({ damage, atMs })

    if (!samplesByGuildTarget.has(targetKey)) {
      samplesByGuildTarget.set(targetKey, [])
    }
    samplesByGuildTarget.get(targetKey)!.push({ damage, atMs })
  }

  const byPlayerTarget = new Map<
    string,
    Map<DamageTargetKey, { expectedDamage: number; sampleCount: number }>
  >()
  const byPlayerOverall = new Map<
    string,
    { expectedDamage: number; sampleCount: number }
  >()
  const byGuildTarget = new Map<
    DamageTargetKey,
    { expectedDamage: number; sampleCount: number }
  >()

  for (const [playerId, perTargetSamples] of samplesByPlayerTarget) {
    const perTargetStats = new Map<
      DamageTargetKey,
      { expectedDamage: number; sampleCount: number }
    >()
    for (const [targetKey, samples] of perTargetSamples) {
      const expectedDamage = weightedAverage(
        samples,
        referenceMs,
        resolved.halfLifeDays
      )
      perTargetStats.set(targetKey, {
        expectedDamage,
        sampleCount: samples.length
      })
    }
    byPlayerTarget.set(playerId, perTargetStats)
  }

  for (const [playerId, samples] of samplesByPlayerOverall) {
    const expectedDamage = weightedAverage(
      samples,
      referenceMs,
      resolved.halfLifeDays
    )
    byPlayerOverall.set(playerId, {
      expectedDamage,
      sampleCount: samples.length
    })
  }

  for (const [targetKey, samples] of samplesByGuildTarget) {
    const expectedDamage = weightedAverage(
      samples,
      referenceMs,
      resolved.halfLifeDays
    )
    byGuildTarget.set(targetKey, {
      expectedDamage,
      sampleCount: samples.length
    })
  }

  return { options: resolved, byPlayerTarget, byPlayerOverall, byGuildTarget }
}

export function estimateDamage(
  model: DamageModel,
  args: {
    playerId: string
    bossName: string
    stageCode: string
    encounterId: number
  }
): DamageEstimate {
  const targetKey = makeDamageTargetKey({
    bossName: args.bossName,
    stageCode: args.stageCode,
    encounterId: args.encounterId
  })

  const playerTargets = model.byPlayerTarget.get(args.playerId)
  const playerTarget = playerTargets?.get(targetKey)
  if (playerTarget && playerTarget.expectedDamage > 0) {
    return {
      expectedDamage: playerTarget.expectedDamage,
      sampleCount: playerTarget.sampleCount,
      confidence: buildConfidence(playerTarget.sampleCount, model.options),
      source: 'player_target'
    }
  }

  const playerOverall = model.byPlayerOverall.get(args.playerId)
  if (playerOverall && playerOverall.expectedDamage > 0) {
    return {
      expectedDamage: playerOverall.expectedDamage,
      sampleCount: playerOverall.sampleCount,
      confidence: buildConfidence(playerOverall.sampleCount, model.options),
      source: 'player_overall'
    }
  }

  const guildTarget = model.byGuildTarget.get(targetKey)
  if (guildTarget && guildTarget.expectedDamage > 0) {
    return {
      expectedDamage: guildTarget.expectedDamage,
      sampleCount: guildTarget.sampleCount,
      confidence: buildConfidence(guildTarget.sampleCount, model.options),
      source: 'guild_target'
    }
  }

  return {
    expectedDamage: null,
    sampleCount: 0,
    confidence: 'low',
    source: 'no_signal'
  }
}

/** Per-encounter divisor, so a strong main does not bias its prime; null when no signal. */
export function computeRosterEncounterDamagePerToken(
  model: DamageModel,
  rosterPlayerIds: readonly string[],
  target: { stageCode: string; encounterId: number; bossName: string }
): number | null {
  let sum = 0
  let count = 0
  for (const playerId of rosterPlayerIds) {
    const estimate = estimateDamage(model, {
      playerId,
      bossName: target.bossName,
      stageCode: target.stageCode,
      encounterId: target.encounterId
    })
    if (estimate.expectedDamage != null && estimate.expectedDamage > 0) {
      sum += estimate.expectedDamage
      count += 1
    }
  }

  return count > 0 ? sum / count : null
}

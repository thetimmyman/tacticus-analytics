import { Errors } from '@/app/lib/errors/AppError'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import type {
  MlConfidenceTier,
  MlInferenceInputRow,
  MlTrainingFeatureRow
} from '@/app/lib/ml/api-types'

export type MlDataDensity = MlTrainingFeatureRow['dataDensity']

export interface MlTrainingRpcRow {
  guild_code: string
  season: string
  loop_index: number
  boss_type: string
  encounter_index: number
  rarity: string
  set_num: number
  rarity_set: string | null
  guild_attack_count: number
  unique_players: number
  total_damage: number
  avg_damage: number
  max_damage: number
  max_hp: number | null
  avg_damage_pct_hp: number | null
  previous_loop_avg_damage: number | null
  rolling3_avg_damage: number | null
  trend_vs_prev_pct: number | null
  meta_attack_count: number
  meta_damage_avg: number | null
  meta_damage_p75: number | null
  meta_damage_p90: number | null
  meta_gap_pct: number | null
  data_density: string | null
  is_cold_start: boolean
  has_meta_baseline: boolean
  generated_at: string
}

export interface MlInferenceRpcRow {
  season?: string | null
  boss_type?: string | null
  encounter_index?: number | string | null
  rarity?: string | null
  set_num?: number | string | null
  rarity_set?: string | null
  latest_loop_index?: number | string | null
  latest_loop_avg_damage?: number | string | null
  latest_loop_attack_count?: number | string | null
  rolling3_avg_damage?: number | string | null
  trend_vs_prev_pct?: number | string | null
  meta_attack_count?: number | string | null
  meta_damage_avg?: number | string | null
  meta_damage_p75?: number | string | null
  meta_damage_p90?: number | string | null
  recommended_baseline_damage?: number | string | null
  confidence_tier?: string | null
  cold_start_reason?: string | null
  is_cold_start?: boolean | null
  has_meta_baseline?: boolean | null
  generated_at?: string | null
}

interface NumberOptions {
  coerceNumericStrings?: boolean
}

export interface BuildMlInferenceRowOptions extends NumberOptions {
  fallbackSeason?: string
  generatedAtFallback?: string | (() => string)
  segmentKeyEncounterLabel?: 'positive-prime' | 'display-parens'
  setNumFallback?: number
}

export function parseMlPositiveIntParam(
  value: string | null,
  fallback: number
): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw Errors.validation(`Invalid positive integer: ${value}`)
  }
  return parsed
}

export function toMlNullableNumber(
  value: unknown,
  options: NumberOptions = {}
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (options.coerceNumericStrings && value !== null && value !== undefined) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toMlNumber(
  value: unknown,
  fallback: number,
  options: NumberOptions = {}
): number {
  return toMlNullableNumber(value, options) ?? fallback
}

export function toMlConfidenceTier(
  value: string | null | undefined
): MlConfidenceTier {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'low'
}

export function toMlDataDensity(
  value: string | null | undefined
): MlDataDensity {
  if (value === 'cold_start' || value === 'sparse' || value === 'sufficient') {
    return value
  }
  return 'sparse'
}

export function buildMlRaritySet(
  raritySet: string | null | undefined,
  rarity: string,
  setNum: number
): string {
  return (
    raritySet || (rarity === 'Mythic' ? `M${setNum + 1}` : `L${setNum + 1}`)
  )
}

export function buildMlSegmentKey(
  raritySet: string,
  bossType: string,
  encounterIndex: number,
  options: { encounterLabel?: 'positive-prime' | 'display-parens' } = {}
): string {
  const labelMode = options.encounterLabel ?? 'positive-prime'
  const encounterSuffix =
    labelMode === 'display-parens'
      ? encounterIndex === 0
        ? ''
        : ` (Prime ${encounterIndex})`
      : encounterIndex > 0
        ? ` (Prime ${encounterIndex})`
        : ''
  return `${raritySet} ${getBossDisplayName(bossType)}${encounterSuffix}`
}

function resolveGeneratedAt(
  value: string | null | undefined,
  fallback: BuildMlInferenceRowOptions['generatedAtFallback']
): string {
  if (typeof value === 'string') return value
  if (typeof fallback === 'function') return fallback()
  return fallback ?? ''
}

export function buildMlInferenceInputRow(
  row: MlInferenceRpcRow,
  options: BuildMlInferenceRowOptions = {}
): MlInferenceInputRow | null {
  if (!row.boss_type || !row.rarity) return null

  const numberOptions: NumberOptions =
    options.coerceNumericStrings === undefined
      ? {}
      : { coerceNumericStrings: options.coerceNumericStrings }
  const setNum =
    toMlNullableNumber(row.set_num, numberOptions) ?? options.setNumFallback
  if (setNum === undefined) return null

  const latestLoopAvgDamage = toMlNullableNumber(
    row.latest_loop_avg_damage,
    numberOptions
  )
  const recommendedBaselineDamage = toMlNullableNumber(
    row.recommended_baseline_damage,
    numberOptions
  )
  const metaDamageAvg = toMlNullableNumber(row.meta_damage_avg, numberOptions)
  const metaDamageP75 = toMlNullableNumber(row.meta_damage_p75, numberOptions)
  const metaDamageP90 = toMlNullableNumber(row.meta_damage_p90, numberOptions)
  const expectedLow =
    metaDamageP75 ?? recommendedBaselineDamage ?? latestLoopAvgDamage
  const expectedHigh =
    metaDamageP90 ??
    metaDamageAvg ??
    recommendedBaselineDamage ??
    latestLoopAvgDamage

  const benchmarkDeltaPct =
    latestLoopAvgDamage !== null && metaDamageAvg !== null && metaDamageAvg > 0
      ? ((latestLoopAvgDamage - metaDamageAvg) / metaDamageAvg) * 100
      : null

  const uncertaintyPct =
    recommendedBaselineDamage !== null &&
    recommendedBaselineDamage > 0 &&
    expectedLow !== null &&
    expectedHigh !== null
      ? ((expectedHigh - expectedLow) / recommendedBaselineDamage) * 100
      : null

  const encounterIndex = toMlNumber(row.encounter_index, 0, numberOptions)
  const raritySet = buildMlRaritySet(row.rarity_set, row.rarity, setNum)

  return {
    segmentKey: buildMlSegmentKey(
      raritySet,
      row.boss_type,
      encounterIndex,
      options.segmentKeyEncounterLabel
        ? { encounterLabel: options.segmentKeyEncounterLabel }
        : undefined
    ),
    season:
      typeof row.season === 'string'
        ? row.season
        : (options.fallbackSeason ?? ''),
    bossType: row.boss_type,
    encounterIndex,
    rarity: row.rarity,
    setNum,
    raritySet,
    latestLoopIndex: toMlNullableNumber(row.latest_loop_index, numberOptions),
    latestLoopAvgDamage,
    latestLoopAttackCount: toMlNumber(
      row.latest_loop_attack_count,
      0,
      numberOptions
    ),
    rolling3AvgDamage: toMlNullableNumber(
      row.rolling3_avg_damage,
      numberOptions
    ),
    trendVsPrevPct: toMlNullableNumber(row.trend_vs_prev_pct, numberOptions),
    metaAttackCount: toMlNumber(row.meta_attack_count, 0, numberOptions),
    metaDamageAvg,
    metaDamageP75,
    metaDamageP90,
    recommendedBaselineDamage,
    benchmarkDeltaPct,
    uncertaintyPct,
    expectedRange: {
      low: expectedLow,
      high: expectedHigh
    },
    confidenceTier: toMlConfidenceTier(row.confidence_tier),
    coldStartReason: row.cold_start_reason ?? null,
    isColdStart: row.is_cold_start === true,
    hasMetaBaseline: row.has_meta_baseline === true,
    generatedAt: resolveGeneratedAt(
      row.generated_at,
      options.generatedAtFallback
    )
  }
}

export function buildMlTrainingFeatureRow(
  row: MlTrainingRpcRow
): MlTrainingFeatureRow {
  const setNum = row.set_num
  const raritySet = buildMlRaritySet(row.rarity_set, row.rarity, setNum)

  return {
    segmentKey: buildMlSegmentKey(
      raritySet,
      row.boss_type,
      row.encounter_index
    ),
    guildCode: row.guild_code,
    season: row.season,
    loopIndex: row.loop_index,
    bossType: row.boss_type,
    encounterIndex: row.encounter_index,
    rarity: row.rarity,
    setNum,
    raritySet,
    guildAttackCount: row.guild_attack_count,
    uniquePlayers: row.unique_players,
    totalDamage: row.total_damage,
    avgDamage: row.avg_damage,
    maxDamage: row.max_damage,
    maxHp: toMlNullableNumber(row.max_hp),
    avgDamagePctHp: toMlNullableNumber(row.avg_damage_pct_hp),
    previousLoopAvgDamage: toMlNullableNumber(row.previous_loop_avg_damage),
    rolling3AvgDamage: toMlNullableNumber(row.rolling3_avg_damage),
    trendVsPrevPct: toMlNullableNumber(row.trend_vs_prev_pct),
    metaAttackCount: row.meta_attack_count,
    metaDamageAvg: toMlNullableNumber(row.meta_damage_avg),
    metaDamageP75: toMlNullableNumber(row.meta_damage_p75),
    metaDamageP90: toMlNullableNumber(row.meta_damage_p90),
    metaGapPct: toMlNullableNumber(row.meta_gap_pct),
    dataDensity: toMlDataDensity(row.data_density),
    isColdStart: row.is_cold_start,
    hasMetaBaseline: row.has_meta_baseline,
    generatedAt: row.generated_at
  }
}

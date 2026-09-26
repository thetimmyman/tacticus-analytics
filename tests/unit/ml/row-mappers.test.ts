import { describe, expect, it } from 'vitest'
import {
  buildMlInferenceInputRow,
  buildMlSegmentKey,
  buildMlTrainingFeatureRow,
  parseMlPositiveIntParam,
  toMlConfidenceTier,
  toMlDataDensity,
  toMlNullableNumber,
  type MlTrainingRpcRow
} from '@/app/lib/ml/row-mappers'

const trainingRow: MlTrainingRpcRow = {
  guild_code: 'GUILD1',
  season: '50',
  loop_index: 2,
  boss_type: 'Mortarion',
  encounter_index: 1,
  rarity: 'Mythic',
  set_num: 2,
  rarity_set: null,
  guild_attack_count: 12,
  unique_players: 7,
  total_damage: 12_000,
  avg_damage: 1_000,
  max_damage: 1_800,
  max_hp: Number.NaN,
  avg_damage_pct_hp: 45,
  previous_loop_avg_damage: null,
  rolling3_avg_damage: 950,
  trend_vs_prev_pct: -8,
  meta_attack_count: 30,
  meta_damage_avg: 1_100,
  meta_damage_p75: 1_250,
  meta_damage_p90: 1_500,
  meta_gap_pct: null,
  data_density: 'unexpected',
  is_cold_start: false,
  has_meta_baseline: true,
  generated_at: '2026-07-06T12:00:00.000Z'
}

describe('ML row mappers', () => {
  it('keeps query integer parsing compatible with the existing API routes', () => {
    expect(parseMlPositiveIntParam(null, 25)).toBe(25)
    expect(parseMlPositiveIntParam('42abc', 25)).toBe(42)
    expect(() => parseMlPositiveIntParam('0', 25)).toThrow(
      'Invalid positive integer'
    )
  })

  it('normalizes common ML scalar fields', () => {
    expect(toMlNullableNumber(12)).toBe(12)
    expect(toMlNullableNumber(Number.NaN)).toBeNull()
    expect(toMlNullableNumber('12')).toBeNull()
    expect(toMlNullableNumber('12', { coerceNumericStrings: true })).toBe(12)
    expect(toMlConfidenceTier('high')).toBe('high')
    expect(toMlConfidenceTier('unknown')).toBe('low')
    expect(toMlDataDensity('cold_start')).toBe('cold_start')
    expect(toMlDataDensity('unknown')).toBe('sparse')
  })

  it('builds the same segment key for all analytics consumers', () => {
    expect(buildMlSegmentKey('L5', 'Mortarion', 0)).toBe('L5 Mortarion')
    expect(buildMlSegmentKey('L5', 'Mortarion', 2)).toBe(
      'L5 Mortarion (Prime 2)'
    )
    expect(buildMlSegmentKey('L5', 'Mortarion', -1)).toBe('L5 Mortarion')
    expect(
      buildMlSegmentKey('L5', 'Mortarion', -1, {
        encounterLabel: 'display-parens'
      })
    ).toBe('L5 Mortarion (Prime -1)')
  })

  it('maps inference rows in strict API mode', () => {
    const row = buildMlInferenceInputRow({
      season: '50',
      boss_type: 'Mortarion',
      encounter_index: 1,
      rarity: 'Legendary',
      set_num: 4,
      rarity_set: 'L5',
      latest_loop_index: 3,
      latest_loop_avg_damage: 900,
      latest_loop_attack_count: 2,
      rolling3_avg_damage: 950,
      trend_vs_prev_pct: -10,
      meta_attack_count: 30,
      meta_damage_avg: 1_000,
      meta_damage_p75: 1_100,
      meta_damage_p90: 1_300,
      recommended_baseline_damage: 1_000,
      confidence_tier: 'high',
      cold_start_reason: null,
      is_cold_start: false,
      has_meta_baseline: true,
      generated_at: '2026-07-06T12:00:00.000Z'
    })

    expect(row).toMatchObject({
      segmentKey: 'L5 Mortarion (Prime 1)',
      season: '50',
      setNum: 4,
      raritySet: 'L5',
      benchmarkDeltaPct: -10,
      uncertaintyPct: 20,
      expectedRange: { low: 1_100, high: 1_300 },
      confidenceTier: 'high',
      isColdStart: false,
      hasMetaBaseline: true
    })
  })

  it('keeps fallback/coercion behavior explicit', () => {
    const row = buildMlInferenceInputRow(
      {
        boss_type: 'Mortarion',
        encounter_index: '2',
        rarity: 'Legendary',
        set_num: '4',
        rarity_set: null,
        latest_loop_index: '3',
        latest_loop_avg_damage: '900',
        latest_loop_attack_count: '2',
        rolling3_avg_damage: '950',
        trend_vs_prev_pct: '-10',
        meta_attack_count: '30',
        meta_damage_avg: '1000',
        meta_damage_p75: '1100',
        meta_damage_p90: '1300',
        recommended_baseline_damage: '1000',
        confidence_tier: 'not-a-tier',
        is_cold_start: true,
        has_meta_baseline: true
      },
      {
        fallbackSeason: '51',
        coerceNumericStrings: true,
        segmentKeyEncounterLabel: 'display-parens',
        generatedAtFallback: 'fallback-generated-at'
      }
    )

    expect(row).toMatchObject({
      segmentKey: 'L5 Mortarion (Prime 2)',
      season: '51',
      encounterIndex: 2,
      setNum: 4,
      latestLoopIndex: 3,
      latestLoopAttackCount: 2,
      metaAttackCount: 30,
      confidenceTier: 'low',
      isColdStart: true,
      hasMetaBaseline: true,
      generatedAt: 'fallback-generated-at'
    })

    const malformedSet = buildMlInferenceInputRow(
      {
        boss_type: 'Mortarion',
        encounter_index: 0,
        rarity: 'Legendary',
        set_num: 'not-a-number'
      },
      {
        fallbackSeason: '51',
        coerceNumericStrings: true,
        setNumFallback: 0,
        generatedAtFallback: 'fallback-generated-at'
      }
    )

    expect(malformedSet).toMatchObject({
      segmentKey: 'L1 Mortarion',
      season: '51',
      setNum: 0,
      raritySet: 'L1'
    })
  })

  it('drops incomplete inference rows and maps training rows with shared normalization', () => {
    expect(
      buildMlInferenceInputRow({
        boss_type: 'Mortarion',
        rarity: 'Legendary',
        set_num: '4'
      })
    ).toBeNull()

    const mapped = buildMlTrainingFeatureRow(trainingRow)

    expect(mapped).toMatchObject({
      segmentKey: 'M3 Mortarion (Prime 1)',
      guildCode: 'GUILD1',
      raritySet: 'M3',
      dataDensity: 'sparse',
      maxHp: null,
      hasMetaBaseline: true
    })
  })
})

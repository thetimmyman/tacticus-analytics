export type MlConfidenceTier = 'high' | 'medium' | 'low'

export interface MlInferenceRange {
  low: number | null
  high: number | null
}

export interface MlInferenceInputRow {
  segmentKey: string
  season: string
  bossType: string
  encounterIndex: number
  rarity: string
  setNum: number
  raritySet: string
  latestLoopIndex: number | null
  latestLoopAvgDamage: number | null
  latestLoopAttackCount: number
  rolling3AvgDamage: number | null
  trendVsPrevPct: number | null
  metaAttackCount: number
  metaDamageAvg: number | null
  metaDamageP75: number | null
  metaDamageP90: number | null
  recommendedBaselineDamage: number | null
  benchmarkDeltaPct: number | null
  uncertaintyPct: number | null
  expectedRange: MlInferenceRange
  confidenceTier: MlConfidenceTier
  coldStartReason: string | null
  isColdStart: boolean
  hasMetaBaseline: boolean
  generatedAt: string
}

export interface MlInferenceSummary {
  totalRows: number
  coldStartRows: number
  highConfidenceRows: number
  mediumConfidenceRows: number
  lowConfidenceRows: number
  decliningRows: number
  underBaselineRows: number
  coldStartReason: string | null
}

export interface MlInferenceApiResponse {
  success: true
  source: 'rpc_v1'
  guildCode: string
  season: string | null
  rows: MlInferenceInputRow[]
  summary: MlInferenceSummary
}

export interface MlTrainingFeatureRow {
  segmentKey: string
  guildCode: string
  season: string
  loopIndex: number
  bossType: string
  encounterIndex: number
  rarity: string
  setNum: number
  raritySet: string
  guildAttackCount: number
  uniquePlayers: number
  totalDamage: number
  avgDamage: number
  maxDamage: number
  maxHp: number | null
  avgDamagePctHp: number | null
  previousLoopAvgDamage: number | null
  rolling3AvgDamage: number | null
  trendVsPrevPct: number | null
  metaAttackCount: number
  metaDamageAvg: number | null
  metaDamageP75: number | null
  metaDamageP90: number | null
  metaGapPct: number | null
  dataDensity: 'cold_start' | 'sparse' | 'sufficient'
  isColdStart: boolean
  hasMetaBaseline: boolean
  generatedAt: string
}

export interface MlTrainingFeaturesSummary {
  totalRows: number
  coldStartRows: number
  sparseRows: number
  sufficientRows: number
}

export interface MlTrainingFeaturesApiResponse {
  success: true
  source: 'rpc_v1'
  guildCode: string
  seasons: string[]
  rows: MlTrainingFeatureRow[]
  summary: MlTrainingFeaturesSummary
}

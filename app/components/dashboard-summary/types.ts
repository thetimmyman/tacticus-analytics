import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

export interface DashboardSummaryProps {
  selectedGuild: string
  selectedSeason: string
  hasCluster?: boolean
  /** Resolved server-side; never read DEPLOYMENT_ENV in a client component. */
  isAlpha?: boolean
  /** Null when the gate is off or the RPC errored. */
  initialForecast?: SeasonForecastEnvelope | null
  /** Preferred for token figures; the envelope is the fallback when null. */
  initialOutlook?: SeasonOutlookProjection | null
}

export interface TooltipProps {
  active?: boolean
  payload?: Array<{
    value: number
    name: string
    color: string
  }>
  label?: string
}

export type LoopTokenEntry = {
  loop: number
  actualLoop: number
  bossTokens: number
  primeTokens: number
  totalTokens: number
  rarities: string[]
}

export type LoopTokenSetData = {
  chartData: Array<Record<string, number | string>>
  levelKeys: string[]
}

export interface BossPerformanceSummary {
  boss: string
  tier: number
  level: number
  set?: number
  rarity: string
  encounterId?: number
  avgDamage: number
  maxDamage: number
  hitCount: number
  vsClusterPercent: number
}

export interface PrimePerformanceSummary {
  prime: string
  level: number
  set?: number
  rarity: string
  encounterId?: number
  avgDamage: number
  maxDamage: number
  hitCount: number
  vsClusterPercent: number
}

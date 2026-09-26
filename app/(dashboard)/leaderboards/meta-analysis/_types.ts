import type { TeamComposition } from '@tacticus/app-core/meta-analysis.types'

export interface MetaAnalysisClientProps {
  initialSeason: string
}

/** Mirrors `x-meta-source`: empty (`meta-atlas-rpc`), disabled, or a failed RPC sent as 200. */
export type MetaAnalysisSource =
  'meta-atlas-rpc' | 'fallback-disabled' | 'fallback-error'

export interface BossAnalysis {
  rarity: string
  set: number
  levelString: string
  bossName: string
  encounterId: number
  bossType: 'main' | 'side-left' | 'side-right'
  compositions: TeamComposition[]
  loading: boolean
  error: string | null
  source?: MetaAnalysisSource | null
  currentPage?: number
}

export interface BossComparisonState {
  showComparison: boolean
  compareTeams: string[]
}

export type BossComparisonStates = Record<string, BossComparisonState>

export interface CompositionWrapper {
  composition?: TeamComposition | null
  categories?: string[]
  category?: string | null
}

export type CompositionEntry = TeamComposition | CompositionWrapper

export const getBossComparisonKey = (analysis: BossAnalysis): string =>
  `${analysis.rarity}-${analysis.set}-${analysis.encounterId}`

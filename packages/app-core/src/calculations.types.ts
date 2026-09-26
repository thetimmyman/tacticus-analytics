import type { PostgrestError } from '@supabase/supabase-js'
import type { Database } from './database.generated'

export type EOTGRData = Database['public']['Tables']['EOT_GR_data']['Row']

export type CalculationValue =
  number | string | boolean | Record<string, unknown> | unknown[] | null

export interface CalculationDependencies {
  [key: string]: CalculationValue
}

export interface CalculationContext {
  allData?: EOTGRData[]
  filters?: CalculationFilters
  aggregatedData?: Map<string, AggregatedData>
  metadata?: Record<string, unknown>
  supabase?: unknown
}

export interface CalculationFilters {
  Guild?: string | string[]
  Season?: string
  displayName?: string | string[]
  Name?: string | string[]
  damageType?: 'Battle' | 'Bomb'
  encounterId?: number | number[]
  loopIndex?: number | number[]
  set?: number
  rarity?: string | string[]
  player_id?: string | string[]
  tier?: number | number[]
  completedOn?: string | { start: string; end: string }
  timeRange?: 'season' | '24h' | '7d'
  excludeSweeps?: boolean
  excludeZeroDamage?: boolean
}

export interface AggregatedData {
  count: number
  sum: number
  avg: number
  min: number
  max: number
  values: number[]
}

export type CalculationResult = CalculationValue

export type CalculationFunction = (
  dependencies: CalculationDependencies,
  context?: CalculationContext
) => CalculationResult | Promise<CalculationResult>

export interface OutputFormat {
  type: 'number' | 'percentage' | 'string' | 'object' | 'array'
  unit?: string
  format?: string
  structure?: Record<string, string>
}

export interface CalculationDefinition {
  id: string
  name: string
  description: string
  category:
    | 'player'
    | 'guild'
    | 'boss'
    | 'token'
    | 'award'
    | 'special'
    | 'base'
    | 'specialized'
    | 'cluster'
    | 'comparison'
    | string
  strategy?: 'formula' | 'composite' | 'rule' | 'query'
  dependencies?: string[]
  subCalculations?: string[]
  calculate?: CalculationFunction
  evaluate?: (context: CalculationContext) => CalculationResult
  query?:
    string | ((filters: CalculationFilters) => Promise<DatabaseResult<unknown>>)
  transform?: (data: unknown) => CalculationResult
  cache?: {
    ttl?: number
    key?: string
  }
  baseFormula?: string
  compositeLogic?: string
  ruleDefinition?: Record<string, unknown>
  acceptsFilters?: string[]
  defaultScope?: 'player' | 'guild' | 'boss' | 'cluster'
  requiresContext?: string[]
  inputs?: string[]
  outputs?: OutputFormat
  usedIn?: string[]
  notes?: string[]
  example?: {
    scenario: string
    input: Record<string, unknown>
    output: unknown
  }
  usesGuildSettings?: boolean
  cacheTTL?: number
}

export interface DatabaseResult<T> {
  data: T[] | T | null
  error: PostgrestError | null
  count?: number
}

export class CalculationError extends Error {
  constructor(
    message: string,
    public calculationId: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'CalculationError'
  }
}

export function isCalculationValue(value: unknown): value is CalculationValue {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'object'
  )
}

export function isCalculationDependencies(
  value: unknown
): value is CalculationDependencies {
  return typeof value === 'object' && value !== null
}

export function isCalculationContext(
  value: unknown
): value is CalculationContext {
  return typeof value === 'object' && value !== null
}

export type StrictCalculationFunction<
  TDeps extends CalculationDependencies,
  TResult
> = (
  dependencies: TDeps,
  context?: CalculationContext
) => TResult | Promise<TResult>

export interface NumericCalculationResult {
  value: number
  unit?: string
  formatted?: string
}

export interface PercentageCalculationResult {
  value: number
  percentage: number
  total: number
}

export interface ComparisonCalculationResult {
  value: number
  baseline: number
  difference: number
  percentChange: number
}

export interface RankingCalculationResult {
  rank: number
  total: number
  percentile: number
  value: number
}

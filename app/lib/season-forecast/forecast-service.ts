// 60s-cached `get_guild_season_forecast`; null on RPC error (e.g. caller has no player_mapping).

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { mainCache } from '@tacticus/app-core/unified-cache'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('season-forecast.service')

const FORECAST_CACHE_TTL_MS = 60_000

export type ForecastBasis = 'wi737_solver' | 'last_n_laps' | 'manual'
export type ForecastConfidence = 'low' | 'medium' | 'high'

export interface SeasonForecastSeason {
  number: number
  starts_at: string
  ends_at: string
  seconds_remaining: number
}

export interface SeasonForecastTokens {
  available_now: number
  yet_to_regen: number
  capacity: number
  cap_bound_players: number
  estimated_cap_waste: number
}

export interface SeasonForecastBombs {
  available_now: number
  yet_to_regen: number
  capacity: number
}

export interface SeasonForecastLapProjection {
  current_lap: number
  tokens_into_current_lap: number
  projected_lap_cost: number
  basis: ForecastBasis
  n: number
  projected_finish_lap: number
  projected_finish_pct: number
  confidence: ForecastConfidence
}

export interface SeasonForecastPlayerRow {
  player_id: string
  display_name: string
  tokens_now: number
  next_token_seconds: number
  tokens_will_regen: number
  tokens_at_season_end: number
  will_cap: boolean
  estimated_cap_waste: number
}

export interface SeasonForecastEnvelope {
  season: SeasonForecastSeason
  tokens: SeasonForecastTokens
  bombs: SeasonForecastBombs
  lap_projection?: SeasonForecastLapProjection
  per_player: SeasonForecastPlayerRow[]
}

export interface ForecastServiceArgs {
  guildCode: string
  seasonNumber: number
  /** Default false: per_player holds only the caller's own row. */
  includePerPlayer?: boolean
  /** Cache key only; not sent to the RPC. */
  userId?: string | null
  skipCache?: boolean
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asNumber = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback

const asBoolean = (v: unknown): boolean =>
  typeof v === 'boolean' ? v : Boolean(v)

const narrowSeason = (raw: unknown): SeasonForecastSeason => {
  const r = isObject(raw) ? raw : {}
  return {
    number: asNumber(r.number),
    starts_at: asString(r.starts_at),
    ends_at: asString(r.ends_at),
    seconds_remaining: asNumber(r.seconds_remaining)
  }
}

const narrowTokens = (raw: unknown): SeasonForecastTokens => {
  const r = isObject(raw) ? raw : {}
  return {
    available_now: asNumber(r.available_now),
    yet_to_regen: asNumber(r.yet_to_regen),
    capacity: asNumber(r.capacity),
    cap_bound_players: asNumber(r.cap_bound_players),
    estimated_cap_waste: asNumber(r.estimated_cap_waste)
  }
}

const narrowBombs = (raw: unknown): SeasonForecastBombs => {
  const r = isObject(raw) ? raw : {}
  return {
    available_now: asNumber(r.available_now),
    yet_to_regen: asNumber(r.yet_to_regen),
    capacity: asNumber(r.capacity)
  }
}

const narrowBasis = (raw: unknown): ForecastBasis => {
  if (raw === 'wi737_solver' || raw === 'last_n_laps' || raw === 'manual') {
    return raw
  }
  return 'last_n_laps'
}

const narrowConfidence = (raw: unknown): ForecastConfidence => {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return 'low'
}

const narrowLapProjection = (
  raw: unknown
): SeasonForecastLapProjection | undefined => {
  if (!isObject(raw)) return undefined
  return {
    current_lap: asNumber(raw.current_lap),
    tokens_into_current_lap: asNumber(raw.tokens_into_current_lap),
    projected_lap_cost: asNumber(raw.projected_lap_cost),
    basis: narrowBasis(raw.basis),
    n: asNumber(raw.n),
    projected_finish_lap: asNumber(raw.projected_finish_lap),
    projected_finish_pct: asNumber(raw.projected_finish_pct),
    confidence: narrowConfidence(raw.confidence)
  }
}

const narrowPerPlayer = (raw: unknown): SeasonForecastPlayerRow[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => {
    if (!isObject(row)) return []
    return [
      {
        player_id: asString(row.player_id),
        display_name: asString(row.display_name),
        tokens_now: asNumber(row.tokens_now),
        next_token_seconds: asNumber(row.next_token_seconds),
        tokens_will_regen: asNumber(row.tokens_will_regen),
        tokens_at_season_end: asNumber(row.tokens_at_season_end),
        will_cap: asBoolean(row.will_cap),
        estimated_cap_waste: asNumber(row.estimated_cap_waste)
      }
    ]
  })
}

export const narrowForecastEnvelope = (
  raw: unknown
): SeasonForecastEnvelope | null => {
  if (!isObject(raw)) return null
  return {
    season: narrowSeason(raw.season),
    tokens: narrowTokens(raw.tokens),
    bombs: narrowBombs(raw.bombs),
    lap_projection: narrowLapProjection(raw.lap_projection),
    per_player: narrowPerPlayer(raw.per_player)
  }
}

const cacheKey = (args: ForecastServiceArgs): string =>
  `season-forecast:${args.guildCode}:${args.seasonNumber}:${
    args.includePerPlayer ? 'all' : 'self'
  }:${args.userId ?? 'anon'}`

export async function fetchSeasonForecast(
  supabase: TypedSupabaseClient,
  args: ForecastServiceArgs
): Promise<SeasonForecastEnvelope | null> {
  const fetcher = async (): Promise<SeasonForecastEnvelope | null> => {
    const { data, error } = await supabase.rpc('get_guild_season_forecast', {
      p_guild_code: args.guildCode,
      p_include_per_player: Boolean(args.includePerPlayer),
      p_season_number: args.seasonNumber
    })

    if (error) {
      logger.warn(
        { err: error, guildCode: args.guildCode, season: args.seasonNumber },
        'season-forecast RPC failed'
      )
      return null
    }

    return narrowForecastEnvelope(data)
  }

  if (args.skipCache) return fetcher()

  return mainCache.getOrFetch(cacheKey(args), fetcher, {
    ttl: FORECAST_CACHE_TTL_MS,
    priority: 'medium',
    tags: [
      'season-forecast',
      `guild:${args.guildCode}`,
      `season:${args.seasonNumber}`
    ]
  }) as Promise<SeasonForecastEnvelope | null>
}

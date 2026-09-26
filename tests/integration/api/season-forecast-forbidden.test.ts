/** RLS on the SECURITY INVOKER RPC does the fencing; the wrapper only maps errors to null. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchSeasonForecast,
  narrowForecastEnvelope
} from '@/app/lib/season-forecast/forecast-service'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

vi.mock('@tacticus/app-core/unified-cache', () => ({
  mainCache: {
    getOrFetch: vi.fn(async (_key: string, fetcher: () => Promise<unknown>) =>
      fetcher()
    ),
    invalidate: vi.fn()
  }
}))

const sampleEnvelope = {
  season: {
    number: 80,
    starts_at: '2026-04-21T18:00:00Z',
    ends_at: '2026-05-04T18:00:00Z',
    seconds_remaining: 216000
  },
  tokens: {
    available_now: 34,
    yet_to_regen: 138,
    capacity: 172,
    cap_bound_players: 7,
    estimated_cap_waste: 22
  },
  bombs: {
    available_now: 24,
    yet_to_regen: 11,
    capacity: 35
  },
  lap_projection: {
    current_lap: 6,
    tokens_into_current_lap: 24,
    projected_lap_cost: 125,
    basis: 'last_n_laps',
    n: 2,
    projected_finish_lap: 6,
    projected_finish_pct: 0.47,
    confidence: 'medium'
  },
  per_player: [
    {
      player_id: 'p1',
      display_name: 'ForecastPlayer',
      tokens_now: 2,
      next_token_seconds: 6960,
      tokens_will_regen: 4,
      tokens_at_season_end: 3,
      will_cap: false,
      estimated_cap_waste: 0
    }
  ]
}

function makeSupabase(
  rpcImpl: (
    name: string,
    params: Record<string, unknown>
  ) => {
    data: unknown
    error: { message: string } | null
  }
): TypedSupabaseClient {
  return {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) =>
      rpcImpl(name, params)
    )
  } as unknown as TypedSupabaseClient
}

describe('WI-766 fetchSeasonForecast — access / RLS surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when the RPC errors (e.g. anon caller hitting RLS)', async () => {
    const supabase = makeSupabase(() => ({
      data: null,
      error: {
        message: 'permission denied for function get_guild_season_forecast'
      }
    }))

    const result = await fetchSeasonForecast(supabase, {
      guildCode: 'GUILD_X',
      seasonNumber: 80,
      includePerPlayer: false,
      userId: null,
      skipCache: true
    })

    expect(result).toBeNull()
  })

  it('plumbs p_include_per_player=false (caller-only mode) through to the RPC', async () => {
    const seenParams: Record<string, unknown>[] = []
    const supabase = makeSupabase((_name, params) => {
      seenParams.push(params)
      return { data: sampleEnvelope, error: null }
    })

    await fetchSeasonForecast(supabase, {
      guildCode: 'GUILD_X',
      seasonNumber: 80,
      includePerPlayer: false,
      userId: 'u1',
      skipCache: true
    })

    expect(seenParams).toHaveLength(1)
    expect(seenParams[0]).toEqual({
      p_guild_code: 'GUILD_X',
      p_include_per_player: false,
      p_season_number: 80
    })
  })

  it('plumbs p_include_per_player=true (officer mode) through to the RPC', async () => {
    const seenParams: Record<string, unknown>[] = []
    const supabase = makeSupabase((_name, params) => {
      seenParams.push(params)
      return { data: sampleEnvelope, error: null }
    })

    await fetchSeasonForecast(supabase, {
      guildCode: 'GUILD_X',
      seasonNumber: 80,
      includePerPlayer: true,
      userId: 'u1',
      skipCache: true
    })

    expect(seenParams[0]?.p_include_per_player).toBe(true)
  })

  it('narrows the envelope to typed shape (officer happy path)', async () => {
    const supabase = makeSupabase(() => ({
      data: sampleEnvelope,
      error: null
    }))

    const result = await fetchSeasonForecast(supabase, {
      guildCode: 'GUILD_X',
      seasonNumber: 80,
      includePerPlayer: true,
      userId: 'u1',
      skipCache: true
    })

    expect(result).not.toBeNull()
    expect(result!.season.number).toBe(80)
    expect(result!.tokens.capacity).toBe(172)
    expect(result!.bombs.capacity).toBe(35)
    expect(result!.lap_projection?.projected_finish_lap).toBe(6)
    expect(result!.per_player).toHaveLength(1)
    expect(result!.per_player[0]?.display_name).toBe('ForecastPlayer')
  })

  it('narrowForecastEnvelope returns null for non-object input (defensive)', () => {
    expect(narrowForecastEnvelope(null)).toBeNull()
    expect(narrowForecastEnvelope(undefined)).toBeNull()
    expect(narrowForecastEnvelope('not-an-object')).toBeNull()
  })

  it('narrowForecastEnvelope strips lap_projection when absent (no completed laps)', () => {
    const noProjection = { ...sampleEnvelope, lap_projection: undefined }
    const result = narrowForecastEnvelope(noProjection)
    expect(result).not.toBeNull()
    expect(result!.lap_projection).toBeUndefined()
  })
})

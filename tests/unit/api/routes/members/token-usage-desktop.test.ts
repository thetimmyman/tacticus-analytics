import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'

const state = vi.hoisted(() => ({
  user: true,
  profile: {
    guild_code: 'SYN001',
    role: 'officer',
    cluster_code: 'SYN',
    is_current: true
  },
  target: { guild_code: 'SYN001', cluster_code: 'SYN' },
  calls: [] as Array<[string, unknown]>
}))
const usage = vi.hoisted(() => vi.fn())
const statuses = vi.hoisted(() => vi.fn())
const service = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/app/lib/db', () => ({
  db: async () => authClient,
  serviceDb: () => service
}))
vi.mock('@/app/lib/auth/server', () => ({
  createClient: async () => authClient
}))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: async () => {
    if (!state.user) throw Errors.unauthorized('Authentication required')
    return { id: '00000000-0000-4000-8000-000000000001' }
  }
}))
const authClient = {
  from: () => {
    const filters: Record<string, unknown> = {}
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        filters[key] = value
        state.calls.push([key, value])
        return chain
      },
      single: async () => ({
        data:
          filters.is_current === true && !state.profile.is_current
            ? null
            : state.profile,
        error: null
      })
    }
    return chain
  }
}
vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: { getBasic: async () => state.target }
}))
vi.mock('@/app/lib/data/token-usage', () => ({ getTokenUsage: usage }))
vi.mock('@/app/api/guild-tokens/token-service', () => ({
  loadGuildTokenStatuses: statuses
}))

import { GET as getUsage } from '@/app/api/members/token-usage/route'
import { GET as getTokens } from '@/app/api/guild-tokens/route'
import { GET as getBattles } from '@/app/api/members/token-usage/battles/route'

const usageRequest = (suffix = '') =>
  new NextRequest(
    `http://localhost/api/members/token-usage?guild=SYN001&season=100${suffix}`
  )
const tokenRequest = (suffix = '') =>
  new NextRequest(
    `http://localhost/api/guild-tokens?guild=SYN001&season=100${suffix}`
  )

describe('cached desktop token endpoints', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    state.user = true
    state.profile = {
      guild_code: 'SYN001',
      role: 'officer',
      cluster_code: 'SYN',
      is_current: true
    }
    state.target = { guild_code: 'SYN001', cluster_code: 'SYN' }
    state.calls = []
    usage.mockReset().mockResolvedValue([
      {
        player_id: 'synthetic-player',
        display_name: 'Synthetic Member',
        tokens_used: 4,
        max_possible: 7,
        boss_tokens: 3,
        prime_tokens: 1,
        bombs_used: 1
      }
    ])
    statuses.mockReset().mockResolvedValue({
      players: [
        {
          player_id: 'synthetic-player',
          display_name: 'Synthetic Member',
          tokens_used: 4,
          max_possible: 7,
          tokens_available: 2,
          token_next_in_seconds: 3600,
          bombs_available: 0,
          next_bomb_seconds: 1800,
          burned_tokens: 1,
          time_over_cap_seconds: 43200,
          data_source: 'cached',
          last_sync_at: '2026-01-01T00:00:00Z'
        }
      ],
      debug: { live_api_fetched: 0 }
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('returns canonical cached state and provenance without overlay, recomputing after import', async () => {
    const first = await getUsage(usageRequest())
    const rows = await first.json()
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(rows[0]).toMatchObject({
      tokens_used: 4,
      boss_tokens: 3,
      prime_tokens: 1,
      tokens_available: 2,
      bombs_available_live: 0,
      burned_tokens: 0,
      lost_tokens_at_cap: 1,
      time_over_cap_seconds: 43200,
      data_source: 'cached',
      last_sync_at: '2026-01-01T00:00:00Z'
    })
    expect(statuses).toHaveBeenCalledWith(
      authClient,
      expect.objectContaining({
        skipLiveOverlay: true,
        verifyLiveRoster: false
      })
    )
    usage.mockResolvedValueOnce([
      {
        player_id: 'synthetic-player',
        display_name: 'Synthetic Member',
        tokens_used: 5,
        max_possible: 7
      }
    ])
    expect((await (await getUsage(usageRequest())).json())[0].tokens_used).toBe(
      5
    )
    expect(statuses).toHaveBeenCalledTimes(2)
  })

  it('retains the endpoint-specific regular-member read policy', async () => {
    state.profile.role = 'member'
    expect((await getUsage(usageRequest())).status).toBe(200)
    expect((await getTokens(tokenRequest())).status).toBe(403)
  })

  it('rejects stale membership before reading privileged token state', async () => {
    state.profile.is_current = false
    expect((await getUsage(usageRequest())).status).toBe(403)
    expect((await getTokens(tokenRequest())).status).toBe(403)
    expect(statuses).not.toHaveBeenCalled()
  })

  it('refuses anonymous and foreign-cluster callers', async () => {
    state.user = false
    expect((await getUsage(usageRequest())).status).toBe(401)
    state.user = true
    state.target = { guild_code: 'SYN002', cluster_code: 'OTHER' }
    expect((await getUsage(usageRequest())).status).toBe(403)
    expect((await getTokens(tokenRequest())).status).toBe(403)
    expect(statuses).not.toHaveBeenCalled()
  })

  it('refuses a member forged same-cluster guild scope', async () => {
    state.profile.role = 'member'
    state.target = { guild_code: 'SYN002', cluster_code: 'SYN' }
    expect((await getUsage(usageRequest())).status).toBe(403)
    expect(statuses).not.toHaveBeenCalled()
  })

  it('never treats app-admin role as guild-token authority', async () => {
    state.profile.role = 'admin'
    expect((await getTokens(tokenRequest())).status).toBe(403)
    expect(statuses).not.toHaveBeenCalled()
  })

  it('rejects a live request in desktop mode before any overlay', async () => {
    expect((await getTokens(tokenRequest('&live=true'))).status).toBe(403)
    expect(statuses).not.toHaveBeenCalled()
  })

  it('does not serve stale process cache after a local database failure', async () => {
    await getUsage(usageRequest())
    statuses.mockRejectedValueOnce(new Error('synthetic unavailable'))
    expect((await getUsage(usageRequest())).status).toBe(503)
  })

  it.each(['0', '-1', 'x', '1.2', '2147483648'])(
    'refuses malformed season %s',
    async (season) => {
      const response = await getUsage(
        new Request(
          `http://localhost/api/members/token-usage?guild=SYN001&season=${season}`
        )
      )
      expect(response.status).toBe(400)
      expect(statuses).not.toHaveBeenCalled()
    }
  )

  it('refuses malformed battle filters before querying cached raids', async () => {
    const response = await getBattles(
      new NextRequest(
        'http://localhost/api/members/token-usage/battles?guild=SYN001&seasons=100,nope&rarities=Legendary'
      )
    )
    expect(response.status).toBe(400)
    expect(service.from).not.toHaveBeenCalled()
  })
})

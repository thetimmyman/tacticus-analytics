import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

type WarRouteContext = {
  params: Promise<{ warId: string }>
}

type WarRouteHandler = (
  request: NextRequest,
  context: WarRouteContext
) => Promise<Response>

const { authenticatedClient, serviceDb, serviceRpc } = vi.hoisted(() => ({
  authenticatedClient: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn()
  },
  serviceDb: vi.fn(),
  serviceRpc: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(async () => authenticatedClient),
  serviceDb
}))

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler:
    (handler: WarRouteHandler) =>
    (request: NextRequest, context: WarRouteContext) =>
      handler(request, context)
}))

vi.mock('@/modules/guild-war/server/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

const request = (suffix: 'players' | 'stats') =>
  new NextRequest(`http://localhost/api/wars/war-1/${suffix}`)

const context = {
  params: Promise.resolve({ warId: 'war-1' })
}

const configureWarAccess = (active: boolean) => {
  const events: string[] = []
  const membershipFilters: Record<string, unknown> = {}

  authenticatedClient.auth.getUser.mockImplementation(async () => {
    events.push('auth.getUser')
    return {
      data: { user: { id: 'user-1' } },
      error: null
    }
  })

  authenticatedClient.from.mockImplementation((table: string) => {
    events.push(`from:${table}`)

    if (table === 'guild_war_matches') {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { war_id: 'war-1', guild_code: 'EOT' },
          error: null
        })
      }
      return query
    }

    if (table === 'player_mapping') {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: string | boolean) => {
          membershipFilters[column] = value
          return query
        }),
        single: vi.fn(async () => ({
          data:
            active || membershipFilters.is_current !== true
              ? { guild_code: 'EOT' }
              : null,
          error: null
        }))
      }
      return query
    }

    if (table === 'guild_war_zones' || table === 'guild_war_battles') {
      const result = { data: [], error: null }
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        not: vi.fn(() => query),
        then: (
          onFulfilled: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return query
    }

    throw new Error(`Unexpected table ${table}`)
  })

  serviceDb.mockImplementation(() => {
    events.push('serviceDb')
    return { rpc: serviceRpc }
  })

  return { events, membershipFilters }
}

describe('war service-role RPC boundary (WI-4450)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceRpc.mockResolvedValue({ data: [], error: null })
  })

  it.each(['players', 'stats'] as const)(
    'denies inactive history before constructing service role for %s',
    async (suffix) => {
      const { events, membershipFilters } = configureWarAccess(false)
      const { GET } =
        suffix === 'players'
          ? await import('./players/route')
          : await import('./stats/route')

      await expect(GET(request(suffix), context)).rejects.toMatchObject({
        statusCode: 403
      })

      expect(membershipFilters).toEqual({
        user_id: 'user-1',
        is_current: true
      })
      expect(events).toEqual([
        'auth.getUser',
        'from:guild_war_matches',
        'from:player_mapping'
      ])
      expect(serviceDb).not.toHaveBeenCalled()
      expect(serviceRpc).not.toHaveBeenCalled()
      expect(authenticatedClient.rpc).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['players', 'get_war_player_stats'],
    ['stats', 'get_war_stats']
  ] as const)(
    'uses service role for the %s RPC only after real access checks succeed',
    async (suffix, rpcName) => {
      const { events, membershipFilters } = configureWarAccess(true)
      const { GET } =
        suffix === 'players'
          ? await import('./players/route')
          : await import('./stats/route')

      const response = await GET(request(suffix), context)

      expect(response.status).toBe(200)
      expect(membershipFilters).toEqual({
        user_id: 'user-1',
        is_current: true
      })
      expect(events).toEqual([
        'auth.getUser',
        'from:guild_war_matches',
        'from:player_mapping',
        'serviceDb',
        // Only players does RLS-client zone reads after the service RPC.
        ...(suffix === 'players'
          ? ['from:guild_war_zones', 'from:guild_war_battles']
          : [])
      ])
      expect(serviceDb).toHaveBeenCalledOnce()
      expect(serviceRpc).toHaveBeenCalledWith(rpcName, {
        p_war_id: 'war-1',
        p_guild_code: 'EOT'
      })
      expect(authenticatedClient.rpc).not.toHaveBeenCalled()
    }
  )
})

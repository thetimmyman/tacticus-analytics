import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

type QueryResult = { data: unknown; error: unknown }

const leaderMapping = {
  id: 7,
  user_id: 'user-1',
  guild_code: 'MYGUILD',
  role: 'leader',
  is_current: true
}

const guildInCluster = {
  guild_code: 'MYGUILD',
  cluster_id: 'cluster-uuid-1',
  cluster_code: 'CLU'
}

const receipt = {
  guild_code: 'MYGUILD',
  previous_cluster_id: 'cluster-uuid-1',
  previous_cluster_code: 'CLU',
  cleared_mappings: 4
}

describe('POST /api/clusters/leave', () => {
  let POST: (request: NextRequest) => Promise<Response>

  let mockRequireAuthForApi: ReturnType<typeof vi.fn>
  let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
  let mockRpc: ReturnType<typeof vi.fn>
  let sessionResults: Record<string, QueryResult>
  let sessionFilters: Record<string, Array<[string, unknown]>>

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuthForApi = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { id: 7, role: 'leader', guild_code: 'MYGUILD' }
    })
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)
    mockRpc = vi.fn().mockResolvedValue({ data: [receipt], error: null })
    sessionResults = {
      player_mapping: { data: leaderMapping, error: null },
      guild_config: { data: guildInCluster, error: null }
    }
    sessionFilters = {}

    const sessionClient = {
      from: vi.fn().mockImplementation((table: string) => {
        sessionFilters[table] = []
        const chain: Record<string, ReturnType<typeof vi.fn>> = {}
        chain.select = vi.fn().mockReturnValue(chain)
        chain.eq = vi
          .fn()
          .mockImplementation((column: string, value: unknown) => {
            sessionFilters[table].push([column, value])
            return chain
          })
        chain.maybeSingle = vi
          .fn()
          .mockImplementation(
            async () => sessionResults[table] ?? { data: null, error: null }
          )
        return chain
      })
    }

    vi.doMock('@/app/lib/db', () => ({
      db: vi.fn().mockResolvedValue(sessionClient),
      serviceDb: vi.fn().mockReturnValue({ rpc: mockRpc })
    }))

    vi.doMock('@/app/lib/auth', () => ({
      requireAuthForApi: mockRequireAuthForApi,
      AuthError: class AuthError extends Error {}
    }))

    vi.doMock('@/app/lib/middleware/api-security-middleware', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    const { withErrorHandlerMock } =
      await import('@/tests/helpers/mock-error-handler')
    vi.doMock('@/app/lib/middleware/errorHandler', () => ({
      ...withErrorHandlerMock,
      rethrowIfAuthError: () => undefined
    }))

    vi.doMock('@/app/lib/errors/AppError', () => ({
      Errors: {
        fromResponse: (status: number, body: Record<string, unknown>) => {
          const err = new Error(JSON.stringify(body)) as Error & {
            status: number
            body: Record<string, unknown>
          }
          err.status = status
          err.body = body
          return err
        }
      },
      rethrowIfAppError: (error: unknown) => {
        if ((error as { status?: number })?.status) throw error
      }
    }))

    const mod = await import('@/app/api/clusters/leave/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function leave(body: unknown = { clusterCode: 'CLU' }) {
    return POST(
      new NextRequest('http://localhost/api/clusters/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    )
  }

  it('returns the security response when the middleware blocks', async () => {
    mockApiSecurityMiddleware.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
    )
    const res = await leave()
    expect(res.status).toBe(429)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('refuses a caller whose cached role is not leader', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { id: 7, role: 'officer', guild_code: 'MYGUILD' }
    })
    const res = await leave()
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('refuses when the fresh mapping is no longer a leader, whatever the cache says', async () => {
    sessionResults.player_mapping = {
      data: { ...leaderMapping, role: 'officer' },
      error: null
    }
    const res = await leave()
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('requires the cluster the leader confirmed leaving', async () => {
    const res = await leave({})
    expect(res.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('refuses when the guild is not in a cluster', async () => {
    sessionResults.guild_config = {
      data: { guild_code: 'MYGUILD', cluster_id: null, cluster_code: null },
      error: null
    }
    const res = await leave()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'CLUSTER_LEAVE_NOT_IN_CLUSTER'
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('refuses when the guild has moved to another cluster since the page loaded', async () => {
    const res = await leave({ clusterCode: 'OTHER' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'CLUSTER_LEAVE_CLUSTER_CHANGED'
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("leaves the cluster of the leader's own guild, pinned to the cluster it read", async () => {
    const res = await leave({ clusterCode: 'clu' })
    expect(res.status).toBe(200)
    expect(sessionFilters.player_mapping).toEqual(
      expect.arrayContaining([
        ['id', 7],
        ['user_id', 'user-1'],
        ['is_current', true]
      ])
    )
    expect(sessionFilters.guild_config).toEqual([['guild_code', 'MYGUILD']])
    expect(mockRpc).toHaveBeenCalledWith('leave_guild_cluster', {
      p_guild_code: 'MYGUILD',
      p_expected_cluster_id: 'cluster-uuid-1',
      p_actor_user_id: 'user-1'
    })
    expect(await res.json()).toMatchObject({
      success: true,
      action: 'guild_left_cluster',
      guild: { guild_code: 'MYGUILD' },
      previousCluster: { cluster_code: 'CLU' },
      clearedMappings: 4
    })
  })

  it('explains that the cluster creator cannot leave', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', hint: 'cluster_creator', message: 'x' }
    })
    const res = await leave()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'CLUSTER_LEAVE_CREATOR' })
  })

  it('maps a leadership refusal under the row lock to 403', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', hint: null, message: 'x' }
    })
    const res = await leave()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'CLUSTER_LEAVE_FORBIDDEN' })
  })

  it('maps a cluster change under the row lock to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'x' }
    })
    const res = await leave()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'CLUSTER_LEAVE_CLUSTER_CHANGED'
    })
  })

  it('does not report success without a receipt', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const res = await leave()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      code: 'CLUSTER_LEAVE_STATE_UNKNOWN'
    })
  })

  it('does not leak database errors', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'internal detail' }
    })
    const res = await leave()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'CLUSTER_LEAVE_FAILED' })
    expect(JSON.stringify(body)).not.toContain('internal detail')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

const summaryRow = {
  registered_users: 10,
  clusters_with_guilds: 2,
  distinct_guilds_battle: 3,
  player_mappings: 40,
  distinct_players_battle: 35,
  boss_battle_records: 100,
  guild_war_battles: 5
}

function createAdminProfileQuery(isAdmin: boolean) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { is_app_admin: isAdmin },
      error: null
    })
  }
}

describe('GET /api/admin/platform-summary', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }
    mockServiceSupabase = {
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    const routeModule = await import('@/app/api/admin/platform-summary/route')
    GET = routeModule.GET
  })

  it('returns 401 and does not read cached or service data when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/admin/platform-summary')
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
    expect(body.error.metadata.error).toBe('Unauthorized')
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockServiceSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns 403 and skips the summary RPC when caller is not app admin', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSupabase.from.mockReturnValue(createAdminProfileQuery(false))

    const response = await GET(
      new NextRequest('http://localhost/api/admin/platform-summary')
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Forbidden')
    expect(body.error.metadata.error).toBe('Forbidden')
    expect(mockServiceSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns platform summary metrics for app admins', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin-1' } }
    })
    mockSupabase.from.mockReturnValue(createAdminProfileQuery(true))
    mockServiceSupabase.rpc.mockResolvedValue({
      data: [summaryRow],
      error: null
    })

    const response = await GET(
      new NextRequest('http://localhost/api/admin/platform-summary')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.summary).toEqual(summaryRow)
    expect(body.cachedAt).toBeDefined()
    expect(mockServiceSupabase.rpc).toHaveBeenCalledWith(
      'get_platform_summary_metrics'
    )
  })

  it('keeps cached platform summary data behind the auth gate', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin-1' } }
    })
    mockSupabase.from.mockReturnValue(createAdminProfileQuery(true))
    mockServiceSupabase.rpc.mockResolvedValue({
      data: [summaryRow],
      error: null
    })

    const firstResponse = await GET(
      new NextRequest('http://localhost/api/admin/platform-summary')
    )
    expect(firstResponse.status).toBe(200)

    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    mockSupabase.from.mockClear()

    const cachedDeniedResponse = await GET(
      new NextRequest('http://localhost/api/admin/platform-summary')
    )
    const body = await cachedDeniedResponse.json()

    expect(cachedDeniedResponse.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockServiceSupabase.rpc).toHaveBeenCalledTimes(1)
  })
})

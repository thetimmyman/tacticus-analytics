import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

describe('POST /api/user/activity', () => {
  let POST: () => Promise<Response>
  let mockCreateClient: ReturnType<typeof vi.fn>
  let mockCreateServiceClient: ReturnType<typeof vi.fn>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
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
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    const svcNeq = vi.fn().mockResolvedValue({ error: null })
    const svcEq = vi.fn().mockReturnValue({ neq: svcNeq })
    const svcUpdate = vi.fn().mockReturnValue({ eq: svcEq })
    mockServiceSupabase.from.mockReturnValue({ update: svcUpdate })

    const routeModule = await import('@/app/api/user/activity/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null
    })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
  })

  it('returns 500 when the update fails', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null
    })

    const select = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'Boom' } })
    const secondEq = vi.fn().mockReturnValue({ select })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    const update = vi.fn().mockReturnValue({ eq: firstEq })
    mockSupabase.from.mockReturnValue({ update })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('Unable to update activity status')
    expect(body.error.message).not.toContain('Boom')
  })

  // Transient infra errors answer 503, not a Sentry-captured 500.
  it.each([
    ['PostgREST 503 status', { message: 'upstream unavailable' }, 503],
    ['PGRST001 connection code', { message: 'db down', code: 'PGRST001' }, 400],
    ['57014 statement timeout', { message: 'canceled', code: '57014' }, 400],
    ['53300 too many connections', { message: 'full', code: '53300' }, 400]
  ])(
    'returns 503 without a 500 for transient failure: %s',
    async (_label, dbError, httpStatus) => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null
      })

      const select = vi
        .fn()
        .mockResolvedValue({ data: null, error: dbError, status: httpStatus })
      const secondEq = vi.fn().mockReturnValue({ select })
      const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
      const update = vi.fn().mockReturnValue({ eq: firstEq })
      mockSupabase.from.mockReturnValue({ update })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toBe('Unable to update activity status')
      expect(body.error.metadata.transient).toBe(true)
    }
  )

  it('updates the current user activity timestamp and promotes guild tier', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null
    })

    const select = vi.fn().mockResolvedValue({
      data: [{ guild_code: 'IW' }],
      error: null
    })
    const secondEq = vi.fn().mockReturnValue({ select })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    const update = vi.fn().mockReturnValue({ eq: firstEq })
    mockSupabase.from.mockReturnValue({ update })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockSupabase.from).toHaveBeenCalledWith('player_mapping')
    expect(update).toHaveBeenCalledWith({ last_active_at: expect.any(String) })
    expect(firstEq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(secondEq).toHaveBeenCalledWith('is_current', true)
    expect(mockServiceSupabase.from).toHaveBeenCalledWith('guild_config')
  })

  it('skips guild tier promotion when no guild membership', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null
    })

    const select = vi.fn().mockResolvedValue({
      data: [],
      error: null
    })
    const secondEq = vi.fn().mockReturnValue({ select })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    const update = vi.fn().mockReturnValue({ eq: firstEq })
    mockSupabase.from.mockReturnValue({ update })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockServiceSupabase.from).not.toHaveBeenCalled()
  })
})

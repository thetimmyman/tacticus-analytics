import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockSupabase: {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}
let AuthError: typeof import('@/app/lib/auth').AuthError

const buildSelectQuery = (result: {
  data: Array<Record<string, unknown>> | null
  error: { message: string } | null
}) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  data: result.data,
  error: result.error
})

const buildUpsertQuery = (result: {
  data: Record<string, unknown> | null
  error: { message: string } | null
}) => ({
  upsert: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(result)
    })
  })
})

describe('Playbook requirements routes', () => {
  let GET: (
    request: Request,
    context: { params: Promise<{ bossId: string }> }
  ) => Promise<Response>
  let POST: (
    request: Request,
    context: { params: Promise<{ bossId: string }> }
  ) => Promise<Response>

  const createGetRequest = (bossId: string, query = '') => {
    return [
      new Request(
        `http://localhost/api/playbooks/${bossId}/requirements${query}`
      ),
      { params: Promise.resolve({ bossId }) }
    ] as const
  }

  const createPostRequest = (bossId: string, body: Record<string, unknown>) => {
    return [
      new Request(`http://localhost/api/playbooks/${bossId}/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ bossId }) }
    ] as const
  }

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuth = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetUserAccessLevels = vi.fn()
    mockCreateClient = vi.fn()
    mockSupabase = { from: vi.fn(), rpc: vi.fn() }

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireAuth: mockRequireAuth,
        requireAuthForApi: mockRequireAuth
      }
    })
    const authModule = await import('@/app/lib/auth')
    AuthError = authModule.AuthError

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess,
      getUserAccessLevels: mockGetUserAccessLevels
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/playbooks/[bossId]/requirements/route')
    GET = routeModule.GET
    POST = routeModule.POST
  })

  describe('GET', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockRequireAuth.mockRejectedValue(
        new AuthError('Authentication required', 'UNAUTHENTICATED')
      )

      const [request, context] = createGetRequest('boss-1')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })

    it('returns 403 when feature access is denied', async () => {
      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockCheckFeatureAccess.mockResolvedValue({
        has_access: false,
        stage: 'alpha',
        reason: 'Feature gate'
      })

      const [request, context] = createGetRequest('boss-1')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Boss Playbooks requires alpha ')
    })

    it('applies filters and splits guild requirements', async () => {
      const query = buildSelectQuery({
        data: [
          { id: 'r1', guild_code: null },
          { id: 'r2', guild_code: 'GUILD' },
          { id: 'r3', guild_code: 'OTHER' }
        ],
        error: null
      })

      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetUserAccessLevels.mockResolvedValue({ guild_code: 'GUILD' })
      mockSupabase.from.mockReturnValue(query)

      const [request, context] = createGetRequest(
        'boss-1',
        '?difficulty=hard&meta_team_id=meta-1'
      )
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.requirements).toEqual([
        expect.objectContaining({
          id: 'r1',
          guild_code: null,
          hero_requirements: [],
          team_name: null
        })
      ])
      expect(body.guild_requirements).toEqual([
        expect.objectContaining({
          id: 'r2',
          guild_code: 'GUILD',
          hero_requirements: [],
          team_name: null
        })
      ])
      expect(body.user_guild_code).toBe('GUILD')
      expect(query.eq).toHaveBeenCalledWith('boss_id', 'boss-1')
      expect(query.eq).toHaveBeenCalledWith('difficulty', 'hard')
      expect(query.eq).toHaveBeenCalledWith('meta_team_id', 'meta-1')
    })

    it('excludes guild requirements when include_guild_specific=false', async () => {
      const query = buildSelectQuery({
        data: [
          { id: 'r1', guild_code: null },
          { id: 'r2', guild_code: 'GUILD' }
        ],
        error: null
      })

      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetUserAccessLevels.mockResolvedValue({ guild_code: 'GUILD' })
      mockSupabase.from.mockReturnValue(query)

      const [request, context] = createGetRequest(
        'boss-1',
        '?include_guild_specific=false'
      )
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.guild_requirements).toEqual([])
    })

    it('returns 500 when query fails', async () => {
      const query = buildSelectQuery({
        data: null,
        error: { message: 'boom' }
      })

      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetUserAccessLevels.mockResolvedValue({ guild_code: 'GUILD' })
      mockSupabase.from.mockReturnValue(query)

      const [request, context] = createGetRequest('boss-1')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('boom')
    })
  })

  describe('POST', () => {
    it('returns 403 when user lacks editor access', async () => {
      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockSupabase.rpc.mockResolvedValue({ data: false })

      const [request, context] = createPostRequest('boss-1', {
        hero_requirements: [{ hero: 'Alpha' }]
      })
      const response = await POST(request, context)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toBe('Editor access required')
    })

    it('returns 400 when hero_requirements are invalid', async () => {
      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockSupabase.rpc.mockResolvedValue({ data: true })

      const [request, context] = createPostRequest('boss-1', {
        hero_requirements: ['bad']
      })
      const response = await POST(request, context)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('hero_requirements must be an a')
    })

    it('creates a requirement with guild context', async () => {
      const query = buildUpsertQuery({
        data: { id: 'req-1' },
        error: null
      })

      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockSupabase.rpc.mockResolvedValue({ data: true })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'GUILD',
        cluster_code: 'CLUSTER'
      })
      mockSupabase.from.mockReturnValue(query)

      const [request, context] = createPostRequest('boss-1', {
        difficulty: 'hard',
        meta_team_id: 'meta-1',
        team_name: 'Alpha Team',
        hero_requirements: [{ hero: 'Alpha' }],
        overall_notes: 'Notes',
        is_verified: true,
        guild_specific: true
      })
      const response = await POST(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.requirement).toEqual({ id: 'req-1' })
      expect(query.upsert).toHaveBeenCalled()
      const [payload, options] = query.upsert.mock.calls[0]
      expect(payload).toMatchObject({
        boss_id: 'boss-1',
        difficulty: 'hard',
        meta_team_id: 'meta-1',
        team_name: 'Alpha Team',
        overall_notes: 'Notes',
        contributor_id: 'user-1',
        is_verified: true,
        cluster_code: 'CLUSTER',
        guild_code: 'GUILD'
      })
      expect(options).toMatchObject({
        onConflict: 'boss_id,meta_team_id,guild_code,cluster_code'
      })
    })

    it('returns 500 when upsert fails', async () => {
      const query = buildUpsertQuery({
        data: null,
        error: { message: 'save failed' }
      })

      mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
      mockSupabase.rpc.mockResolvedValue({ data: true })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'GUILD',
        cluster_code: 'CLUSTER'
      })
      mockSupabase.from.mockReturnValue(query)

      const [request, context] = createPostRequest('boss-1', {
        hero_requirements: [{ hero: 'Alpha' }]
      })
      const response = await POST(request, context)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('save failed')
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

let AuthError: typeof import('@/app/lib/auth').AuthError
let mockRequireAuthForApi: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockLogger: {
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

describe('GET /api/meta/strength-overrides', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  const createRequest = (query: string) =>
    new Request(
      `http://localhost/api/meta/strength-overrides${query ? `?${query}` : ''}`
    )

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuthForApi = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockCreateClient = vi.fn()
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn()
    }

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireAuthForApi: mockRequireAuthForApi
      }
    })

    const authModule = await import('@/app/lib/auth')
    AuthError = authModule.AuthError

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@/app/lib/logging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/app/lib/logging')>()
      return {
        ...actual,
        createComponentLogger: vi.fn(() => mockLogger)
      }
    })

    mockSupabase = {
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/meta/strength-overrides/route')
    GET = routeModule.GET
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireAuthForApi.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await GET(
      createRequest('boss_id=magnus&meta_team_id=team-1')
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe(1001)
  })

  it('returns 403 when feature access is denied', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({
      has_access: false,
      stage: 'alpha',
      reason: 'missing'
    })

    const response = await GET(
      createRequest('boss_id=magnus&meta_team_id=team-1')
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('Boss Playbooks requires alpha ')
    expect(body.error.metadata?.stage).toBe('alpha')
    expect(body.error.metadata?.reason).toBe('missing')
  })

  it('returns 400 when boss id is missing', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

    const response = await GET(createRequest('meta_team_id=team-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('boss_id or boss_type is requir')
  })

  it('resolves meta team by name and returns overrides', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

    const eqOverrides = vi.fn().mockReturnThis()
    const requirementsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: eqOverrides,
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'override-1', boss_id: 'magnus', meta_team_id: 'team-123' },
        error: null
      })
    }

    const metaTeamQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: 'team-123' }, error: null })
    }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'meta_teams') {
        return metaTeamQuery
      }
      if (table === 'boss_playbook_team_requirements') {
        return requirementsQuery
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      createRequest(
        'boss_name=Magnus%20the%20Red&meta_team=Alpha%20Squad&difficulty=legendary'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.overrides).toEqual({
      id: 'override-1',
      boss_id: 'magnus',
      meta_team_id: 'team-123'
    })
    expect(eqOverrides).toHaveBeenCalledWith('boss_id', 'magnus')
    expect(eqOverrides).toHaveBeenCalledWith('meta_team_id', 'team-123')
    expect(eqOverrides).toHaveBeenCalledWith('difficulty', 'legendary')
  })

  it('returns overrides null when meta team lookup fails', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

    const metaTeamQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'lookup failed' }
      })
    }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'meta_teams') {
        return metaTeamQuery
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      createRequest('boss_id=magnus&meta_team=Missing%20Team')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.overrides).toBeNull()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('returns 500 when overrides query fails', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

    const requirementsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'DB error' } })
    }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'boss_playbook_team_requirements') {
        return requirementsQuery
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET(
      createRequest('boss_id=magnus&meta_team_id=team-1')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('DB error')
  })

  it('returns 500 for unexpected errors', async () => {
    mockRequireAuthForApi.mockRejectedValue(new Error('boom'))

    const response = await GET(
      createRequest('boss_id=magnus&meta_team_id=team-1')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to fetch strength overr')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})

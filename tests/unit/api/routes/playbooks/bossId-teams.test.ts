import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuthForApi: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let AuthErrorClass: typeof import('@/app/lib/auth').AuthError
let mockPlaybooks: {
  bosses: Array<{
    id: string
    name: string
    tacticusTableIds?: { boss?: string }
  }>
}

describe('GET /api/playbooks/[bossId]/teams', () => {
  let GET: (
    request: Request,
    context: { params: Promise<{ bossId: string }> }
  ) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  const createRequest = (bossId: string, query = '') => {
    return [
      new Request(`http://localhost/api/playbooks/${bossId}/teams${query}`),
      { params: Promise.resolve({ bossId }) }
    ] as const
  }

  const buildQueuedQuery = (
    queue: Array<{ data: unknown; error: unknown }>
  ) => {
    const getResult = () => queue.shift() ?? { data: null, error: null }
    const query: any = {}
    query.select = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.or = vi.fn(() => query)
    query.ilike = vi.fn(() => query)
    query.order = vi.fn(() => query)
    query.limit = vi.fn(() => query)
    query.gt = vi.fn(() => query)
    query.gte = vi.fn(() => query)
    query.not = vi.fn(() => query)
    query.in = vi.fn(() => query)
    query.maybeSingle = vi.fn(() => Promise.resolve(getResult()))
    query.then = (
      resolve: (value: { data: unknown; error: unknown }) => void,
      reject: (reason?: unknown) => void
    ) => Promise.resolve(getResult()).then(resolve, reject)
    return query
  }

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuthForApi = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetUserAccessLevels = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockPlaybooks = {
      bosses: [
        {
          id: 'boss-1',
          name: 'Boss One',
          tacticusTableIds: { boss: 'BossUnit1' }
        }
      ]
    }

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireAuthForApi: mockRequireAuthForApi
      }
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess,
      getUserAccessLevels: mockGetUserAccessLevels
    }))

    vi.doMock('@/data/boss-playbooks/playbooks.json', () => ({
      default: mockPlaybooks
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const authModule = await import('@/app/lib/auth')
    AuthErrorClass = authModule.AuthError

    const routeModule = await import('@/app/api/playbooks/[bossId]/teams/route')
    GET = routeModule.GET
  })

  it('returns 401 when user is not authenticated', async () => {
    mockRequireAuthForApi.mockRejectedValue(
      new AuthErrorClass('Authentication required', 'UNAUTHENTICATED')
    )

    const [request, context] = createRequest('boss-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
  })

  it('returns 403 when user lacks feature access', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({
      has_access: false,
      stage: 'alpha',
      reason: 'Feature gate'
    })

    const [request, context] = createRequest('boss-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('Boss Playbooks requires alpha ')
  })

  it('returns rarity teams with default rarity sets', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    mockGetUserAccessLevels.mockResolvedValue({ guild_code: 'GUILD' })

    const metaAtlasQueue = [
      { data: [{ season: '45' }], error: null },
      { data: { boss_type: 'Hive_Tyrant' }, error: null },
      { data: [{ rarity_set: 'M1' }, { rarity_set: 'L5' }], error: null },
      {
        data: [
          {
            team_hash: 'hash-l5',
            team_composition: 'comp-l5',
            meta_team: 'Team L5',
            rarity_set: 'L5',
            boss_type: 'Hive_Tyrant',
            encounter_index: 0,
            damage_p90: 120,
            damage_p75: 110,
            damage_avg: 105,
            attack_count: 30,
            season: '45'
          }
        ],
        error: null
      },
      {
        data: [
          {
            team_hash: 'hash-m1',
            team_composition: 'comp-m1',
            meta_team: 'Team M1',
            rarity_set: 'M1',
            boss_type: 'Hive_Tyrant',
            encounter_index: 0,
            damage_p90: 140,
            damage_p75: 130,
            damage_avg: 125,
            attack_count: 35,
            season: '45'
          }
        ],
        error: null
      }
    ]
    const eotGrQueue = [
      {
        data: [{ rarity: 'Legendary', set: 4 }],
        error: null
      }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'meta_atlas_data') {
        return buildQueuedQuery(metaAtlasQueue)
      }
      if (table === 'EOT_GR_data') {
        return buildQueuedQuery(eotGrQueue)
      }
      if (table === 'boss_mapping') {
        return buildQueuedQuery([])
      }
      return buildQueuedQuery([])
    })

    mockSupabase.rpc.mockResolvedValue({
      data: [{ rarity_set: 'M1' }, { rarity_set: 'L5' }],
      error: null
    })

    const [request, context] = createRequest('boss-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.default_rarity_sets).toEqual(['L5', 'M1'])
    expect(body.available_rarity_sets).toEqual(['M1', 'L5'])
    expect(body.rarity_teams).toHaveLength(2)
    expect(body.rarity_teams[0].rarity_set).toBe('L5')
    expect(body.rarity_teams[0].teams[0].meta_team).toBe('Team L5')
    expect(body.rarity_teams[1].rarity_set).toBe('M1')
    expect(body.rarity_teams[1].teams[0].meta_team).toBe('Team M1')
  })

  it('filters rarity_sets query param against available sets', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    mockGetUserAccessLevels.mockResolvedValue({ guild_code: 'GUILD' })

    const metaAtlasQueue = [
      { data: [{ season: '45' }], error: null },
      { data: { boss_type: 'Hive_Tyrant' }, error: null },
      { data: [{ rarity_set: 'M1' }, { rarity_set: 'L5' }], error: null },
      {
        data: [
          {
            team_hash: 'hash-m1',
            team_composition: 'comp-m1',
            meta_team: 'Team M1',
            rarity_set: 'M1',
            boss_type: 'Hive_Tyrant',
            encounter_index: 0,
            damage_p90: 140,
            damage_p75: 130,
            damage_avg: 125,
            attack_count: 35,
            season: '45'
          }
        ],
        error: null
      }
    ]
    const eotGrQueue = [
      {
        data: [{ rarity: 'Legendary', set: 4 }],
        error: null
      }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'meta_atlas_data') {
        return buildQueuedQuery(metaAtlasQueue)
      }
      if (table === 'EOT_GR_data') {
        return buildQueuedQuery(eotGrQueue)
      }
      if (table === 'boss_mapping') {
        return buildQueuedQuery([])
      }
      return buildQueuedQuery([])
    })

    mockSupabase.rpc.mockResolvedValue({
      data: [{ rarity_set: 'M1' }, { rarity_set: 'L5' }],
      error: null
    })

    const [request, context] = createRequest(
      'boss-1',
      '?rarity_sets=M1,invalid'
    )
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.rarity_teams).toHaveLength(1)
    expect(body.rarity_teams[0].rarity_set).toBe('M1')
    expect(body.default_rarity_sets).toEqual(['L5', 'M1'])
  })
})

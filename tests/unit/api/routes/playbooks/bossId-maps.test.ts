import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockPlaybooks: {
  bosses: Array<{ id: string; name?: string; boards?: string[] }>
  generatedAt: string
}
let mockBoardSections: Record<
  string,
  { bossType?: string; main?: string[]; support?: string[] }
>
let AuthError: typeof import('@/app/lib/auth').AuthError

describe('GET /api/playbooks/[bossId]/maps', () => {
  let GET: (
    request: Request,
    context: { params: Promise<{ bossId: string }> }
  ) => Promise<Response>
  let mockMapsIn: ReturnType<typeof vi.fn>
  let mockBossMappingEq: ReturnType<typeof vi.fn>

  const createRequest = (bossId: string, query = '') => {
    return [
      new Request(`http://localhost/api/playbooks/${bossId}/maps${query}`),
      { params: Promise.resolve({ bossId }) }
    ] as const
  }

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuth = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockMapsIn = vi.fn()
    mockBossMappingEq = vi.fn().mockResolvedValue({ data: [], error: null })
    mockPlaybooks = {
      bosses: [{ id: 'boss-1', name: 'Boss One', boards: ['Board One'] }],
      generatedAt: '2025-01-01T00:00:00Z'
    }
    mockBoardSections = {}

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
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/data/boss-playbooks/playbooks.json', () => ({
      default: mockPlaybooks
    }))

    vi.doMock('@/data/boss-playbooks/board-sections.json', () => ({
      default: mockBoardSections
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))

    mockCreateServiceClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'maps') {
          return {
            select: vi.fn().mockReturnValue({
              in: mockMapsIn
            })
          }
        }
        if (table === 'boss_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: mockBossMappingEq
            })
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      })
    })

    const routeModule = await import('@/app/api/playbooks/[bossId]/maps/route')
    GET = routeModule.GET
  })

  it('returns 401 when user is not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const [request, context] = createRequest('boss-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
  })

  it('returns 403 when user lacks feature access', async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
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

  it('returns empty sections when no boards are configured', async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    mockPlaybooks.bosses = [{ id: 'boss-1', name: 'Boss One', boards: [] }]

    const [request, context] = createRequest('boss-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sections).toEqual([])
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('groups main and support boards with boss/prime names', async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    mockPlaybooks.bosses = [
      {
        id: 'belisarius',
        name: 'Belisarius Cawl',
        boards: ['GB_Belisarius_01']
      }
    ]
    // Mutate in place: the route reads the object the mock bound at import.
    mockBoardSections.belisarius = {
      bossType: 'BelisariusRW',
      main: ['GB_Belisarius_01', 'GB_Belisarius_02'],
      support: ['GB_Belisarius_support_01']
    }
    mockMapsIn.mockResolvedValue({
      data: [
        { id: 'GB_Belisarius_01', image_url: 'https://cdn.example/b1.png' },
        { id: 'GB_Belisarius_02', image_url: 'https://cdn.example/b2.png' },
        {
          id: 'GB_Belisarius_support_01',
          image_url: 'https://cdn.example/s1.png'
        }
      ],
      error: null
    })
    mockBossMappingEq.mockResolvedValue({
      data: [
        { encounter_index: 0, boss_name: 'Belisarius Cawl' },
        { encounter_index: 1, boss_name: "Tan Gi'da" },
        { encounter_index: 2, boss_name: 'Actus' }
      ],
      error: null
    })

    const [request, context] = createRequest('belisarius')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.boss).toEqual({
      name: 'Belisarius Cawl',
      primes: ["Tan Gi'da", 'Actus']
    })
    expect(body.sections).toHaveLength(2)

    const [main, support] = body.sections
    expect(main.key).toBe('main')
    expect(main.title).toBe('Main Boards')
    expect(main.subtitle).toBe('Belisarius Cawl')
    expect(main.boards.map((b: { board: string }) => b.board)).toEqual([
      'GB_Belisarius_01',
      'GB_Belisarius_02'
    ])

    expect(support.key).toBe('support')
    expect(support.title).toBe('Support Boards')
    expect(support.subtitle).toBe("Tan Gi'da · Actus")
    expect(support.boards).toHaveLength(1)
    expect(support.boards[0].image_url).toBe('https://cdn.example/s1.png')
  })

  it('falls back to the battle board-image route when a map has no stored URL', async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    mockPlaybooks.bosses = [
      { id: 'silent-king', name: 'Szarekh', boards: ['GB_SK_03'] }
    ]
    mockMapsIn.mockResolvedValue({
      data: [{ id: 'GB_SK_03', image_url: null }],
      error: null
    })

    const [request, context] = createRequest('silent-king')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sections).toHaveLength(1)
    expect(body.sections[0].key).toBe('main')
    expect(body.sections[0].boards[0]).toMatchObject({
      board: 'GB_SK_03',
      path: 'GB_SK_03',
      image_url: '/api/battle/board-image?board=GB_SK_03&boss=silent-king'
    })
  })
})

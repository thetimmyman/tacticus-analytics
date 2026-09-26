import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/admin/global-thresholds', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  const makeRequest = () =>
    new NextRequest('http://localhost/api/admin/global-thresholds')

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuth = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireAuth: mockRequireAuth,
        requireAuthForApi: mockRequireAuth,
        requireActiveMembershipForApi: mockRequireAuth
      }
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    mockSupabase = {
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/global-thresholds/route')
    GET = routeModule.GET
  })

  it('returns 403 when user is not admin', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: false }
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(403)
  })

  it('returns thresholds for admins', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const mockThresholds = [
      {
        id: '1',
        rarity: 'legendary',
        strength_level: 'high',
        min_rank: 'gold',
        min_rank_index: 12,
        min_ability_active: 3,
        min_ability_passive: 2,
        notes: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02'
      }
    ]

    const orderMock = vi.fn()
    const builder = { order: orderMock }
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue(builder)
    })
    orderMock.mockReturnValueOnce(builder).mockResolvedValueOnce({
      data: mockThresholds,
      error: null
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.thresholds).toEqual(mockThresholds)
  })

  it('returns empty array when no thresholds exist', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const orderMock = vi.fn()
    const builder = { order: orderMock }
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue(builder)
    })
    orderMock.mockReturnValueOnce(builder).mockResolvedValueOnce({
      data: null,
      error: null
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.thresholds).toEqual([])
  })

  it('returns 500 on database error', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const orderMock = vi.fn()
    const builder = { order: orderMock }
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue(builder)
    })
    orderMock.mockReturnValueOnce(builder).mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error' }
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(500)
  })
})

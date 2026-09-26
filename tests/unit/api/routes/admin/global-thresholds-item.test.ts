import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('PUT /api/admin/global-thresholds/[id]', () => {
  let PUT: (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

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

    const routeModule =
      await import('@/app/api/admin/global-thresholds/[id]/route')
    PUT = routeModule.PUT
  })

  it('returns 403 when user is not admin', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: false }
    })

    const request = new NextRequest(
      'http://localhost/api/admin/global-thresholds/1',
      {
        method: 'PUT',
        body: JSON.stringify({ min_rank: 'gold', min_rank_index: 5 })
      }
    )

    const response = await PUT(request, {
      params: Promise.resolve({ id: '1' })
    })
    expect(response.status).toBe(403)
  })

  it('returns 400 when required fields are missing', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const request = new NextRequest(
      'http://localhost/api/admin/global-thresholds/1',
      {
        method: 'PUT',
        body: JSON.stringify({})
      }
    )

    const response = await PUT(request, {
      params: Promise.resolve({ id: '1' })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when min_rank_index is out of range', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const request = new NextRequest(
      'http://localhost/api/admin/global-thresholds/1',
      {
        method: 'PUT',
        body: JSON.stringify({ min_rank: 'gold', min_rank_index: 99 })
      }
    )

    const response = await PUT(request, {
      params: Promise.resolve({ id: '1' })
    })
    expect(response.status).toBe(400)
  })

  it('returns 500 when update fails', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const updateMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const selectMock = vi.fn().mockReturnThis()
    const singleMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Update failed' }
    })

    mockSupabase.from.mockReturnValue({
      update: updateMock,
      eq: eqMock,
      select: selectMock,
      single: singleMock
    })

    const request = new NextRequest(
      'http://localhost/api/admin/global-thresholds/1',
      {
        method: 'PUT',
        body: JSON.stringify({ min_rank: 'gold', min_rank_index: 5 })
      }
    )

    const response = await PUT(request, {
      params: Promise.resolve({ id: '1' })
    })
    expect(response.status).toBe(500)
  })

  it('returns 404 when threshold is not found', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const updateMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const selectMock = vi.fn().mockReturnThis()
    const singleMock = vi.fn().mockResolvedValue({
      data: null,
      error: null
    })

    mockSupabase.from.mockReturnValue({
      update: updateMock,
      eq: eqMock,
      select: selectMock,
      single: singleMock
    })

    const request = new NextRequest(
      'http://localhost/api/admin/global-thresholds/1',
      {
        method: 'PUT',
        body: JSON.stringify({ min_rank: 'gold', min_rank_index: 5 })
      }
    )

    const response = await PUT(request, {
      params: Promise.resolve({ id: '1' })
    })
    expect(response.status).toBe(404)
  })

  it('updates the threshold successfully', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const updateMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const selectMock = vi.fn().mockReturnThis()
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: '1',
        rarity: 'legendary',
        strength_level: 'high',
        min_rank: 'gold',
        min_rank_index: 5,
        min_ability_active: null,
        min_ability_passive: null,
        notes: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02'
      },
      error: null
    })

    mockSupabase.from.mockReturnValue({
      update: updateMock,
      eq: eqMock,
      select: selectMock,
      single: singleMock
    })

    const request = new NextRequest(
      'http://localhost/api/admin/global-thresholds/1',
      {
        method: 'PUT',
        body: JSON.stringify({ min_rank: 'gold', min_rank_index: 5 })
      }
    )

    const response = await PUT(request, {
      params: Promise.resolve({ id: '1' })
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.threshold.id).toBe('1')
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        min_rank: 'gold',
        min_rank_index: 5,
        min_ability_active: null,
        min_ability_passive: null,
        notes: null,
        updated_at: expect.any(String)
      })
    )
  })
})

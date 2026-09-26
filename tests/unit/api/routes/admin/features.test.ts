import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>

describe('GET /api/admin/features', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  const makeRequest = () =>
    new NextRequest('http://localhost/api/admin/features')

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuth = vi.fn()
    mockCreateClient = vi.fn()

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
      createClient: mockCreateClient
    }))

    mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })
    }

    mockCreateClient.mockResolvedValue(mockSupabase as unknown)

    const routeModule = await import('@/app/api/admin/features/route')
    GET = routeModule.GET
  })

  describe('authentication', () => {
    it('returns 403 when user is not an admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false }
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toBe('Admin access required')
    })

    it('returns 403 when profile is null', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: null
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toBe('Admin access required')
    })

    it('returns 500 when requireAuth throws', async () => {
      mockRequireAuth.mockRejectedValue(new Error('Not authenticated'))

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })

  describe('successful requests', () => {
    beforeEach(() => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })
    })

    it('returns empty array when no features exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.features).toEqual([])
    })

    it('returns features sorted by sort_order', async () => {
      const mockFeatures = [
        {
          id: 1,
          feature_key: 'war_tracking',
          name: 'War Tracking',
          release_stage: 'beta',
          sort_order: 1
        },
        {
          id: 2,
          feature_key: 'meta_atlas',
          name: 'Meta Atlas',
          release_stage: 'ga',
          sort_order: 2
        },
        {
          id: 3,
          feature_key: 'boss_playbooks',
          name: 'Boss Playbooks',
          release_stage: 'alpha',
          sort_order: 3
        }
      ]

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: mockFeatures, error: null })
        })
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.features).toEqual(mockFeatures)
      expect(body.features).toHaveLength(3)
    })

    it('queries from feature_releases table with correct ordering', async () => {
      const selectMock = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      })
      mockSupabase.from.mockReturnValue({ select: selectMock })

      await GET(makeRequest())

      expect(mockSupabase.from).toHaveBeenCalledWith('feature_releases')
      expect(selectMock).toHaveBeenCalledWith('*')
    })
  })

  describe('database errors', () => {
    beforeEach(() => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })
    })

    it('returns 500 when database query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' }
          })
        })
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Database error')
    })

    it('returns empty array when data is null but no error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.features).toEqual([])
    })
  })

  describe('error handling', () => {
    it('handles non-Error exceptions', async () => {
      mockRequireAuth.mockRejectedValue('String error')

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })
})

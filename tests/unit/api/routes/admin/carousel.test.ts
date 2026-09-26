import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let GET: (request: NextRequest) => Promise<Response>
let POST: (request: Request) => Promise<Response>

describe('/api/admin/carousel', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  const makeGetRequest = () =>
    new NextRequest('http://localhost/api/admin/carousel')

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
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/carousel/route')
    GET = routeModule.GET
    POST = routeModule.POST
  })

  describe('GET /api/admin/carousel', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false }
      })

      const response = await GET(makeGetRequest())
      expect(response.status).toBe(403)
    })

    it('returns empty items array when no carousel items', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })

      const response = await GET(makeGetRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.items).toEqual([])
    })

    it('returns carousel items ordered by priority', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      const mockItems = [
        { id: 1, title: 'Item 1', priority: 10 },
        { id: 2, title: 'Item 2', priority: 5 }
      ]

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: mockItems, error: null })
        })
      })

      const response = await GET(makeGetRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.items).toHaveLength(2)
    })

    it('returns 500 on database error', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnValue({
          order: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'DB error' } })
        })
      })

      const response = await GET(makeGetRequest())
      expect(response.status).toBe(500)
    })
  })

  describe('POST /api/admin/carousel', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false },
        user: { id: 'user-1' }
      })

      const request = new NextRequest('http://localhost/api/admin/carousel', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Item' })
      })

      const response = await POST(request)
      expect(response.status).toBe(403)
    })

    it('creates carousel item with defaults', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'user-1' }
      })

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 1, title: 'New Item', link_text: 'Learn More' },
            error: null
          })
        })
      })

      mockSupabase.from.mockReturnValue({
        insert: insertMock
      })

      const request = new NextRequest('http://localhost/api/admin/carousel', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New Item',
          description: 'Test description'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.item.title).toBe('New Item')
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Item',
          link_text: 'Learn More',
          created_by: 'user-1'
        })
      )
    })

    it('creates carousel item with custom values', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'user-1' }
      })

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 1, title: 'Promo', promo_code: 'SAVE20' },
            error: null
          })
        })
      })

      mockSupabase.from.mockReturnValue({
        insert: insertMock
      })

      const request = new NextRequest('http://localhost/api/admin/carousel', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Promo',
          item_type: 'promo',
          promo_code: 'SAVE20',
          priority: 100
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          item_type: 'promo',
          promo_code: 'SAVE20',
          priority: 100
        })
      )
    })

    it('returns 500 on database error', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'user-1' }
      })

      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Insert failed' }
            })
          })
        })
      })

      const request = new NextRequest('http://localhost/api/admin/carousel', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Item' })
      })

      const response = await POST(request)
      expect(response.status).toBe(500)
    })
  })
})

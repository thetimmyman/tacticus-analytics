import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let PUT: (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>
let DELETE: (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>

describe('/api/admin/carousel/[id]', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

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

    const routeModule = await import('@/app/api/admin/carousel/[id]/route')
    PUT = routeModule.PUT
    DELETE = routeModule.DELETE
  })

  describe('PUT /api/admin/carousel/[id]', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false }
      })

      const request = new NextRequest('http://localhost/api/admin/carousel/1', {
        method: 'PUT',
        body: JSON.stringify({ title: 'Updated' })
      })

      const response = await PUT(request, {
        params: Promise.resolve({ id: '1' })
      })
      expect(response.status).toBe(403)
    })

    it('updates carousel item successfully', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 1, title: 'Updated Title' },
              error: null
            })
          })
        })
      })

      mockSupabase.from.mockReturnValue({
        update: updateMock
      })

      const request = new NextRequest('http://localhost/api/admin/carousel/1', {
        method: 'PUT',
        body: JSON.stringify({
          title: 'Updated Title',
          description: 'New description',
          is_active: true
        })
      })

      const response = await PUT(request, {
        params: Promise.resolve({ id: '1' })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.item.title).toBe('Updated Title')
    })

    it('returns 500 on database error', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Update failed' }
              })
            })
          })
        })
      })

      const request = new NextRequest('http://localhost/api/admin/carousel/1', {
        method: 'PUT',
        body: JSON.stringify({ title: 'Updated' })
      })

      const response = await PUT(request, {
        params: Promise.resolve({ id: '1' })
      })
      expect(response.status).toBe(500)
    })
  })

  describe('DELETE /api/admin/carousel/[id]', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false }
      })

      const request = new NextRequest('http://localhost/api/admin/carousel/1', {
        method: 'DELETE'
      })

      const response = await DELETE(request, {
        params: Promise.resolve({ id: '1' })
      })
      expect(response.status).toBe(403)
    })

    it('deletes carousel item successfully', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })

      const request = new NextRequest('http://localhost/api/admin/carousel/1', {
        method: 'DELETE'
      })

      const response = await DELETE(request, {
        params: Promise.resolve({ id: '1' })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('returns 500 on database error', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'Delete failed' } })
        })
      })

      const request = new NextRequest('http://localhost/api/admin/carousel/1', {
        method: 'DELETE'
      })

      const response = await DELETE(request, {
        params: Promise.resolve({ id: '1' })
      })
      expect(response.status).toBe(500)
    })
  })
})

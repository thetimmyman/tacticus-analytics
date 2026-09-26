import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>
let mockDb: ReturnType<typeof vi.fn>
let mockFetch: ReturnType<typeof vi.fn>

describe('/api/webhooks/post-assignments', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuth = vi.fn()
    mockRequireGuildOfficerOrClusterLeader = vi.fn()
    mockDb = vi.fn()
    mockFetch = vi.fn()

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireAuth: mockRequireAuth,
        requireAuthForApi: mockRequireAuth
      }
    })

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb
    }))

    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildOfficerOrClusterLeader: mockRequireGuildOfficerOrClusterLeader
    }))

    vi.stubGlobal('fetch', mockFetch)

    mockSupabase = {
      from: vi.fn()
    }

    mockDb.mockResolvedValue(mockSupabase)
    mockRequireGuildOfficerOrClusterLeader.mockResolvedValue({
      role: 'officer',
      guild_code: 'GUILD1',
      display_name: 'Officer'
    })

    const routeModule =
      await import('@/app/api/webhooks/post-assignments/route')
    POST = routeModule.POST
  })

  describe('POST /api/webhooks/post-assignments', () => {
    describe('authentication', () => {
      it('returns 401 when not authenticated', async () => {
        mockRequireAuth.mockResolvedValue({ user: null })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test assignment message'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error.message).toBe('Unauthorized')
      })
    })

    describe('validation', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({ user: { id: 'user-123' } })
      })

      it('returns 400 when guild_code is missing', async () => {
        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: 'Test assignment message'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toBe('Missing required fields')
      })

      it('returns 400 when content is missing', async () => {
        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toBe('Missing required fields')
      })
    })

    describe('webhook configuration', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({ user: { id: 'user-123' } })
      })

      it('returns 403 before webhook lookup when caller cannot manage the target guild', async () => {
        const { Errors } = await import('@/app/lib/errors/AppError')
        mockRequireGuildOfficerOrClusterLeader.mockRejectedValue(
          Errors.forbidden('Not allowed')
        )

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'VICTIM',
              content: '@everyone fake boss assignments'
            })
          }
        )

        const response = await POST(request)

        expect(response.status).toBe(403)
        expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
          mockSupabase,
          'user-123',
          'VICTIM',
          '/api/webhooks/post-assignments'
        )
        expect(mockSupabase.from).not.toHaveBeenCalled()
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('returns 404 when no webhook is configured', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test assignment message'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error.message).toContain('No Discord webhook configured')
      })

      it('returns 404 when webhook URL is null', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { webhook_url: null, enabled: true },
            error: null
          })
        })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test assignment message'
            })
          }
        )

        const response = await POST(request)

        expect(response.status).toBe(404)
      })

      it('returns 404 when webhook is disabled', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              webhook_url: 'https://discord.com/api/webhooks/123/abc',
              enabled: false
            },
            error: null
          })
        })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test assignment message'
            })
          }
        )

        const response = await POST(request)

        expect(response.status).toBe(404)
      })
    })

    describe('Discord posting', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({ user: { id: 'user-123' } })
      })

      it('posts to Discord and returns success', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              webhook_url: 'https://discord.com/api/webhooks/123/abc',
              enabled: true
            },
            error: null
          })
        })

        mockFetch.mockResolvedValue({
          ok: true
        })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content:
                '**Boss Assignments for Today**\n- Player1: Boss A\n- Player2: Boss B'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)

        expect(mockFetch).toHaveBeenCalledWith(
          'https://discord.com/api/webhooks/123/abc',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: expect.stringContaining('Boss Assignments for Today')
          })
        )
      })

      it('sends correct Discord webhook payload format', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              webhook_url: 'https://discord.com/api/webhooks/123/abc',
              enabled: true
            },
            error: null
          })
        })

        mockFetch.mockResolvedValue({ ok: true })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test message'
            })
          }
        )

        await POST(request)

        const fetchCall = mockFetch.mock.calls[0]
        const sentBody = JSON.parse(fetchCall[1].body)

        expect(sentBody).toMatchObject({
          content: 'Test message',
          username: 'Boss Assignment Manager'
        })
        expect(sentBody.avatar_url).toBeDefined()
      })

      it('returns 500 when Discord API fails', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              webhook_url: 'https://discord.com/api/webhooks/123/abc',
              enabled: true
            },
            error: null
          })
        })

        mockFetch.mockResolvedValue({
          ok: false,
          text: vi.fn().mockResolvedValue('Rate limited')
        })

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test message'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error.message).toContain('Failed to post to Discord')
      })

      it('aborts a hung Discord webhook request', async () => {
        vi.useFakeTimers()

        const pending = Symbol('pending')
        let rejectFetch: ((error: Error) => void) | undefined
        let responsePromise: Promise<Response> | undefined
        let result: Response | typeof pending | undefined

        try {
          mockSupabase.from.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/abc',
                enabled: true
              },
              error: null
            })
          })

          mockFetch.mockImplementation((_url, init?: RequestInit) => {
            return new Promise<Response>((_resolve, reject) => {
              rejectFetch = reject
              const signal = init?.signal
              signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true }
              )
            })
          })

          const request = new Request(
            'http://localhost/api/webhooks/post-assignments',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                guild_code: 'GUILD1',
                content: 'Test message'
              })
            }
          )

          responsePromise = POST(request)
          await vi.advanceTimersByTimeAsync(10_000)

          result = await Promise.race([
            responsePromise,
            Promise.resolve(pending)
          ])

          expect(result).not.toBe(pending)

          const response = result as Response
          const body = await response.json()

          expect(response.status).toBe(500)
          expect(body.error.message).toContain('Failed to post to Discord')
          expect(mockFetch).toHaveBeenCalledWith(
            'https://discord.com/api/webhooks/123/abc',
            expect.objectContaining({
              signal: expect.any(AbortSignal)
            })
          )
        } finally {
          if (result === pending) {
            rejectFetch?.(new Error('cleanup'))
            await responsePromise?.catch(() => undefined)
          }
          vi.useRealTimers()
        }
      })
    })

    describe('error handling', () => {
      it('returns 500 on unexpected errors', async () => {
        mockRequireAuth.mockRejectedValue(new Error('Auth service down'))

        const request = new Request(
          'http://localhost/api/webhooks/post-assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: 'GUILD1',
              content: 'Test'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error.message).toBe('Internal server error')
      })
    })
  })
})

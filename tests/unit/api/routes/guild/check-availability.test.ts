import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('GET /api/guild/check-availability', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: { error: vi.fn(), debug: vi.fn(), info: vi.fn() }
    }))

    mockSupabase = {
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/guild/check-availability/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when guild_code is missing', async () => {
      const request = new Request(
        'http://localhost/api/guild/check-availability'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Guild code is required')
    })

    it('returns 400 for invalid guild code format - too short', async () => {
      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=A'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid guild code format')
    })

    it('returns 400 for invalid guild code format - too long', async () => {
      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=ABCDEFGH'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid guild code format')
    })

    it('returns 400 for invalid guild code format - contains numbers', async () => {
      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=ABC123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid guild code format')
    })

    it('normalizes guild code to uppercase', async () => {
      mockSupabase.rpc.mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { exists: false, can_resume: false },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=test'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'check_guild_registration_status',
        {
          guild_code_param: 'TEST'
        }
      )
      expect(body.guild_code).toBe('TEST')
    })
  })

  describe('availability check', () => {
    it('returns available=true when guild does not exist', async () => {
      mockSupabase.rpc.mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { exists: false, can_resume: false },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=NEWGLD'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.available).toBe(true)
      expect(body.can_resume).toBe(false)
      expect(body.guild_code).toBe('NEWGLD')
    })

    it('returns available=false when guild exists and cannot resume', async () => {
      mockSupabase.rpc.mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            exists: true,
            can_resume: false,
            registration_status: 'completed',
            registration_age_hours: 100
          },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=EXIST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.available).toBe(false)
      expect(body.can_resume).toBe(false)
      expect(body.registration_status).toBe('completed')
    })

    it('returns available=true when guild exists but can resume', async () => {
      mockSupabase.rpc.mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            exists: true,
            can_resume: true,
            registration_status: 'incomplete',
            registration_age_hours: 2
          },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=RESUME'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.available).toBe(true)
      expect(body.can_resume).toBe(true)
      expect(body.registration_status).toBe('incomplete')
      expect(body.registration_age_hours).toBe(2)
    })
  })

  describe('error handling', () => {
    it('returns 500 when database error occurs', async () => {
      mockSupabase.rpc.mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' }
        })
      })

      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=ERROR'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Database error')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.rpc.mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      const request = new Request(
        'http://localhost/api/guild/check-availability?guild_code=CRASH'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Internal server error')
      expect(body.error.metadata?.details).toBe('Unexpected error')
    })
  })
})

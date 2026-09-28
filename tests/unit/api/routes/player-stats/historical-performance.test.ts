import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockRequireActiveMembershipForApi: ReturnType<typeof vi.fn>
let mockFetchHistoricalPerformance: ReturnType<typeof vi.fn>
let mockLogger: {
  error: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
}
let consoleLogSpy: ReturnType<typeof vi.spyOn>

/** The auth gate runs BEFORE parameter validation, or an anonymous caller learns which combinations are valid. */
describe('GET /api/player-stats/historical-performance', () => {
  let GET: (request: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockDb = vi.fn()
    mockFetchHistoricalPerformance = vi.fn()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockLogger = {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    }
    mockRequireActiveMembershipForApi = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'member', guild_code: 'TESTGLD' }
    })

    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireActiveMembershipForApi: mockRequireActiveMembershipForApi
      }
    })

    vi.doMock('@/app/lib/player-stats/fetchHistoricalPerformance', () => ({
      fetchHistoricalPerformance: mockFetchHistoricalPerformance
    }))

    vi.doMock('@/app/lib/logging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/app/lib/logging')>()
      return {
        ...actual,
        createComponentLogger: vi.fn(() => mockLogger)
      }
    })

    mockDb.mockResolvedValue({})
    mockFetchHistoricalPerformance.mockResolvedValue({ seasons: [] })

    const routeModule =
      await import('@/app/api/player-stats/historical-performance/route')
    GET = routeModule.GET
  })

  describe('authorization', () => {
    it('rejects an unauthenticated caller with 401 before validating params', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      mockRequireActiveMembershipForApi.mockRejectedValue(
        new AuthError('Authentication required', 'UNAUTHENTICATED')
      )

      // A 400 would mean validation runs before the gate.
      const request = new Request(
        'http://localhost/api/player-stats/historical-performance'
      )

      const response = await GET(request)

      expect(response.status).toBe(401)
      expect(mockDb).not.toHaveBeenCalled()
      expect(mockFetchHistoricalPerformance).not.toHaveBeenCalled()
    })

    it('rejects a logged-in user without a current membership', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      mockRequireActiveMembershipForApi.mockRejectedValue(
        new AuthError(
          'Current guild membership required',
          'ONBOARDING_REQUIRED'
        )
      )

      const request = new Request(
        'http://localhost/api/player-stats/historical-performance?player=P&guild_code=TESTGLD&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      expect(mockFetchHistoricalPerformance).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('still returns 400 for missing params once authenticated', async () => {
      const request = new Request(
        'http://localhost/api/player-stats/historical-performance?player=P'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(JSON.stringify(body).toLowerCase()).toMatch(
        /player|guild_code|season|required/
      )
    })
  })

  describe('successful queries', () => {
    it('returns the fetched payload for an authenticated member', async () => {
      mockFetchHistoricalPerformance.mockResolvedValue({ seasons: [1, 2] })

      const request = new Request(
        'http://localhost/api/player-stats/historical-performance?player=P&guild_code=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ seasons: [1, 2] })
      expect(consoleLogSpy).not.toHaveBeenCalled()

      const logged = JSON.stringify(mockLogger.debug.mock.calls)
      expect(logged).not.toContain('TESTGLD')
      expect(logged).not.toContain('"P"')
    })
  })
})

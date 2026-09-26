import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

describe('GET /api/upcoming/historical-performance', () => {
  let GET: typeof import('@/app/api/upcoming/historical-performance/route').GET
  let mockRequireAuthForApi: ReturnType<typeof vi.fn>
  let mockGetComprehensiveHistoricalPerformance: ReturnType<typeof vi.fn>
  let mockCreateError: ReturnType<typeof vi.fn>
  let mockFormatErrorForUser: ReturnType<typeof vi.fn>
  let mockGetVersionInfo: ReturnType<typeof vi.fn>
  let mockDb: ReturnType<typeof vi.fn>
  let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuthForApi = vi.fn()
    mockGetComprehensiveHistoricalPerformance = vi.fn()
    mockCreateError = vi.fn((code: string, message: string) => ({
      code,
      message,
      supportMessage: 'support'
    }))
    mockFormatErrorForUser = vi.fn(
      (error: { code: string; message: string; supportMessage?: string }) => ({
        code: error.code,
        message: error.message,
        supportMessage: error.supportMessage
      })
    )
    mockGetVersionInfo = vi.fn(() => ({ version: 'test' }))
    mockDb = vi.fn().mockResolvedValue({})
    mockRequireGuildOfficerOrClusterLeader = vi
      .fn()
      .mockResolvedValue(undefined)

    vi.doMock('@/app/lib/auth', () => ({
      requireRoleForApi: mockRequireAuthForApi,
      AuthError: class AuthError extends Error {
        code: string
        constructor(message: string, code: string) {
          super(message)
          this.code = code
        }
      }
    }))
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))
    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildOfficerOrClusterLeader: mockRequireGuildOfficerOrClusterLeader
    }))
    vi.doMock('@/app/lib/data/historical-boss-performance', () => ({
      getComprehensiveHistoricalPerformance:
        mockGetComprehensiveHistoricalPerformance
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: { error: vi.fn() }
    }))
    vi.doMock('@tacticus/app-core/error-handler', () => ({
      createError: mockCreateError,
      formatErrorForUser: mockFormatErrorForUser,
      getVersionInfo: mockGetVersionInfo
    }))
    ;({ GET } = await import('@/app/api/upcoming/historical-performance/route'))
  })

  it('returns 403 when role is insufficient', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    mockRequireAuthForApi.mockRejectedValue(
      new AuthError(
        'Insufficient permissions. Required: officer, Current: member',
        'INSUFFICIENT_ROLE'
      )
    )

    const request = new NextRequest(
      'http://localhost/api/upcoming/historical-performance'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('Insufficient permissions')
    expect(body.error.metadata).toEqual({ code: 'INSUFFICIENT_ROLE' })
  })

  it('returns 400 when guild code is missing', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'leader', guild_code: null }
    })

    const request = new NextRequest(
      'http://localhost/api/upcoming/historical-performance'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Guild code is required')
    expect(body.error.code).toBe(2001)
  })

  it('returns performance data for authorized users', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'officer', guild_code: 'ABC' }
    })
    mockGetComprehensiveHistoricalPerformance.mockResolvedValue({
      guildCode: 'ABC',
      seasons: []
    })

    const request = new NextRequest(
      'http://localhost/api/upcoming/historical-performance'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.guildCode).toBe('ABC')
    expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
      {},
      'user-1',
      'ABC',
      '/api/upcoming/historical-performance'
    )
  })

  it('returns 500 when data fetch fails', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'officer', guild_code: 'ABC' }
    })
    mockGetComprehensiveHistoricalPerformance.mockRejectedValue(
      new Error('boom')
    )

    const request = new NextRequest(
      'http://localhost/api/upcoming/historical-performance?guild_code=ABC'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to fetch historical per')
    expect(body.error.code).toBe(5001)
  })
})

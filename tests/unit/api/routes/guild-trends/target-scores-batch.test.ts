import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

describe('GET /api/guild-trends/target-scores-batch', () => {
  let GET: typeof import('@/app/api/guild-trends/target-scores-batch/route').GET
  let mockRequireActiveMembershipForApi: ReturnType<typeof vi.fn>
  let mockGetTargetScoresBatch: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireActiveMembershipForApi = vi.fn()
    mockGetTargetScoresBatch = vi.fn()

    vi.doMock('@/app/lib/auth', () => ({
      requireActiveMembershipForApi: mockRequireActiveMembershipForApi,
      AuthError: class AuthError extends Error {
        code: string
        constructor(message: string, code: string) {
          super(message)
          this.code = code
        }
      }
    }))
    vi.doMock('@/app/lib/guild-trends/target-scores-batch', () => ({
      getTargetScoresBatch: mockGetTargetScoresBatch
    }))
    vi.doMock('@sentry/nextjs', () => ({
      captureException: vi.fn(),
      setTag: vi.fn()
    }))
    ;({ GET } =
      await import('@/app/api/guild-trends/target-scores-batch/route'))
  })

  it('uses the authenticated profile guild when guild is omitted', async () => {
    mockRequireActiveMembershipForApi.mockResolvedValue({
      profile: { guild_code: 'abc' }
    })
    mockGetTargetScoresBatch.mockResolvedValue([
      { season: '101', user_id: 'player-1', weighted_score: 1.1 }
    ])

    const response = await GET(
      new NextRequest(
        'http://localhost/api/guild-trends/target-scores-batch?seasons=101'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.rows).toEqual([
      { season: '101', user_id: 'player-1', weighted_score: 1.1 }
    ])
    expect(mockGetTargetScoresBatch).toHaveBeenCalledWith('ABC', ['101'])
  })

  it('allows an explicit guild only when it matches the caller guild', async () => {
    mockRequireActiveMembershipForApi.mockResolvedValue({
      profile: { guild_code: 'ABC' }
    })
    mockGetTargetScoresBatch.mockResolvedValue([])

    const response = await GET(
      new NextRequest(
        'http://localhost/api/guild-trends/target-scores-batch?guild=abc&seasons=101,100'
      )
    )

    expect(response.status).toBe(200)
    expect(mockGetTargetScoresBatch).toHaveBeenCalledWith('ABC', ['101', '100'])
  })

  it('rejects a guild query for a different guild', async () => {
    mockRequireActiveMembershipForApi.mockResolvedValue({
      profile: { guild_code: 'ABC' }
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/guild-trends/target-scores-batch?guild=OTHER&seasons=101'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Access denied for requested guild')
    expect(mockGetTargetScoresBatch).not.toHaveBeenCalled()
  })

  it('returns 400 when the authenticated profile has no guild', async () => {
    mockRequireActiveMembershipForApi.mockResolvedValue({
      profile: { guild_code: null }
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/guild-trends/target-scores-batch?seasons=101'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Missing guild code')
    expect(mockGetTargetScoresBatch).not.toHaveBeenCalled()
  })

  it('denies an inactive former member before a warm cache can be read', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    mockRequireActiveMembershipForApi.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )

    const response = await GET(
      new NextRequest(
        'http://localhost/api/guild-trends/target-scores-batch?seasons=101'
      )
    )

    expect(response.status).toBe(403)
    expect(mockGetTargetScoresBatch).not.toHaveBeenCalled()
  })
})

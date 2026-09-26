import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: vi.fn((handler) => handler)
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: vi.fn()
}))

describe('GET /api/season/timing', () => {
  let getSeasonTiming: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const module = await import('@/app/lib/services/season-timing-service')
    getSeasonTiming = vi.mocked(module.getSeasonTiming)
  })

  function makeRequest(params: Record<string, string> = {}) {
    const url = new URL('http://localhost:3000/api/season/timing')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return new NextRequest(url)
  }

  const mockTimingData = {
    seasonNumber: 50,
    seasonStart: 1700000000000,
    seasonEnd: 1701000000000,
    nextSeasonStart: 1701100000000,
    isInGap: false,
    hasEnded: false,
    hoursElapsed: 10,
    seasonActiveMs: 1000000,
    seasonGapMs: 86400000,
    source: 'hardcoded-fallback' as const,
    constants: {
      firstSeasonStartMs: 1646128800000,
      seasonCycleSeconds: 1209600,
      seasonGapSeconds: 86400
    },
    divergence: null
  }

  it('returns 400 when season param is not a number', async () => {
    const { GET } = await import('@/app/api/season/timing/route')
    const response = await GET(makeRequest({ season: 'notanumber' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when season param is zero', async () => {
    const { GET } = await import('@/app/api/season/timing/route')
    const response = await GET(makeRequest({ season: '0' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when season param is negative', async () => {
    const { GET } = await import('@/app/api/season/timing/route')
    const response = await GET(makeRequest({ season: '-1' }))
    expect(response.status).toBe(400)
  })

  it('returns 200 with timing data for valid season param', async () => {
    getSeasonTiming.mockResolvedValue(mockTimingData)
    const { GET } = await import('@/app/api/season/timing/route')
    const response = await GET(makeRequest({ season: '50' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.seasonNumber).toBe(50)
  })

  it('returns 200 with cache headers', async () => {
    getSeasonTiming.mockResolvedValue(mockTimingData)
    const { GET } = await import('@/app/api/season/timing/route')
    const response = await GET(makeRequest({ season: '50' }))
    expect(response.status).toBe(200)
    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('s-maxage=')
  })

  it('works without season param (infers current season)', async () => {
    getSeasonTiming.mockResolvedValue(mockTimingData)
    const { GET } = await import('@/app/api/season/timing/route')
    const response = await GET(makeRequest())
    expect(response.status).toBe(200)
  })
})

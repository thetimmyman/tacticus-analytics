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

describe('Integration: GET /api/season/timing', () => {
  let getSeasonTiming: ReturnType<typeof vi.fn>

  const FROZEN_NOW = new Date('2026-04-03T00:00:00.000Z').getTime()

  const DETERMINISTIC_RESPONSE = {
    seasonNumber: 50,
    seasonStart: 1740000000000,
    seasonEnd: 1741000000000,
    nextSeasonStart: 1741100000000,
    isInGap: false,
    hasEnded: false,
    hoursElapsed: 100,
    seasonActiveMs: 1123200000,
    seasonGapMs: 86400000,
    source: 'loki-globalconfig' as const,
    constants: {
      firstSeasonStartMs: 1646128800000,
      seasonCycleSeconds: 1209600,
      seasonGapSeconds: 86400
    },
    divergence: null
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
    const module = await import('@/app/lib/services/season-timing-service')
    getSeasonTiming = vi.mocked(module.getSeasonTiming)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('with frozen time, response JSON is deterministic across calls', async () => {
    getSeasonTiming.mockResolvedValue(DETERMINISTIC_RESPONSE)
    const { GET } = await import('@/app/api/season/timing/route')

    const req1 = new NextRequest(
      'http://localhost:3000/api/season/timing?season=50'
    )
    const req2 = new NextRequest(
      'http://localhost:3000/api/season/timing?season=50'
    )

    const [r1, r2] = await Promise.all([GET(req1), GET(req2)])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    const [b1, b2] = await Promise.all([r1.json(), r2.json()])
    expect(b1).toEqual(b2)
  })

  it('response includes correct cache headers', async () => {
    getSeasonTiming.mockResolvedValue(DETERMINISTIC_RESPONSE)
    const { GET } = await import('@/app/api/season/timing/route')
    const req = new NextRequest(
      'http://localhost:3000/api/season/timing?season=50'
    )
    const response = await GET(req)

    expect(response.status).toBe(200)
    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).not.toBeNull()
    expect(cacheControl).toMatch(/s-maxage=\d+/)
    expect(cacheControl).toContain('stale-while-revalidate')
  })

  it('response body matches expected shape', async () => {
    getSeasonTiming.mockResolvedValue(DETERMINISTIC_RESPONSE)
    const { GET } = await import('@/app/api/season/timing/route')
    const req = new NextRequest(
      'http://localhost:3000/api/season/timing?season=50'
    )
    const response = await GET(req)
    const body = await response.json()

    expect(body.seasonNumber).toBe(50)
    expect(typeof body.seasonStart).toBe('number')
    expect(typeof body.seasonEnd).toBe('number')
    expect(typeof body.isInGap).toBe('boolean')
    expect(typeof body.hasEnded).toBe('boolean')
    expect(body.constants).toBeDefined()
  })
})

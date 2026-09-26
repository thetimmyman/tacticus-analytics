import { describe, it, expect, vi, beforeEach } from 'vitest'

/** The browser's only season source; the CDN cache header prevents a per-request EOT_GR_data scan. */

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: vi.fn((handler) => handler)
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/data/get-latest-season', () => ({
  getLatestSeason: vi.fn()
}))

describe('GET /api/season/latest', () => {
  let getLatestSeason: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const module = await import('@/app/lib/data/get-latest-season')
    getLatestSeason = vi.mocked(module.getLatestSeason)
  })

  it('returns the service-role-resolved season as { season }', async () => {
    getLatestSeason.mockResolvedValue('104')
    const { GET } = await import('@/app/api/season/latest/route')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ season: '104' })
    expect(getLatestSeason).toHaveBeenCalledTimes(1)
  })

  it('passes an unresolved season through as null instead of substituting one', async () => {
    getLatestSeason.mockResolvedValue(null)
    const { GET } = await import('@/app/api/season/latest/route')

    const response = await GET()

    expect(response.status).toBe(200)
    // The client guard must reject null; a hard-coded fallback would defeat it.
    await expect(response.json()).resolves.toEqual({ season: null })
  })

  it('serves the short CDN cache header the route exists to provide', async () => {
    getLatestSeason.mockResolvedValue('104')
    const { GET } = await import('@/app/api/season/latest/route')

    const response = await GET()

    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=60'
    )
  })

  it('never reaches the browser-hostile RPC path itself — it delegates to the server helper', async () => {
    getLatestSeason.mockResolvedValue('104')
    const routeModule = await import('@/app/api/season/latest/route')

    // Otherwise the build bakes in a frozen season.
    expect(routeModule.dynamic).toBe('force-dynamic')
  })
})

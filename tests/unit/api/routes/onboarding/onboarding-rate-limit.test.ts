import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Global setup neutralizes apiSecurityMiddleware; opt back in to exercise real limits.
vi.unmock('@/app/lib/middleware/api-security-middleware')

const mockGetUser = vi.fn()

describe('onboarding/* API route rate limiting', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: vi.fn(async () => ({
        auth: { getUser: mockGetUser }
      })),
      createServiceClient: vi.fn()
    }))
  })

  it.each([
    [
      '/api/onboarding/guild/start',
      10,
      '192.0.2.51',
      () => import('@/app/api/onboarding/guild/start/route')
    ],
    [
      '/api/onboarding/data-sync/start',
      10,
      '192.0.2.52',
      () => import('@/app/api/onboarding/data-sync/start/route')
    ],
    [
      '/api/onboarding/cluster/add-guild',
      10,
      '192.0.2.53',
      () => import('@/app/api/onboarding/cluster/add-guild/route')
    ],
    [
      '/api/onboarding/cluster/requeue-guild',
      10,
      '192.0.2.54',
      () => import('@/app/api/onboarding/cluster/requeue-guild/route')
    ],
    [
      '/api/onboarding/complete-via-invite',
      20,
      '192.0.2.55',
      () => import('@/app/api/onboarding/complete-via-invite/route')
    ],
    [
      '/api/onboarding/start',
      20,
      '192.0.2.56',
      () => import('@/app/api/onboarding/start/route')
    ]
  ])(
    'rate-limits POST %s after %d calls before session lookup',
    async (pathname, limit, ip, loadRoute) => {
      const { POST } = await loadRoute()
      const makeReq = () =>
        new NextRequest(`https://tacticusanalytics.com${pathname}`, {
          method: 'POST',
          headers: {
            'cf-connecting-ip': ip,
            'content-type': 'application/json'
          },
          body: JSON.stringify({})
        })

      for (let i = 0; i < limit; i += 1) {
        const res = await POST(makeReq())
        expect(res.status).toBe(401)
      }

      const callsBeforeLimit = mockGetUser.mock.calls.length
      const limited = await POST(makeReq())

      expect(limited.status).toBe(429)
      expect(limited.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(mockGetUser.mock.calls.length).toBe(callsBeforeLimit)
    }
  )
})

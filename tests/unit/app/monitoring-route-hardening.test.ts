// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PRIMARY_DSN =
  'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@example.sentry.io/123456'
const ALLOWED_ORIGIN = 'https://www.tacticusanalytics.com'

const rateLimitAllowed = vi.hoisted(() => ({
  allowed: true,
  remaining: 10,
  resetTime: Date.now() + 60_000,
  headers: {}
}))

const checkRateLimitMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/middleware/rate-limit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/middleware/rate-limit')>()
  return { ...actual, checkRateLimit: checkRateLimitMock }
})

const createEnvelopePayload = () =>
  [
    '{"dsn":"https://legacy-key@example.invalid/1","sent_at":"2026-02-13T00:00:00.000Z"}',
    '{"type":"event"}',
    '{"message":"monitoring guard test"}'
  ].join('\n')

describe('/monitoring tunnel hardening', () => {
  let POST: (request: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    delete process.env.GLITCHTIP_DSN
    delete process.env.NEXT_PUBLIC_GLITCHTIP_DSN
    vi.stubEnv('SENTRY_DSN', PRIMARY_DSN)
    checkRateLimitMock.mockReset()
    checkRateLimitMock.mockResolvedValue(rateLimitAllowed)

    const routeModule = await import('@/app/monitoring/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const post = (headers: Record<string, string>) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: new Headers() } as Response)
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    return {
      fetchMock,
      response: POST(
        new Request('https://tacticusanalytics.com/monitoring', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-sentry-envelope',
            ...headers
          },
          body: createEnvelopePayload()
        })
      )
    }
  }

  it('rejects a prefix-bypass Origin without forwarding', async () => {
    const { fetchMock, response } = post({
      origin: 'https://www.tacticusanalytics.com.evil.example'
    })

    expect((await response).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an opaque null Origin', async () => {
    const { fetchMock, response } = post({ origin: 'null' })

    expect((await response).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a request with neither Origin nor Referer', async () => {
    const { fetchMock, response } = post({})

    expect((await response).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a same-origin Referer when Origin is absent', async () => {
    const { fetchMock, response } = post({
      referer: `${ALLOWED_ORIGIN}/home`
    })

    expect((await response).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a cross-site Referer when Origin is absent', async () => {
    const { fetchMock, response } = post({
      referer: 'https://evil.example/home'
    })

    expect((await response).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards an allowlisted Origin', async () => {
    const { fetchMock, response } = post({ origin: ALLOWED_ORIGIN })

    expect((await response).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 429 with Retry-After when the per-IP limiter denies', async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 30_000,
      reason: 'Rate limit exceeded',
      headers: {}
    })
    const { fetchMock, response } = post({ origin: ALLOWED_ORIGIN })

    const result = await response
    expect(result.status).toBe(429)
    expect(Number(result.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keys the limiter on the canonical client IP', async () => {
    const { response } = post({
      origin: ALLOWED_ORIGIN,
      'cf-connecting-ip': '203.0.113.9'
    })
    await response

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      'ip:203.0.113.9',
      '/monitoring'
    )
  })
})

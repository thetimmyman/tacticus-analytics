import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const checkRateLimitMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/middleware/rate-limit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/middleware/rate-limit')>()
  return { ...actual, checkRateLimit: checkRateLimitMock }
})

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn(() => ({ from: vi.fn() }))
}))

describe('/api/discord-webhooks/new-member rate limiting', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'test-webhook-secret')
    vi.stubEnv('DISABLE_DISCORD_NEW_MEMBER_WEBHOOK', 'false')
    checkRateLimitMock.mockReset()
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 11,
      resetTime: Date.now() + 60_000,
      headers: {}
    })

    const routeModule =
      await import('@/app/api/discord-webhooks/new-member/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const request = () =>
    new NextRequest('http://localhost/api/discord-webhooks/new-member', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': 'test-webhook-secret',
        'cf-connecting-ip': '203.0.113.77'
      },
      body: JSON.stringify({
        playerData: { displayName: 'Test', guildCode: 'TEST' }
      })
    })

  it('consults the shared limiter on the canonical client IP', async () => {
    await POST(request())

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      'ip:203.0.113.77',
      '/api/discord-webhooks/new-member'
    )
  })

  it('returns 429 instead of forwarding when the limiter denies', async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      reason: 'Rate limit exceeded',
      headers: {}
    })

    const response = await POST(request())

    expect(response.status).toBe(429)
  })
})

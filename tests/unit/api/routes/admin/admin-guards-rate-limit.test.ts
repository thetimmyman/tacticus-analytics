import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The global setup neutralizes apiSecurityMiddleware; this suite opts back in.
vi.unmock('@/app/lib/middleware/api-security-middleware')

describe('withAdminGuards rate limiting', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function loadWrapper(authorize: () => Promise<void>) {
    vi.doMock('@/app/lib/auth/app-admin', () => ({
      requireAppAdminForApi: vi.fn(async () => {
        await authorize()
        return { user: { id: 'admin-1' }, profile: { is_app_admin: true } }
      }),
      requireCurrentAppAdminForApi: vi.fn(),
      isAppAdminProfile: () => true
    }))
    return import('@/app/api/admin/_lib/with-admin-guards')
  }

  function adminRequest(ip: string) {
    return new NextRequest(
      'https://tacticusanalytics.com/api/admin/users/search',
      { method: 'GET', headers: { 'cf-connecting-ip': ip } }
    )
  }

  it('allows 10 calls in the window and rejects the 11th with 429', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const { withAdminGuards } = await loadWrapper(async () => undefined)
    const GET = withAdminGuards({ guard: 'app-admin' }, handler)

    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    const statuses: number[] = []
    for (let i = 0; i < 11; i += 1) {
      const response = await GET(adminRequest(ip))
      statuses.push(response.status)
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)

    expect(handler).toHaveBeenCalledTimes(10)

    const rejected = await GET(adminRequest(ip))
    expect(rejected.status).toBe(429)
    expect(await rejected.json()).toMatchObject({
      error: { message: 'Rate limit exceeded' }
    })
  })

  it('counts a different client separately', async () => {
    const { withAdminGuards } = await loadWrapper(async () => undefined)
    const GET = withAdminGuards({ guard: 'app-admin' }, async () =>
      NextResponse.json({ ok: true })
    )

    const noisy = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const quiet = `198.51.100.${Math.floor(Math.random() * 50) + 201}`
    for (let i = 0; i < 11; i += 1) {
      await GET(adminRequest(noisy))
    }

    expect((await GET(adminRequest(noisy))).status).toBe(429)
    expect((await GET(adminRequest(quiet))).status).toBe(200)
  })

  it('rejects over the limit before resolving the caller', async () => {
    const authorize = vi.fn(async () => undefined)
    const { withAdminGuards } = await loadWrapper(authorize)
    const GET = withAdminGuards({ guard: 'app-admin' }, async () =>
      NextResponse.json({ ok: true })
    )

    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`
    for (let i = 0; i < 11; i += 1) {
      await GET(adminRequest(ip))
    }
    const callsWhenLimited = authorize.mock.calls.length

    await GET(adminRequest(ip))

    // Once exhausted, the guard is never reached, so the auth call is not an amplifier.
    expect(authorize.mock.calls.length).toBe(callsWhenLimited)
  })
})

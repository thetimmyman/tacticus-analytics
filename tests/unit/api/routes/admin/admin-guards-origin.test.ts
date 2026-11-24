import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The global setup neutralizes apiSecurityMiddleware; this suite opts back in.
vi.unmock('@/app/lib/middleware/api-security-middleware')

const EMPTY_CORPUS = new TextEncoder().encode('{}')

describe('withAdminGuards cross-site origin rejection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function loadWrapper() {
    vi.doMock('@/app/lib/auth/app-admin', () => ({
      requireAppAdminForApi: vi.fn(async () => ({
        user: { id: 'admin-1' },
        profile: { is_app_admin: true }
      })),
      requireCurrentAppAdminForApi: vi.fn(),
      isAppAdminProfile: () => true
    }))
    return import('@/app/api/admin/_lib/with-admin-guards')
  }

  function request(method: string, origin?: string) {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.42' })
    if (origin !== undefined) headers.set('origin', origin)
    return new NextRequest(
      'https://tacticusanalytics.com/api/admin/users/search',
      { method, headers, body: method === 'GET' ? undefined : EMPTY_CORPUS }
    )
  }

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects a prefix-bypass Origin on %s before the handler runs',
    async (method) => {
      const { withAdminGuards } = await loadWrapper()
      const handler = vi.fn(async () => NextResponse.json({ ok: true }))
      const wrapped = withAdminGuards({ guard: 'app-admin' }, handler)

      const response = await wrapped(
        request(method, 'https://tacticusanalytics.com.evil.example')
      )

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.metadata?.reason).toBe('cross_site_origin')
      expect(handler).not.toHaveBeenCalled()
    }
  )

  it('rejects an opaque null Origin on a state-changing request', async () => {
    const { withAdminGuards } = await loadWrapper()
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withAdminGuards({ guard: 'app-admin' }, handler)

    const response = await wrapped(request('POST', 'null'))

    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('allows a state-changing request from an allowlisted origin', async () => {
    const { withAdminGuards } = await loadWrapper()
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withAdminGuards({ guard: 'app-admin' }, handler)

    const response = await wrapped(
      request('POST', 'https://www.tacticusanalytics.com')
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('allows an origin-less server-to-server state change', async () => {
    const { withAdminGuards } = await loadWrapper()
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withAdminGuards({ guard: 'app-admin' }, handler)

    const response = await wrapped(request('POST'))

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not apply the origin check to a read-only GET', async () => {
    const { withAdminGuards } = await loadWrapper()
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withAdminGuards({ guard: 'app-admin' }, handler)

    const response = await wrapped(
      request('GET', 'https://tacticusanalytics.com.evil.example')
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextResponse, type NextRequest } from 'next/server'

import { withCache, clearCache } from '@/app/lib/middleware/api-cache'

const buildRequest = (
  init: { url?: string; headers?: Headers; method?: string } = {}
) => {
  const {
    url = 'http://localhost/api/test',
    headers = new Headers(),
    method = 'GET'
  } = init

  return {
    method,
    url,
    headers
  } as unknown as NextRequest
}

describe('withCache middleware', () => {
  beforeEach(() => {
    clearCache()
    vi.clearAllMocks()
  })

  it('bypasses caching when request includes authentication headers', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const cachedHandler = withCache(handler)
    const req = buildRequest({
      headers: new Headers({ cookie: 'session=abc' })
    })

    await cachedHandler(req)
    await cachedHandler(req)

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('returns cached response for unauthenticated requests', async () => {
    const handler = vi.fn(async () =>
      NextResponse.json({ timestamp: Date.now() })
    )
    const cachedHandler = withCache(handler)
    const req = buildRequest({ url: 'http://localhost/api/public' })

    const firstResponse = await cachedHandler(req)
    const firstBody = (await firstResponse.clone().json()) as {
      timestamp: number
    }

    const secondResponse = await cachedHandler(req)
    const secondBody = (await secondResponse.clone().json()) as {
      timestamp: number
    }

    expect(handler).toHaveBeenCalledTimes(1)
    expect(secondResponse.headers.get('X-Cache')).toBe('HIT')
    expect(secondBody.timestamp).toBe(firstBody.timestamp)
  })

  it('does not cache responses that set cookies', async () => {
    const handler = vi.fn(async () => {
      const response = NextResponse.json({ ok: true })
      response.headers.set('set-cookie', 'session=abc; HttpOnly')
      return response
    })

    const cachedHandler = withCache(handler)
    const req = buildRequest({ url: 'http://localhost/api/cookie' })

    await cachedHandler(req)
    await cachedHandler(req)

    expect(handler).toHaveBeenCalledTimes(2)
  })
})

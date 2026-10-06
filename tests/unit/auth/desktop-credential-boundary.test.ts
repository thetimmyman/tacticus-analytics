import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'

const paths = [
  '/api/player-api-key',
  '/api/player-api-key/sync',
  '/api/admin/player-api-key',
  '/api/validate-api-key',
  '/api/player/test-api-key',
  '/api/guild/test-api-key',
  '/api/guild/validate-api-key',
  '/api/guild/update-api-key',
  '/api/guild/replace-api-key',
  '/api/members/request-api-key',
  '/api/profile/change-player-id',
  '/api/onboarding/validate-player-key',
  '/api/onboarding/claim/consume',
  '/api/player-api-key/'
]
let transport: string
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  transport = randomBytes(32).toString('hex')
  vi.stubEnv('DESKTOP_TRANSPORT_KEY', transport)
})
afterEach(() => vi.unstubAllEnvs())

describe('desktop credential transport boundary', () => {
  it.each(paths)(
    'refuses %s without reading the renderer body',
    async (path) => {
      const { default: proxy } = await import('@/proxy')
      const request = new NextRequest('http://127.0.0.1:54321' + path, {
        method: 'POST',
        headers: { 'x-desktop-transport': transport },
        body: JSON.stringify({ apiKey: 'synthetic-renderer-key' })
      })
      const read = vi.spyOn(request, 'json')
      const response = await proxy(request)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: 'Use File → Game connection for native credential operations.'
      })
      expect(read).not.toHaveBeenCalled()
      expect(request.bodyUsed).toBe(false)
    }
  )
  it('checks transport before credential guidance and removes onboarding query input from redirects', async () => {
    const { default: proxy } = await import('@/proxy')
    const forged = await proxy(
      new NextRequest('http://127.0.0.1:54321/api/player-api-key')
    )
    expect(forged.status).toBe(403)
    const response = await proxy(
      new NextRequest(
        'http://127.0.0.1:54321/onboarding/dashboard?key=synthetic-input',
        {
          headers: { 'x-desktop-transport': transport }
        }
      )
    )
    expect(response.status).toBe(307)
    const destination = new URL(response.headers.get('location')!)
    expect(destination.pathname).toBe('/desktop/connection-help')
    expect(destination.search).toBe('')
    expect(destination.port).toBe('54321')
  })
  it.each(paths.slice(0, -1))(
    'preserves hosted route dispatch for %s',
    async (path) => {
      vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
      const { default: proxy } = await import('@/proxy')
      const response = await proxy(
        new NextRequest('https://example.invalid' + path, { method: 'POST' })
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
    }
  )
})

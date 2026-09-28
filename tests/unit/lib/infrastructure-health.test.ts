import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tacticus/app-core/daily-alert-summary', () => ({
  addDatabaseAlert: vi.fn(),
  addInfrastructureAlert: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  db: {},
  serviceDb: {}
}))

import {
  checkCloudflaredTunnel,
  checkNginxRouting
} from '@/app/lib/health/infrastructure-health'

describe('checkCloudflaredTunnel', () => {
  beforeEach(() => {
    process.env.SELF_HOSTED = 'true'
    process.env.CLOUDFLARE_TUNNEL_TOKEN = 'configured'
    delete process.env.CLOUDFLARED_HEALTH_URL
  })

  afterEach(() => {
    delete process.env.SELF_HOSTED
    delete process.env.CLOUDFLARE_TUNNEL_TOKEN
    delete process.env.CLOUDFLARED_HEALTH_URL
    vi.restoreAllMocks()
  })

  it('leaves the optional readiness probe unchecked when no URL is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(checkCloudflaredTunnel()).resolves.toEqual({
      healthy: true,
      checked: false
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('self-hosted probes are an explicit opt-in', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
    vi.restoreAllMocks()
  })

  it('skips the nginx probe for a loopback Supabase URL without the flag', async () => {
    delete process.env.SELF_HOSTED
    delete process.env.DEPLOYMENT_ENV
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(checkNginxRouting(false)).resolves.toEqual({
      healthy: true,
      checked: false
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('runs the nginx probe when DEPLOYMENT_ENV=self-hosted', async () => {
    delete process.env.SELF_HOSTED
    process.env.DEPLOYMENT_ENV = 'self-hosted'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('ok', { status: 200 }))

    const result = await checkNginxRouting(false)
    expect(result.checked).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
  })
})

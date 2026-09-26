import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tacticus/app-core/daily-alert-summary', () => ({
  addDatabaseAlert: vi.fn(),
  addInfrastructureAlert: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  db: {},
  serviceDb: {}
}))

import { checkCloudflaredTunnel } from '@/app/lib/health/infrastructure-health'

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

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const hash = 'a'.repeat(32)
const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  download: vi.fn(),
  notify: vi.fn(),
  clear: vi.fn()
}))

vi.mock('@/app/lib/loki/global-config-refresh', () => ({
  readEffectiveGlobalConfig: () => ({
    configVersion: 'a'.repeat(32),
    raw: { configVersion: 'a'.repeat(32) }
  }),
  discoverLatestHash: mocks.discover,
  fetchGlobalConfig: mocks.download,
  postDiscordWebhook: mocks.notify
}))
vi.mock('@/app/lib/db', () => ({ serviceDb: () => null }))
vi.mock('@/app/lib/loki/season-configs', () => ({
  prettyBossName: (value: string) => value
}))
vi.mock('@/app/lib/loki/alert-dedup', () => ({
  clearGlobalConfigAlertState: mocks.clear,
  claimGlobalConfigAlert: vi.fn(),
  markGlobalConfigAlertDelivered: vi.fn(),
  releaseGlobalConfigAlert: vi.fn()
}))
// Keep the actual route and cron-secret guard; expose its AppError directly.
vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: (handler: (request: NextRequest) => Promise<Response>) =>
    handler
}))

import { GET, POST } from '@/app/api/cron/refresh-global-config/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret')
  vi.stubEnv('LOKI_SCRAPER_USER_ID', 'synthetic-account')
  mocks.discover.mockResolvedValue(hash)
  mocks.download.mockImplementation(async () => ({ configVersion: hash }))
})
afterEach(() => vi.unstubAllEnvs())

it.each(['GET', 'POST'])(
  'retains %s authentication before discovery or CDN work',
  async (method) => {
    const request = new NextRequest(
      'http://localhost/api/cron/refresh-global-config',
      { method }
    )
    await expect(
      (method === 'GET' ? GET : POST)(request)
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.discover).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  }
)

it.each(['GET', 'POST'])(
  'retains the authenticated %s unchanged-hash CDN skip',
  async (method) => {
    const request = new NextRequest(
      'http://localhost/api/cron/refresh-global-config',
      {
        method,
        headers: { authorization: 'Bearer synthetic-cron-secret' }
      }
    )
    const response = await (method === 'GET' ? GET : POST)(request)
    expect(await response.json()).toMatchObject({
      changed: false,
      configVersion: hash,
      message: 'up to date'
    })
    expect(mocks.discover).toHaveBeenCalledTimes(1)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.clear).toHaveBeenCalledTimes(1)
  }
)

it('retains an explicit forced download without inventing trigger metadata from the request', async () => {
  const response = await POST(
    new NextRequest('http://localhost/api/cron/refresh-global-config', {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic-cron-secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        force: true,
        mode: 'payload',
        trigger: 'scheduled'
      })
    })
  )
  expect(await response.json()).toMatchObject({
    changed: false,
    configVersion: hash,
    payloadGzB64: null
  })
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(hash)
  expect(mocks.notify).not.toHaveBeenCalled()
})

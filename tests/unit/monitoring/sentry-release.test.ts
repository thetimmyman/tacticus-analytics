import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { init } = vi.hoisted(() => ({ init: vi.fn() }))

vi.mock('@sentry/nextjs', () => ({
  init,
  captureRouterTransitionStart: vi.fn()
}))
vi.mock('@/app/lib/client/chunk-reload', () => ({
  initChunkReloadListeners: vi.fn()
}))

const revision = 'abcdef0123456789abcdef0123456789abcdef0123'

describe('Sentry source revision', () => {
  beforeEach(() => {
    vi.resetModules()
    init.mockClear()
    vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', revision)
  })
  afterEach(() => vi.unstubAllEnvs())

  for (const [runtime, load] of [
    ['browser', () => import('@/instrumentation-client')],
    ['server', () => import('@/sentry.server.config')],
    ['edge', () => import('@/sentry.edge.config')]
  ] as const) {
    it(`identifies the source revision at the ${runtime} SDK boundary`, async () => {
      await load()

      expect(init).toHaveBeenCalledOnce()
      expect(init.mock.calls[0]?.[0]).toMatchObject({ release: revision })
    })
  }
})

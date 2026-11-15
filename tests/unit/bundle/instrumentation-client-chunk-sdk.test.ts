import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sentEvents } = vi.hoisted(() => ({
  sentEvents: [] as Array<Record<string, unknown>>
}))

vi.mock('@sentry/nextjs', async () => {
  const actual =
    await vi.importActual<typeof import('@sentry/react')>('@sentry/react')
  return {
    ...actual,
    captureRouterTransitionStart: vi.fn(),
    init: (options: Parameters<typeof actual.init>[0]) =>
      actual.init({
        ...options,
        transport: () => ({
          send: async (envelope) => {
            for (const item of envelope[1]) {
              if (
                Array.isArray(item) &&
                item[0] &&
                typeof item[0] === 'object' &&
                (item[0] as { type?: unknown }).type === 'event' &&
                item[1] &&
                typeof item[1] === 'object'
              ) {
                sentEvents.push(item[1] as Record<string, unknown>)
              }
            }
            return { statusCode: 200 }
          },
          flush: async () => true
        })
      })
  }
})

describe('instrumentation-client + Sentry SDK chunk telemetry integration', () => {
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>
  let cleanupListeners: (() => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    sentEvents.length = 0
    sessionStorage.clear()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.invalid/1')
    vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-sdk-test')
  })

  afterEach(async () => {
    cleanupListeners?.()
    cleanupListeners = undefined
    const sentry = await import('@sentry/nextjs')
    await sentry.getClient()?.close(0)
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  async function loadClientModules() {
    const instrumentation = await import('@/instrumentation-client')
    const chunkReload = await import('@/app/lib/client/chunk-reload')
    const sentry = await import('@sentry/nextjs')
    cleanupListeners = chunkReload.initChunkReloadListeners()
    return { instrumentation, chunkReload, sentry }
  }

  it('delivers 1 warning on attempted reload and 1 error on suppressed reload when global handler captures before handleChunkLoadError', async () => {
    const { chunkReload, sentry } = await loadClientModules()

    const firstChunkError = new Error(
      'Failed to load chunk /_next/static/chunks/page.js'
    )
    firstChunkError.name = 'ChunkLoadError'

    // Simulate Sentry globalHandlers firing first on the same Error (sets __sentry_captured__ = true).
    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onunhandledrejection',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(firstChunkError)
    })
    expect(chunkReload.handleChunkLoadError(firstChunkError)).toBe('attempted')

    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect(sentEvents[0]?.fingerprint).toEqual([
      'client-chunk-reload-attempted'
    ])
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )

    // Repeat failure in the same session is suppressed and must still report 1 error event.
    sentEvents.length = 0
    const secondChunkError = new Error(
      'Failed to load chunk /_next/static/chunks/page.js'
    )
    secondChunkError.name = 'ChunkLoadError'

    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onerror',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(secondChunkError)
    })
    expect(chunkReload.handleChunkLoadError(secondChunkError)).toBe(
      'suppressed'
    )

    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('error')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'suppressed'
    )
  })

  it('delivers 1 tagged event without duplicates on window error dispatch through the real SDK client', async () => {
    const { sentry } = await loadClientModules()

    const firstError = new TypeError('Importing a module script failed.')
    window.dispatchEvent(new ErrorEvent('error', { error: firstError }))
    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )

    sentEvents.length = 0
    const secondError = new TypeError('Importing a module script failed.')
    window.dispatchEvent(new ErrorEvent('error', { error: secondError }))
    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('error')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'suppressed'
    )
  })

  it('deduplicates global-handler captures after handleChunkLoadError even for non-Error string rejections', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    const rawRejection =
      'Failed to fetch dynamically imported module: https://app.example.test/_next/static/chunks/app.js'

    expect(chunkReload.handleChunkLoadError(rawRejection)).toBe('attempted')

    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onunhandledrejection',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(rawRejection)
    })

    await sentry.flush(1000)

    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )
  })

  it('preserves 1 warning on attempted reload and 1 error on suppressed reload when an async event processor defers global-handler beforeSend past handleChunkLoadError', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    sentry.addEventProcessor((event) => Promise.resolve(event))

    const firstChunkError = new Error(
      'Failed to load chunk /_next/static/chunks/async-page.js'
    )
    firstChunkError.name = 'ChunkLoadError'

    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onunhandledrejection',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(firstChunkError)
    })
    expect(chunkReload.handleChunkLoadError(firstChunkError)).toBe('attempted')

    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect(sentEvents[0]?.fingerprint).toEqual([
      'client-chunk-reload-attempted'
    ])
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )

    sentEvents.length = 0
    const secondChunkError = new Error(
      'Failed to load chunk /_next/static/chunks/async-page.js'
    )
    secondChunkError.name = 'ChunkLoadError'

    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onerror',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(secondChunkError)
    })
    expect(chunkReload.handleChunkLoadError(secondChunkError)).toBe(
      'suppressed'
    )

    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('error')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'suppressed'
    )
  })

  it('deduplicates a plain-object rejection processed globally before the handler capture', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    const rejection = {
      name: 'ChunkLoadError',
      message: 'Failed to load chunk /_next/static/chunks/object.js'
    }
    sentry.addEventProcessor((event) => Promise.resolve(event))
    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onunhandledrejection',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(rejection)
    })
    await sentry.flush(1000)
    expect(chunkReload.handleChunkLoadError(rejection)).toBe('attempted')
    await sentry.flush(1000)

    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )
  })

  it('deduplicates a global string rejection delayed beyond the handler capture', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    const rejection = 'Failed to load chunk /_next/static/chunks/delayed.js'

    sentry.withScope((scope) => {
      scope.addEventProcessor(async (event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onunhandledrejection',
            handled: false
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        return event
      })
      sentry.captureException(rejection)
    })
    expect(chunkReload.handleChunkLoadError(rejection)).toBe('attempted')
    await sentry.flush(1000)

    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )
  })

  it('deduplicates global-handler captures after handleChunkLoadError even for non-Error string rejections under async event processors', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    sentry.addEventProcessor((event) => Promise.resolve(event))

    const rawRejection =
      'Failed to fetch dynamically imported module: https://app.example.test/_next/static/chunks/async-app.js'

    expect(chunkReload.handleChunkLoadError(rawRejection)).toBe('attempted')

    sentry.withScope((scope) => {
      scope.addEventProcessor((event) => {
        if (event.exception?.values?.[0]) {
          event.exception.values[0].mechanism = {
            type: 'auto.browser.global_handlers.onunhandledrejection',
            handled: false
          }
        }
        return event
      })
      sentry.captureException(rawRejection)
    })

    await sentry.flush(1000)

    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0]?.level).toBe('warning')
    expect(sentEvents[0]?.fingerprint).toEqual([
      'client-chunk-reload-attempted'
    ])
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )
  })

  it('preserves 1 attempted warning and 1 suppressed error across concurrent same-text string failures when global processing finishes before delayed tagged processing', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    sentry.addEventProcessor(async (event) => {
      if ((event.tags as Record<string, unknown> | undefined)?.chunk_reload) {
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      return event
    })

    const repeatedMessage =
      'Failed to load chunk /_next/static/chunks/concurrent-shared.js'

    const captureGlobalRejection = (reason: unknown) => {
      sentry.withScope((scope) => {
        scope.addEventProcessor((event) => {
          if (event.exception?.values?.[0]) {
            event.exception.values[0].mechanism = {
              type: 'auto.browser.global_handlers.onunhandledrejection',
              handled: false
            }
          }
          return event
        })
        sentry.captureException(reason)
      })
    }

    expect(chunkReload.handleChunkLoadError(repeatedMessage)).toBe('attempted')
    expect(chunkReload.handleChunkLoadError(repeatedMessage)).toBe('suppressed')
    captureGlobalRejection(repeatedMessage)
    captureGlobalRejection(repeatedMessage)

    await sentry.flush(1000)

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(sentEvents).toHaveLength(2)
    expect(sentEvents[0]?.level).toBe('warning')
    expect(sentEvents[0]?.fingerprint).toEqual([
      'client-chunk-reload-attempted'
    ])
    expect((sentEvents[0]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'attempted'
    )
    expect(sentEvents[1]?.level).toBe('error')
    expect((sentEvents[1]?.tags as Record<string, string>)?.chunk_reload).toBe(
      'suppressed'
    )
  })

  it('preserves per-occurrence outcomes under out-of-order tagged/global completion and concurrent plain-object rejections', async () => {
    const { chunkReload, sentry } = await loadClientModules()
    let globalCallIndex = 0
    sentry.addEventProcessor(async (event) => {
      const tag = (event.tags as Record<string, unknown> | undefined)
        ?.chunk_reload
      if (tag === 'attempted') {
        await new Promise((resolve) => setTimeout(resolve, 60))
      } else if (tag === 'suppressed') {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return event
    })

    const captureDelayedGlobal = (reason: unknown, delayMs: number) => {
      sentry.withScope((scope) => {
        scope.addEventProcessor(async (event) => {
          if (event.exception?.values?.[0]) {
            event.exception.values[0].mechanism = {
              type: 'auto.browser.global_handlers.onunhandledrejection',
              handled: false
            }
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          return event
        })
        sentry.captureException(reason)
      })
    }

    const message =
      'Failed to load chunk /_next/static/chunks/interleaved-shared.js'
    expect(chunkReload.handleChunkLoadError(message)).toBe('attempted')
    expect(chunkReload.handleChunkLoadError(message)).toBe('suppressed')
    // Global #1 finishes first (5ms), Tagged #2 ('suppressed') finishes second (25ms),
    // Tagged #1 ('attempted') finishes third (60ms), Global #2 finishes last (95ms).
    captureDelayedGlobal(message, 5)
    captureDelayedGlobal(message, 95)

    await sentry.flush(1000)

    const summary = sentEvents.map((ev) => ({
      level: ev.level,
      chunk_reload: (ev.tags as Record<string, string> | undefined)
        ?.chunk_reload
    }))
    expect(summary).toHaveLength(2)
    expect(summary).toContainEqual({
      level: 'warning',
      chunk_reload: 'attempted'
    })
    expect(summary).toContainEqual({
      level: 'error',
      chunk_reload: 'suppressed'
    })

    // Also verify concurrent same-reference plain-object rejections when global finishes first.
    sentEvents.length = 0
    sessionStorage.clear()
    globalCallIndex = 0
    const sharedObjectRejection = {
      name: 'ChunkLoadError',
      message: 'Failed to load chunk /_next/static/chunks/shared-object.js'
    }
    expect(chunkReload.handleChunkLoadError(sharedObjectRejection)).toBe(
      'attempted'
    )
    expect(chunkReload.handleChunkLoadError(sharedObjectRejection)).toBe(
      'suppressed'
    )
    captureDelayedGlobal(sharedObjectRejection, ++globalCallIndex * 5)
    captureDelayedGlobal(sharedObjectRejection, ++globalCallIndex * 5)

    await sentry.flush(1000)

    const objSummary = sentEvents.map((ev) => ({
      level: ev.level,
      chunk_reload: (ev.tags as Record<string, string> | undefined)
        ?.chunk_reload
    }))
    expect(objSummary).toHaveLength(2)
    expect(objSummary).toContainEqual({
      level: 'warning',
      chunk_reload: 'attempted'
    })
    expect(objSummary).toContainEqual({
      level: 'error',
      chunk_reload: 'suppressed'
    })
  })
})

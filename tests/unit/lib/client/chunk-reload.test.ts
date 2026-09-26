import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import {
  handleChunkLoadError,
  isChunkLoadError,
  initChunkReloadListeners,
  resolveBuildId
} from '@/app/lib/client/chunk-reload'

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

function makeChunkLoadError(message = 'Loading chunk 42 failed'): Error {
  const error = new Error(message)
  error.name = 'ChunkLoadError'
  return error
}

describe('chunk-reload', () => {
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  describe('isChunkLoadError', () => {
    it('matches by error name', () => {
      const error = new Error('anything')
      error.name = 'ChunkLoadError'
      expect(isChunkLoadError(error)).toBe(true)
    })

    it('matches "Loading chunk N failed"', () => {
      expect(isChunkLoadError(new Error('Loading chunk 7 failed'))).toBe(true)
    })

    it('matches "Failed to fetch dynamically imported module"', () => {
      expect(
        isChunkLoadError(
          new Error(
            'Failed to fetch dynamically imported module: https://app/x.js'
          )
        )
      ).toBe(true)
    })

    it('does not match an unrelated error', () => {
      expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    })

    it('does not match null/undefined/non-error values', () => {
      expect(isChunkLoadError(null)).toBe(false)
      expect(isChunkLoadError(undefined)).toBe(false)
      expect(isChunkLoadError(42)).toBe(false)
    })
  })

  describe('resolveBuildId', () => {
    it('uses NEXT_PUBLIC_BUILD_SHA, falling back to a fixed value when unset', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', '')
      expect(resolveBuildId()).toBe('unknown-build')

      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'sha-a')
      expect(resolveBuildId()).toBe('sha-a')
    })
  })

  describe('handleChunkLoadError', () => {
    it('reloads once and tags the Sentry event "attempted" on first occurrence', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      const error = makeChunkLoadError()

      const outcome = handleChunkLoadError(error)

      expect(outcome).toBe('attempted')
      expect(reloadMock).toHaveBeenCalledTimes(1)
      expect(captureSentryException).toHaveBeenCalledWith(error, {
        tags: { chunk_reload: 'attempted' }
      })
      expect(sessionStorage.getItem('tacticus_chunk_reload_build-1')).toBe('1')
    })

    it('does NOT reload a second occurrence in the same session/build', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')

      handleChunkLoadError(makeChunkLoadError())
      reloadMock.mockClear()
      vi.mocked(captureSentryException).mockClear()

      const second = makeChunkLoadError()
      const outcome = handleChunkLoadError(second)

      expect(outcome).toBe('suppressed')
      expect(reloadMock).not.toHaveBeenCalled()
      expect(captureSentryException).toHaveBeenCalledWith(second, {
        tags: { chunk_reload: 'suppressed' }
      })
    })

    it('allows a reload again when the build id changes', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      handleChunkLoadError(makeChunkLoadError())
      reloadMock.mockClear()

      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-2')
      const outcome = handleChunkLoadError(makeChunkLoadError())

      expect(outcome).toBe('attempted')
      expect(reloadMock).toHaveBeenCalledTimes(1)
    })

    it('does nothing for an unrelated error', () => {
      const outcome = handleChunkLoadError(new Error('Network request failed'))

      expect(outcome).toBe('ignored')
      expect(reloadMock).not.toHaveBeenCalled()
      expect(captureSentryException).not.toHaveBeenCalled()
      expect(sessionStorage.length).toBe(0)
    })

    it('[guard proof] a naive always-reload implementation WOULD reload twice', () => {
      const naiveHandle = (error: unknown) => {
        if (!isChunkLoadError(error)) return
        window.location.reload()
      }

      naiveHandle(makeChunkLoadError())
      naiveHandle(makeChunkLoadError())

      expect(reloadMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('session storage that rejects reads/writes', () => {
    const originalStorage = window.sessionStorage

    function stubSessionStorage(storage: unknown): void {
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: storage
      })
    }

    afterEach(() => {
      stubSessionStorage(originalStorage)
    })

    it('treats a throwing setItem as "suppressed" instead of throwing', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      stubSessionStorage({
        getItem: () => null,
        setItem: () => {
          const error = new Error('quota exceeded')
          error.name = 'QuotaExceededError'
          throw error
        }
      })

      const error = makeChunkLoadError()
      let outcome: string | undefined
      expect(() => {
        outcome = handleChunkLoadError(error)
      }).not.toThrow()

      expect(outcome).toBe('suppressed')
      expect(reloadMock).not.toHaveBeenCalled()
      expect(captureSentryException).toHaveBeenCalledWith(error, {
        tags: { chunk_reload: 'suppressed' }
      })
    })

    it('treats a throwing getItem as "suppressed" instead of throwing', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      stubSessionStorage({
        getItem: () => {
          const error = new Error('storage is blocked by policy')
          error.name = 'SecurityError'
          throw error
        },
        setItem: () => {}
      })

      const error = makeChunkLoadError()
      let outcome: string | undefined
      expect(() => {
        outcome = handleChunkLoadError(error)
      }).not.toThrow()

      expect(outcome).toBe('suppressed')
      expect(reloadMock).not.toHaveBeenCalled()
    })

    it('still reports the suppressed outcome when storage is unavailable entirely', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      stubSessionStorage(null)

      const error = makeChunkLoadError()
      const outcome = handleChunkLoadError(error)

      expect(outcome).toBe('suppressed')
      expect(reloadMock).not.toHaveBeenCalled()
      expect(captureSentryException).toHaveBeenCalledWith(error, {
        tags: { chunk_reload: 'suppressed' }
      })
    })
  })

  describe("window 'error' listener", () => {
    it('reloads once and sets the session flag for a ChunkLoadError', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      const cleanup = initChunkReloadListeners()

      const error = makeChunkLoadError()
      const event = new Event('error') as ErrorEvent
      Object.defineProperty(event, 'error', { value: error })
      window.dispatchEvent(event)

      expect(reloadMock).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem('tacticus_chunk_reload_build-1')).toBe('1')

      cleanup()
    })

    it('does not reload for an unrelated error', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      const cleanup = initChunkReloadListeners()

      const event = new Event('error') as ErrorEvent
      Object.defineProperty(event, 'error', {
        value: new Error('some other failure')
      })
      window.dispatchEvent(event)

      expect(reloadMock).not.toHaveBeenCalled()

      cleanup()
    })
  })

  describe('unhandledrejection with a chunk-shaped reason', () => {
    it('reloads when the rejection reason matches', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      const cleanup = initChunkReloadListeners()

      const reason = makeChunkLoadError(
        'Failed to fetch dynamically imported module'
      )
      const event = new Event('unhandledrejection') as PromiseRejectionEvent
      Object.defineProperty(event, 'reason', { value: reason })
      Object.defineProperty(event, 'promise', {
        value: Promise.resolve().catch(() => {})
      })
      window.dispatchEvent(event)

      expect(reloadMock).toHaveBeenCalledTimes(1)
      cleanup()
    })

    it('does not reload when the rejection reason is unrelated', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      const cleanup = initChunkReloadListeners()

      const event = new Event('unhandledrejection') as PromiseRejectionEvent
      Object.defineProperty(event, 'reason', {
        value: new Error('some other rejection')
      })
      Object.defineProperty(event, 'promise', {
        value: Promise.resolve().catch(() => {})
      })
      window.dispatchEvent(event)

      expect(reloadMock).not.toHaveBeenCalled()
      cleanup()
    })
  })

  describe('initChunkReloadListeners', () => {
    it('is idempotent - a second call does not attach duplicate listeners', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      const cleanupA = initChunkReloadListeners()
      const callsAfterFirst = addSpy.mock.calls.length
      const cleanupB = initChunkReloadListeners()

      expect(addSpy.mock.calls.length).toBe(callsAfterFirst)

      cleanupA()
      cleanupB()
      addSpy.mockRestore()
    })
  })
})

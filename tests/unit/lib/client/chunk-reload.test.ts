import vm from 'node:vm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import {
  handleChunkLoadError,
  isChunkLoadError,
  initChunkReloadListeners,
  resolveBuildId,
  resolveChunkTelemetryEvent
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

    it('matches Turbopack, WebKit, and SpiderMonkey dynamic import chunk failures and cause-wrapped chunk errors', () => {
      expect(
        isChunkLoadError(
          new Error(
            'Failed to load chunk /_next/static/chunks/main.js from module 42'
          )
        )
      ).toBe(true)
      expect(
        isChunkLoadError(new TypeError('Importing a module script failed.'))
      ).toBe(true)
      expect(
        isChunkLoadError(
          new TypeError('error loading dynamically imported module')
        )
      ).toBe(true)
      expect(
        isChunkLoadError(
          new Error('Component failed to render', {
            cause: new TypeError('Importing a module script failed.')
          })
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

    it('matches a parse-failure SyntaxError from our own bundle', () => {
      const error = new SyntaxError("Unexpected token '<'")
      error.stack =
        "SyntaxError: Unexpected token '<'\n" +
        '    at https://app.example/_next/static/chunks/2619-abc.js:1:1'
      expect(isChunkLoadError(error)).toBe(true)
    })

    it('matches a Firefox/Safari top-level anonymous chunk resource stack', () => {
      const error = new SyntaxError("Unexpected token '<'")
      error.stack = '@https://app.example/_next/static/chunks/2619-abc.js:1:1'
      expect(isChunkLoadError(error)).toBe(true)
    })

    it('matches a real VM script-compilation SyntaxError when a Next chunk contains HTML', () => {
      let caught: unknown
      try {
        vm.runInThisContext('<html>502 Bad Gateway</html>', {
          filename: 'https://app.example/_next/static/chunks/2619-abc.js'
        })
      } catch (error) {
        caught = error
      }
      expect(isChunkLoadError(caught)).toBe(true)
    })

    it('matches a truncated parse failure with Next server chunk stack evidence', () => {
      const error = new SyntaxError('Unexpected end of input')
      error.stack =
        'SyntaxError: Unexpected end of input\n' +
        '    at node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:1:1'
      expect(isChunkLoadError(error)).toBe(true)
    })

    it('does not match a parse-failure SyntaxError without bundle evidence', () => {
      const error = new SyntaxError("Unexpected token '<'")
      error.stack = "SyntaxError: Unexpected token '<'\n    at inpage.js:1:1"
      expect(isChunkLoadError(error)).toBe(false)
    })

    it('does not match an unrelated SyntaxError even with valid chunk bundle evidence', () => {
      const error = new SyntaxError('Invalid regular expression: missing )')
      error.stack =
        'SyntaxError: Invalid regular expression: missing )\n' +
        '    at https://app.example/_next/static/chunks/2619-abc.js:1:1'
      expect(isChunkLoadError(error)).toBe(false)
    })

    it('does not match runtime JSON.parse failures thrown inside a compiled Next chunk', () => {
      let vmJsonError: unknown
      try {
        vm.runInThisContext("JSON.parse('<html>invalid response</html>')", {
          filename: 'https://app.example/_next/static/chunks/auth.js'
        })
      } catch (error) {
        vmJsonError = error
      }
      expect(isChunkLoadError(vmJsonError)).toBe(false)

      const v8JsonStackOnly = new SyntaxError("Unexpected token '<'")
      v8JsonStackOnly.stack =
        "SyntaxError: Unexpected token '<'\n" +
        '    at JSON.parse (<anonymous>)\n' +
        '    at https://app.example/_next/static/chunks/auth.js:1:6'
      expect(isChunkLoadError(v8JsonStackOnly)).toBe(false)

      const firefoxJsonStack = new SyntaxError("Unexpected token '<'")
      firefoxJsonStack.stack =
        'parse@[native code]\n' +
        'login@https://app.example/_next/static/chunks/auth.js:1:32'
      expect(isChunkLoadError(firefoxJsonStack)).toBe(false)
    })

    it('does not match runtime eval, Function constructor, or named function SyntaxErrors inside Next chunks', () => {
      for (const snippet of [
        "eval('<html>invalid</html>')",
        "new Function('<html>invalid</html>')"
      ]) {
        let caught: unknown
        try {
          vm.runInThisContext(snippet, {
            filename: 'https://app.example/_next/static/chunks/auth.js'
          })
        } catch (error) {
          caught = error
        }
        expect(isChunkLoadError(caught)).toBe(false)
      }

      const namedCaller = new SyntaxError("Unexpected token '<'")
      namedCaller.stack =
        "SyntaxError: Unexpected token '<'\n" +
        '    at decodePayload (https://app.example/_next/static/chunks/auth.js:1:420)'
      expect(isChunkLoadError(namedCaller)).toBe(false)
    })

    it('does not match mixed extension and _next stacks in either frame order', () => {
      const extensionTop = new SyntaxError("Unexpected token '<'")
      extensionTop.stack =
        "SyntaxError: Unexpected token '<'\n" +
        '    at chrome-extension://abcdefghijklmnop/scripts/inpage.js:1:1\n' +
        '    at https://app.example/_next/static/chunks/main.js:1:1'
      expect(isChunkLoadError(extensionTop)).toBe(false)

      const nextTopWithExtensionCaller = new SyntaxError("Unexpected token '<'")
      nextTopWithExtensionCaller.stack =
        "SyntaxError: Unexpected token '<'\n" +
        '    at https://app.example/_next/static/chunks/main.js:1:1\n' +
        '    at moz-extension://0000-1111/inpage.js:12:4'
      expect(isChunkLoadError(nextTopWithExtensionCaller)).toBe(false)
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

    it('reloads when a Next chunk script tag fails to parse with a frameless SyntaxError and ErrorEvent.filename', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-1')
      const cleanup = initChunkReloadListeners()

      const frameless = new SyntaxError("Unexpected token '<'")
      frameless.stack = "SyntaxError: Unexpected token '<'"

      const extensionEvent = new Event('error') as ErrorEvent
      Object.defineProperty(extensionEvent, 'error', { value: frameless })
      Object.defineProperty(extensionEvent, 'filename', {
        value: 'chrome-extension://abcdefghijklmnop/scripts/inpage.js'
      })
      window.dispatchEvent(extensionEvent)
      expect(reloadMock).not.toHaveBeenCalled()

      const chunkEvent = new Event('error') as ErrorEvent
      Object.defineProperty(chunkEvent, 'error', { value: frameless })
      Object.defineProperty(chunkEvent, 'filename', {
        value: 'https://app.example/_next/static/chunks/2619-abc.js'
      })
      window.dispatchEvent(chunkEvent)
      expect(reloadMock).toHaveBeenCalledTimes(1)

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

  describe('resolveChunkTelemetryEvent per-occurrence correlation', () => {
    it('tracks attempted then suppressed outcomes independently for identical string messages and cleans up when Sentry is disabled', () => {
      vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'build-corr')
      vi.mocked(captureSentryException).mockReturnValue(true)

      const msg = 'Failed to load chunk /_next/static/chunks/unit-shared.js'
      expect(handleChunkLoadError(msg)).toBe('attempted')
      expect(handleChunkLoadError(msg)).toBe('suppressed')

      expect(resolveChunkTelemetryEvent(msg, { isGlobalHandler: true })).toBe(
        'attempted'
      )
      expect(resolveChunkTelemetryEvent(msg, { isGlobalHandler: true })).toBe(
        'suppressed'
      )

      expect(
        resolveChunkTelemetryEvent(msg, {
          existingTag: 'attempted',
          isGlobalHandler: false
        })
      ).toBe('duplicate')
      expect(
        resolveChunkTelemetryEvent(msg, {
          existingTag: 'suppressed',
          isGlobalHandler: false
        })
      ).toBe('duplicate')

      // When captureSentryException returns false (Sentry disabled), occurrences are not retained.
      sessionStorage.clear()
      vi.mocked(captureSentryException).mockReturnValue(false)
      const disabledMsg =
        'Failed to load chunk /_next/static/chunks/disabled.js'
      expect(handleChunkLoadError(disabledMsg)).toBe('attempted')
      // Because sessionStorage now has '1' and no pending occurrence was retained, fallback is 'suppressed'.
      expect(
        resolveChunkTelemetryEvent(disabledMsg, { isGlobalHandler: true })
      ).toBe('suppressed')
    })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_REQUEST_CONFIG } from '@tacticus/app-core/api-constants'

vi.mock('server-only', () => ({}))

const mockFs = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn()
}))

vi.mock('node:fs', () => ({
  default: { promises: mockFs },
  promises: mockFs
}))

describe('LOKI build/global config remote fetch timeouts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('falls back to the default build string when remote globalConfig hangs', async () => {
    vi.useFakeTimers()
    let aborted = false

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              const abortError = new Error('Request timed out')
              abortError.name = 'AbortError'
              reject(abortError)
            },
            { once: true }
          )
        })
      })
    )

    const { resolveLokiBuildString } =
      await import('@/app/lib/loki/build-string')
    const resultPromise = resolveLokiBuildString('Windows', {
      forceRefresh: true
    })

    await vi.advanceTimersByTimeAsync(API_REQUEST_CONFIG.TIMEOUTS.SHORT)

    expect(aborted).toBe(true)
    await expect(resultPromise).resolves.toBe('1.29.21.1056')
  })

  it('falls back to the default build string when remote globalConfig body hangs', async () => {
    vi.useFakeTimers()
    let aborted = false

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true
          },
          { once: true }
        )
        return Promise.resolve({
          ok: true,
          json: () => new Promise(() => {})
        } as Response)
      })
    )

    const { resolveLokiBuildString } =
      await import('@/app/lib/loki/build-string')
    const resultPromise = resolveLokiBuildString('Windows', {
      forceRefresh: true
    })

    await vi.advanceTimersByTimeAsync(API_REQUEST_CONFIG.TIMEOUTS.SHORT)

    expect(aborted).toBe(true)
    await expect(resultPromise).resolves.toBe('1.29.21.1056')
  })

  it('falls back to disk global config when remote globalConfig hangs', async () => {
    vi.useFakeTimers()
    let aborted = false

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              const abortError = new Error('Request timed out')
              abortError.name = 'AbortError'
              reject(abortError)
            },
            { once: true }
          )
        })
      })
    )

    mockFs.readdir.mockResolvedValue(['GlobalConfig.json'])
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        configVersion: 'disk-config',
        general: { minRecommendedAppVersions: { Windows: 'disk-build' } }
      })
    )

    const { getGlobalConfigSnapshot } =
      await import('@/app/lib/loki/global-config')
    const resultPromise = getGlobalConfigSnapshot({ forceRefresh: true })

    await vi.advanceTimersByTimeAsync(API_REQUEST_CONFIG.TIMEOUTS.SHORT)

    expect(aborted).toBe(true)
    await expect(resultPromise).resolves.toMatchObject({
      source: 'disk',
      config: { configVersion: 'disk-config' }
    })
  })
})

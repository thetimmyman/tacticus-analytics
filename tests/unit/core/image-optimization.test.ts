import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BOSS_PORTRAIT_SIZES,
  IMAGE_CONFIG,
  bossPortraitLoader,
  createLazyLoadObserver,
  preloadBossPortrait,
  trackImagePerformance
} from '@tacticus/app-core/image-optimization'

const globalAny = globalThis as typeof globalThis & {
  Image?: typeof Image
  fetch?: typeof fetch
  gtag?: (...args: unknown[]) => void
  IntersectionObserver?: typeof IntersectionObserver
  navigator?: Navigator & { connection?: { effectiveType?: string } }
}

const originalImage = globalAny.Image
const originalFetch = globalAny.fetch
const originalGtag = globalAny.gtag
const originalObserver = globalAny.IntersectionObserver
const originalConnection = globalAny.navigator?.connection

const baseUrl = 'https://example.com/assets/boss.png'

afterEach(() => {
  globalAny.Image = originalImage
  globalAny.fetch = originalFetch
  globalAny.gtag = originalGtag
  globalAny.IntersectionObserver = originalObserver
  if (globalAny.navigator) {
    globalAny.navigator.connection = originalConnection
  }
  document
    .querySelectorAll('link[rel="preload"]')
    .forEach((link) => link.remove())
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('image optimization helpers', () => {
  it('includes the CDN domain in the image config', () => {
    expect(IMAGE_CONFIG.domains).toContain('cdn.tacticusanalytics.com')
  })

  it('returns existing optimized URLs without rewrapping', () => {
    const url = '/_next/image?url=foo&w=32&q=70'
    const result = bossPortraitLoader({ src: url, width: 32, quality: 70 })

    expect(result).toBe(url)
  })

  it('builds optimized URLs for raw sources', () => {
    const result = bossPortraitLoader({ src: baseUrl, width: 64, quality: 75 })

    expect(result).toContain('/_next/image?')
    expect(result).toContain('w=64')
    expect(result).toContain('q=75')
  })
})

describe('preloadBossPortrait', () => {
  it('skips placeholder assets', () => {
    preloadBossPortrait('bossl1.png', 'small')

    expect(document.querySelectorAll('link[rel="preload"]').length).toBe(0)
  })

  it('adds a preload link for real assets', () => {
    preloadBossPortrait(baseUrl, 'large')

    const link = document.querySelector(
      'link[rel="preload"]'
    ) as HTMLLinkElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('imagesizes')).toBe(
      `${BOSS_PORTRAIT_SIZES.large.width}px`
    )
    expect(link.href).toContain(baseUrl)
  })
})

describe('trackImagePerformance', () => {
  it('emits analytics for successful image loads', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    globalAny.fetch = fetchMock as typeof fetch
    globalAny.gtag = vi.fn()
    if (!globalAny.navigator) vi.stubGlobal('navigator', {} as Navigator)
    globalAny.navigator.connection = { effectiveType: '4g' }

    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValueOnce(10).mockReturnValueOnce(42)

    let shouldError = false
    class MockImage {
      onload?: () => void
      onerror?: () => void
      set src(_value: string) {
        if (shouldError) {
          this.onerror?.()
        } else {
          this.onload?.()
        }
      }
    }
    globalAny.Image = MockImage as unknown as typeof Image

    trackImagePerformance(baseUrl, 'small')
    await vi.runAllTimersAsync()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(globalAny.gtag).toHaveBeenCalled()
  })

  it('records failures when image loads error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    globalAny.fetch = fetchMock as typeof fetch
    globalAny.gtag = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let shouldError = true
    class MockImage {
      onload?: () => void
      onerror?: () => void
      set src(_value: string) {
        if (shouldError) {
          this.onerror?.()
        } else {
          this.onload?.()
        }
      }
    }
    globalAny.Image = MockImage as unknown as typeof Image

    trackImagePerformance(baseUrl, 'small')
    await vi.runAllTimersAsync()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      `Failed to load boss portrait: ${baseUrl}`
    )
    expect(globalAny.gtag).toHaveBeenCalled()
  })
})

describe('createLazyLoadObserver', () => {
  it('returns null when IntersectionObserver is unavailable', () => {
    globalAny.IntersectionObserver = undefined

    expect(createLazyLoadObserver(() => {})).toBeNull()
  })

  it('creates an observer when IntersectionObserver is available', () => {
    const observerSpy = vi.fn()
    class MockObserver {
      constructor(
        cb: IntersectionObserverCallback,
        options: IntersectionObserverInit
      ) {
        observerSpy(cb, options)
      }
    }
    globalAny.IntersectionObserver =
      MockObserver as unknown as typeof IntersectionObserver

    const observer = createLazyLoadObserver(() => {})

    expect(observer).not.toBeNull()
    expect(observerSpy).toHaveBeenCalledWith(expect.any(Function), {
      rootMargin: '50px',
      threshold: 0.1
    })
  })
})

import { ImageLoaderProps } from 'next/image'
import { getSupabaseHost, hasSupabaseCredentials } from './supabase-env'

export const IMAGE_CONFIG = {
  domains: [
    ...(hasSupabaseCredentials() ? [getSupabaseHost()] : []),
    'cdn.tacticusanalytics.com'
  ],
  deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  formats: ['image/webp', 'image/avif'],
  minimumCacheTTL: 3600,
  dangerouslyAllowSVG: false,
  contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;"
}

export const BOSS_PORTRAIT_SIZES = {
  small: { width: 32, height: 32 },
  medium: { width: 64, height: 64 },
  header: { width: 96, height: 96 },
  large: { width: 128, height: 128 },
  xl: { width: 256, height: 256 }
} as const

const PLACEHOLDER_ASSET_PATTERN = /^boss(?:[_-]?l)?\d+$/i

function isPlaceholderAssetPath(src: string): boolean {
  if (!src) return false
  const pathWithoutQuery = src.split('?')[0] ?? ''
  const fileName = pathWithoutQuery.split('/').pop() ?? ''
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '')
  return PLACEHOLDER_ASSET_PATTERN.test(nameWithoutExt)
}

export type BossPortraitSize = keyof typeof BOSS_PORTRAIT_SIZES

// Next.js 16 restricts quality values; only 70 and 75 are verified.
export const QUALITY_SETTINGS = {
  thumbnail: 70,
  portrait: 75,
  fallback: 70
} as const

/** Forwards through Next.js's built-in /_next/image optimizer on any deploy target. */
export const bossPortraitLoader = ({
  src,
  width,
  quality
}: ImageLoaderProps): string => {
  if (src.includes('/_next/image')) {
    return src
  }

  const params = new URLSearchParams({
    url: src,
    w: width.toString(),
    q: (quality || 75).toString()
  })

  return `/_next/image?${params}`
}

export function preloadBossPortrait(
  src: string,
  size: BossPortraitSize = 'medium'
): void {
  if (typeof window === 'undefined') return
  if (isPlaceholderAssetPath(src)) return

  const portrait = BOSS_PORTRAIT_SIZES[size]
  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'image'
  link.href = src
  link.setAttribute('imagesizes', `${portrait.width}px`)

  document.head.appendChild(link)
}

export function trackImagePerformance(
  src: string,
  size: BossPortraitSize
): void {
  if (typeof window === 'undefined' || !window.performance) return
  if (isPlaceholderAssetPath(src)) return

  const startTime = performance.now()

  const img = new Image()
  img.onload = () => {
    const endTime = performance.now()
    const loadTime = endTime - startTime

    if (typeof window !== 'undefined' && (window as any).gtag) {
      ;(window as any).gtag('event', 'boss_portrait_load', {
        event_category: 'performance',
        event_label: size,
        value: Math.round(loadTime)
      })
    }
  }

  img.onerror = () => {
    console.error(`Failed to load boss portrait: ${src}`)

    if (typeof window !== 'undefined' && (window as any).gtag) {
      ;(window as any).gtag('event', 'boss_portrait_error', {
        event_category: 'error',
        event_label: src
      })
    }
  }

  img.src = src
}

export function createLazyLoadObserver(
  callback: (entry: IntersectionObserverEntry) => void
): IntersectionObserver | null {
  if (typeof window === 'undefined' || !(window as any).IntersectionObserver) {
    return null
  }

  return new IntersectionObserver(
    (entries) => {
      entries.forEach(callback)
    },
    {
      rootMargin: '50px',
      threshold: 0.1
    }
  )
}

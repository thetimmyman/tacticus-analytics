'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import {
  bossPortraitLoader,
  createLazyLoadObserver,
  BOSS_PORTRAIT_SIZES,
  QUALITY_SETTINGS,
  type BossPortraitSize
} from '@tacticus/app-core/image-optimization'
import { extractBadge } from '@/app/lib/catalogs/hero-portrait-resolver'
import {
  buildFallbackPath,
  normalizeBossSlug,
  resolveBossAssetPath
} from '@/app/lib/resolvers/boss-assets'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

interface BossPortraitProps {
  bossName: string
  lookupName?: string
  size?: BossPortraitSize
  variant?: 'portrait' | 'icon' | 'thumbnail'
  className?: string
  showFallback?: boolean
  showLoadingState?: boolean
  priority?: boolean
  lazy?: boolean
  onLoad?: () => void
  onError?: () => void
}

const sizeClasses = {
  small: 'w-8 h-8',
  medium: 'w-16 h-16',
  header: 'w-24 h-24',
  large: 'w-32 h-32',
  xl: 'w-64 h-64'
}

function isPlaceholderBossName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  if (normalized.startsWith('boss ')) return true

  const collapsed = normalized.replace(/[\s_-]+/g, '')
  return /^bossl?\d+/.test(collapsed)
}

function isValidBossName(name: string): boolean {
  return (
    Boolean(name) &&
    name.trim().length > 0 &&
    !name.toLowerCase().includes('temp') &&
    !name.toLowerCase().includes('unknown') &&
    name !== 'undefined' &&
    name !== 'null'
  )
}

// `bossName` is a raw API token: strip non-alphanumerics before slicing so the
// badge never shows punctuation.
function getBossPortraitInitials(name: string): string {
  const isMultiWord = name.trim().split(/\s+/).filter(Boolean).length >= 2
  const source = isMultiWord ? name : name.replace(/[^a-zA-Z0-9]/g, '')
  return extractBadge(source) || '?'
}

export function BossPortrait({
  bossName,
  lookupName,
  size = 'medium',
  variant = 'portrait',
  className = '',
  showFallback = true,
  showLoadingState = true,
  priority = false,
  lazy = true,
  onLoad,
  onError
}: BossPortraitProps) {
  const [imageError, setImageError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [inView, setInView] = useState(!lazy)
  const imgRef = useRef<HTMLDivElement>(null)

  const lookupSource = lookupName ?? bossName

  const manifestPath = resolveBossAssetPath(lookupSource, variant)
  const isPlaceholder = isPlaceholderBossName(lookupSource)
  const canRenderImage = Boolean(manifestPath) && !isPlaceholder
  const imagePath =
    manifestPath ?? buildFallbackPath(normalizeBossSlug(lookupSource), variant)
  const imageSize = BOSS_PORTRAIT_SIZES[size]
  const initials = getBossPortraitInitials(bossName)
  // Curated name for alt/title only; the raw `bossName` still drives the image lookup.
  const displayName = getBossDisplayName(bossName)
  const placeholderProps =
    size === 'small'
      ? ({ placeholder: 'empty' } as const)
      : ({
          placeholder: 'blur',
          blurDataURL:
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWEREiMxUf/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAICEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaSXnFjCOfoeFwLJ7bFxvSOB7+LaP/9k='
        } as const)

  const renderFallback = () => {
    if (!showFallback) return null

    return (
      <div
        className={`boss-portrait-frame boss-portrait-fallback ${sizeClasses[size]} ${className}`}
        title={displayName}
      >
        <span
          className={`
            boss-portrait-fallback__initials
            ${size === 'small' ? 'text-xs' : size === 'medium' ? 'text-sm' : 'text-lg'}
          `}
        >
          {initials || '?'}
        </span>
      </div>
    )
  }

  useEffect(() => {
    if (
      !canRenderImage ||
      !lazy ||
      !imgRef.current ||
      !isValidBossName(bossName)
    )
      return

    const observer = createLazyLoadObserver((entry) => {
      if (entry.isIntersecting) {
        setInView(true)
        observer?.unobserve(entry.target)
      }
    })

    if (observer && imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => observer?.disconnect()
  }, [lazy, bossName])

  // Deliberately no preloadBossPortrait/trackImagePerformance: they fetch the raw
  // PNG while <Image> loads the optimized URL (double download), and `window.gtag`
  // is never defined here.

  const canUseImage = canRenderImage && isValidBossName(bossName) && !imageError
  if (!canUseImage) {
    return renderFallback()
  }

  return (
    <div
      ref={imgRef}
      className={`boss-portrait-frame ${sizeClasses[size]} ${className}`}
    >
      {inView && (
        <Image
          src={imagePath}
          alt={`${displayName} portrait`}
          width={imageSize.width}
          height={imageSize.height}
          className="boss-portrait-image"
          loader={bossPortraitLoader}
          quality={QUALITY_SETTINGS.portrait}
          sizes={`${imageSize.width}px`}
          onLoad={() => {
            setIsLoading(false)
            onLoad?.()
          }}
          onError={() => {
            setImageError(true)
            setIsLoading(false)
            onError?.()
          }}
          title={displayName}
          priority={priority}
          loading={lazy ? 'lazy' : 'eager'}
          {...placeholderProps}
        />
      )}
      <div className="boss-portrait-overlay" aria-hidden="true" />

      {/* Loading skeleton */}
      {showLoadingState && isLoading && inView && (
        <div className="boss-portrait-skeleton">
          <span className="boss-portrait-loading__initials">{initials}</span>
        </div>
      )}

      {/* Lazy loading placeholder */}
      {showLoadingState && !inView && lazy && (
        <div className="boss-portrait-placeholder">
          <span className="boss-portrait-loading__initials">{initials}</span>
        </div>
      )}
    </div>
  )
}

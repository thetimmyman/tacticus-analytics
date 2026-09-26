'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@tacticus/ui-kit'
import { MemberName } from '@/app/components/ui/MemberName'
import { cn } from '@/app/lib/utils/cn'

interface StickyPlayerHeaderProps {
  playerName: string
  guildName: string
  season: string
  showBackButton: boolean
  onBackClick: () => void
}

// Observer fallback only: CSS supplies first-paint offsets; the inline offset
// applies once [data-app-chrome] is measured.
const FALLBACK_CHROME_OFFSET_PX = 88

const measureChromeOffset = (): number | null => {
  const chromes = document.querySelectorAll<HTMLElement>('[data-app-chrome]')
  for (const chrome of chromes) {
    if (chrome.offsetHeight > 0) return chrome.offsetHeight
  }
  return null
}

export function StickyPlayerHeader({
  playerName,
  guildName,
  season,
  showBackButton,
  onBackClick
}: StickyPlayerHeaderProps) {
  // The panel sits in flow and condenses once under the chrome, never covering stats.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [condensed, setCondensed] = useState(false)
  const [chromeOffset, setChromeOffset] = useState<number | null>(null)

  useEffect(() => {
    const remeasure = () => setChromeOffset(measureChromeOffset())
    remeasure()
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [])

  const effectiveOffset = chromeOffset ?? FALLBACK_CHROME_OFFSET_PX

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    let scrollFrame: number | null = null

    const updateFromGeometry = () => {
      scrollFrame = null
      setCondensed(sentinel.getBoundingClientRect().top <= effectiveOffset)
    }

    const handleScroll = () => {
      if (scrollFrame !== null) return
      scrollFrame = window.requestAnimationFrame(updateFromGeometry)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Batches arrive oldest-first; the last entry is current.
        const latest = entries[entries.length - 1]
        if (latest) setCondensed(!latest.isIntersecting)
      },
      { rootMargin: `-${effectiveOffset}px 0px 0px 0px`, threshold: 0 }
    )
    observer.observe(sentinel)
    // Mobile WebKit can defer IntersectionObserver after scripted scrolls; the geometry
    // fallback forces layout every frame, so it runs only on Safari-family WebKit.
    const isSafariWebKit =
      typeof navigator !== 'undefined' &&
      /AppleWebKit/i.test(navigator.userAgent) &&
      !/Chrome|Chromium|Edg\/|Android/i.test(navigator.userAgent)
    if (isSafariWebKit) {
      window.addEventListener('scroll', handleScroll, { passive: true })
    }
    return () => {
      observer.disconnect()
      if (isSafariWebKit) window.removeEventListener('scroll', handleScroll)
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame)
    }
  }, [effectiveOffset])

  return (
    <>
      {/* Sentinel: leaving the band below the chrome pins and condenses the header. */}
      <div ref={sentinelRef} aria-hidden="true" />
      <div
        data-testid="selected-player-header"
        data-player-identity={playerName}
        data-condensed={condensed || undefined}
        style={chromeOffset === null ? undefined : { top: chromeOffset }}
        className={cn(
          'sticky top-12 z-40 border-b border-[var(--card-border)] backdrop-blur transition-shadow duration-200 motion-reduce:transition-none lg:top-[88px]',
          condensed
            ? 'bg-[color-mix(in_srgb,var(--bg-primary)_88%,transparent)] shadow-lg shadow-black/30'
            : 'bg-[color-mix(in_srgb,var(--bg-primary)_95%,transparent)]'
        )}
      >
        <div
          className={cn(
            'mx-auto max-w-6xl px-4 transition-[padding] duration-200 motion-reduce:transition-none',
            condensed
              ? 'flex flex-row items-center justify-between gap-2 py-1.5'
              : 'flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between'
          )}
        >
          <div className="min-w-0">
            {!condensed && (
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                Selected Player
              </p>
            )}
            <p
              className={cn(
                'truncate font-semibold text-[var(--text-primary)]',
                condensed ? 'text-sm' : 'text-base'
              )}
            >
              <MemberName value={playerName} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)] sm:gap-3">
            <span
              className={cn(
                'rounded-md border border-[var(--card-border)] px-2 py-1 font-mono text-xs uppercase tracking-wide',
                condensed && 'hidden sm:inline-flex'
              )}
            >
              {guildName}
            </span>
            <span
              className={cn(
                'rounded-md border border-[var(--card-border)] px-2 py-1 font-mono text-xs uppercase tracking-wide',
                condensed && 'hidden md:inline-flex'
              )}
            >
              Season {season}
            </span>
            {showBackButton && (
              <Button variant="outline" size="sm" onClick={onBackClick}>
                Back to My Stats
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

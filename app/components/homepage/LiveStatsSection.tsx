'use client'

import { useEffect, useRef, useState } from 'react'
import type { LiveStats } from '@/app/lib/data/get-live-stats'
import { formatNumber } from '@tacticus/app-core/formatters'

interface LiveStatsSectionProps {
  initialStats: LiveStats
}

export function LiveStatsSection({ initialStats }: LiveStatsSectionProps) {
  const [stats, setStats] = useState<LiveStats>(initialStats)
  const [isLoading, setIsLoading] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const hasRequestedRefreshRef = useRef(false)

  // Static fallback for unauthenticated users, refreshed by refresh-homepage-stats.js.
  const getDisplayStats = (rawStats: LiveStats): LiveStats => {
    // All zeros means unauthenticated: show the snapshot.
    if (
      rawStats.activePlayers === 0 &&
      rawStats.battlesTracked === 0 &&
      rawStats.guilds === 0 &&
      rawStats.totalDamage === 0
    ) {
      return {
        activePlayers: 12902, // Real data as of Mar 15, 2026
        battlesTracked: 2326450, // Real data as of Mar 15, 2026
        guilds: 331, // Real data as of Mar 15, 2026
        totalDamage: 425682450890 // Real data as of Mar 15, 2026
      }
    }
    return rawStats
  }

  useEffect(() => {
    setStats(getDisplayStats(initialStats))
  }, [initialStats])

  useEffect(() => {
    let isMounted = true

    const runRefresh = async () => {
      setIsLoading(true)

      try {
        const response = await fetch('/api/public/live-stats', {
          cache: 'no-store'
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch live stats: ${response.statusText}`)
        }

        const latest = (await response.json()) as LiveStats

        if (isMounted && latest) {
          setStats(getDisplayStats(latest))
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to refresh live stats', error)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    const scheduleRefresh = () => {
      if (hasRequestedRefreshRef.current) return
      hasRequestedRefreshRef.current = true

      const invoke = () => runRefresh()

      if (typeof window !== 'undefined') {
        const idle =
          'requestIdleCallback' in window
            ? (
                window as Window & {
                  requestIdleCallback?: (callback: () => void) => number
                }
              ).requestIdleCallback
            : undefined

        if (idle) {
          idle(invoke)
          return
        }
      }

      setTimeout(invoke, 200)
    }

    const element = sectionRef.current
    if (!element) {
      scheduleRefresh()
      return () => {
        isMounted = false
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            scheduleRefresh()
            observer.disconnect()
          }
        })
      },
      { rootMargin: '200px' }
    )

    observer.observe(element)

    return () => {
      isMounted = false
      observer.disconnect()
    }
  }, [])

  return (
    <div
      ref={sectionRef}
      className="py-12 bg-[color-mix(in_srgb,var(--bg-from)_70%,transparent)] border-y border-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className={`grid grid-cols-2 md:grid-cols-4 gap-8 transition-opacity ${isLoading ? 'opacity-80' : 'opacity-100'}`}
          aria-busy={isLoading}
        >
          <div className="text-center" aria-live="polite" aria-atomic="true">
            <p
              className="text-3xl md:text-4xl font-bold text-(--accent)"
              suppressHydrationWarning
            >
              {`${formatNumber(stats.activePlayers)}+`}
            </p>
            <p className="text-secondary-wh40k mt-1">Active Players</p>
          </div>
          <div className="text-center" aria-live="polite" aria-atomic="true">
            <p
              className="text-3xl md:text-4xl font-bold text-(--accent)"
              suppressHydrationWarning
            >
              {`${formatNumber(stats.battlesTracked)}+`}
            </p>
            <p className="text-secondary-wh40k mt-1">Battles Tracked</p>
          </div>
          <div className="text-center" aria-live="polite" aria-atomic="true">
            <p
              className="text-3xl md:text-4xl font-bold text-(--accent)"
              suppressHydrationWarning
            >
              {`${formatNumber(stats.guilds)}+`}
            </p>
            <p className="text-secondary-wh40k mt-1">Guilds</p>
          </div>
          <div className="text-center" aria-live="polite" aria-atomic="true">
            <p
              className="text-3xl md:text-4xl font-bold text-(--accent)"
              suppressHydrationWarning
            >
              {formatNumber(stats.totalDamage)}
            </p>
            <p className="text-secondary-wh40k mt-1">Total Damage</p>
          </div>
        </div>
      </div>
    </div>
  )
}

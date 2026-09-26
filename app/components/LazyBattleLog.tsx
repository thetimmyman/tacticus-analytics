'use client'

import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Skeleton } from '@tacticus/ui-kit/skeleton'

const BattleLog = lazy(() => import('@/app/components/BattleLog'))

interface LazyBattleLogProps {
  selectedGuild: string
  selectedSeason: string
}

function BattleLogSkeleton() {
  return (
    <div className="card-wh40k p-3 sm:p-4">
      <div className="flex justify-between items-center mb-3 sm:mb-4">
        <Skeleton className="h-6 sm:h-8 w-24 sm:w-32" />
        <Skeleton className="h-8 sm:h-10 w-48 sm:w-64" />
      </div>
      <div className="space-y-2 sm:space-y-3">
        {['a', 'b', 'c', 'd', 'e'].map((id) => (
          <div
            key={`log-skeleton-${id}`}
            className="flex items-start gap-3 sm:gap-4 p-2 sm:p-3 bg-slate-800/50 rounded-lg"
          >
            <Skeleton className="h-12 w-12 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function LazyBattleLog({
  selectedGuild,
  selectedSeason
}: LazyBattleLogProps) {
  const [shouldLoad, setShouldLoad] = useState(false)
  const [hasBeenVisible, setHasBeenVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Load after a delay so critical content goes first...
    const delayTimer = setTimeout(() => {
      setShouldLoad(true)
    }, 1500)

    // ...or when scrolled into view.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasBeenVisible) {
            setHasBeenVisible(true)
            setShouldLoad(true)
          }
        })
      },
      {
        rootMargin: '100px',
        threshold: 0.01
      }
    )

    const currentRef = containerRef.current
    if (currentRef) {
      observer.observe(currentRef)
    }

    return () => {
      clearTimeout(delayTimer)
      if (currentRef) {
        observer.unobserve(currentRef)
      }
    }
  }, [hasBeenVisible])

  return (
    <div ref={containerRef} className="min-h-[400px]">
      {shouldLoad ? (
        <Suspense fallback={<BattleLogSkeleton />}>
          <BattleLog
            selectedGuild={selectedGuild}
            selectedSeason={selectedSeason}
          />
        </Suspense>
      ) : (
        <BattleLogSkeleton />
      )}
    </div>
  )
}

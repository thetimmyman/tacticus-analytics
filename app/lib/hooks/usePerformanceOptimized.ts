import { useMemo, useCallback, useRef } from 'react'
import { ArrayOptimizer } from '@tacticus/app-core/array-optimizations'

export function usePlayerSearchOptimized<
  T extends { display_name?: string; name?: string }
>(players: T[], query: string, maxResults: number = 8): T[] {
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const aName = a.display_name ?? a.name ?? ''
      const bName = b.display_name ?? b.name ?? ''
      return aName.toLowerCase().localeCompare(bName.toLowerCase())
    })
  }, [players])

  return useMemo(() => {
    if (!query.trim() || query.length < 2) return []

    return ArrayOptimizer.searchPlayers(sortedPlayers, query.trim(), maxResults)
  }, [sortedPlayers, query, maxResults])
}

/** Development only. */
export function usePerformanceMonitor(
  name: string,
  enabled: boolean = process.env.NODE_ENV === 'development'
) {
  const startTime = useRef<number>(0)

  const start = useCallback(() => {
    if (enabled) {
      startTime.current = performance.now()
    }
  }, [enabled])

  const end = useCallback(() => {
    if (enabled && startTime.current > 0) {
      const duration = performance.now() - startTime.current
      if (duration > 100) {
        console.log(`🚀 Performance: ${name} took ${duration.toFixed(2)}ms`)
      }
      startTime.current = 0
    }
  }, [enabled, name])

  return { start, end }
}

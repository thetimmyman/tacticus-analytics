'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.SeasonSelector')
import { useClusterContext } from '@/app/hooks/useClusterContext'

interface SeasonSelectorProps {
  currentSeason?: string
  selectedSeason?: number | null
  onSeasonChange?: (season: number | null) => void
  autoSelectLatest?: boolean
  compact?: boolean
}

export default function SeasonSelector({
  currentSeason,
  selectedSeason,
  onSeasonChange,
  autoSelectLatest = false,
  compact = false
}: SeasonSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const {
    guildCode,
    clusterCode,
    isLoading: isContextLoading
  } = useClusterContext()

  // Shared query (Navigation renders this twice). The RPC avoids lex-sorting TEXT "Season",
  // which let the row cap drop the newest seasons.
  const { data: availableSeasons = [], isLoading: isFetching } = useQuery({
    queryKey: ['seasonList', guildCode, clusterCode],
    enabled: !isContextLoading && !!guildCode,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async ({ signal }) => {
      // A hard reload aborts fetches before unmount; abort at navigation so teardown is
      // not reported as a fetch failure.
      const navigationController = new AbortController()
      const abortForNavigation = () => navigationController.abort()
      if (signal.aborted) abortForNavigation()
      else signal.addEventListener('abort', abortForNavigation, { once: true })
      window.addEventListener('beforeunload', abortForNavigation, {
        once: true
      })
      window.addEventListener('pagehide', abortForNavigation, { once: true })

      const { dbClient } = await import('@/app/lib/db/client')
      const supabase = dbClient()
      try {
        const { data, error } = await supabase
          .rpc('get_distinct_seasons_for_guild', {
            p_guild: guildCode ?? '',
            p_cluster_code: clusterCode ?? undefined
          })
          .abortSignal(navigationController.signal)
        if (navigationController.signal.aborted) return [] as string[]
        if (error) {
          logger.error({ err: error }, 'Error fetching seasons:')
          return [] as string[]
        }
        return Array.isArray(data) ? data : []
      } finally {
        signal.removeEventListener('abort', abortForNavigation)
        window.removeEventListener('beforeunload', abortForNavigation)
        window.removeEventListener('pagehide', abortForNavigation)
      }
    }
  })

  const loading = isContextLoading || (!!guildCode && isFetching)

  useEffect(() => {
    if (!autoSelectLatest || !onSeasonChange || selectedSeason != null) {
      return
    }
    const latestSeason = availableSeasons[0]
    if (!latestSeason) {
      return
    }
    const parsedSeason = Number.parseInt(latestSeason, 10)
    if (!Number.isNaN(parsedSeason)) {
      onSeasonChange(parsedSeason)
    }
  }, [autoSelectLatest, availableSeasons, onSeasonChange, selectedSeason])

  const handleSeasonChange = useCallback(
    (newSeason: string) => {
      if (onSeasonChange) {
        const numSeason = parseInt(newSeason, 10)
        onSeasonChange(Number.isNaN(numSeason) ? null : numSeason)
      } else {
        const params = new URLSearchParams(searchParams.toString())
        params.set('season', newSeason)
        router.push(`${pathname}?${params.toString()}`)
      }
    },
    [onSeasonChange, searchParams, router, pathname]
  )

  // Precedence (the server `currentSeason` can be stale): `selectedSeason` prop,
  // then URL ?season=, then availableSeasons[0], then `currentSeason` while empty.
  const urlSeason = searchParams.get('season')
  const resolvedSeasonValue =
    selectedSeason != null
      ? String(selectedSeason)
      : urlSeason
        ? urlSeason
        : (availableSeasons[0] ?? currentSeason ?? '')
  const seasonOptions = useMemo(() => {
    const options = [...availableSeasons]
    if (resolvedSeasonValue && !options.includes(resolvedSeasonValue)) {
      options.unshift(resolvedSeasonValue)
    }
    return options
  }, [availableSeasons, resolvedSeasonValue])

  const containerClassName = compact
    ? 'flex items-center shrink-0'
    : 'flex items-center space-x-2'
  const labelClassName = compact
    ? 'sr-only'
    : 'text-sm font-medium text-accent-wh40k'
  const selectorClassName = compact
    ? 'h-7 px-2 pr-6 rounded bg-card-bg border border-primary-wh40k text-primary-wh40k text-sm font-semibold tabular-nums shrink-0 min-w-[5.5rem] focus:border-accent-wh40k focus:outline-none'
    : 'px-3 py-1.5 rounded bg-card-bg border border-primary-wh40k text-primary-wh40k text-sm focus:border-accent-wh40k focus:outline-none'
  const selectorStyle = undefined

  if (loading) {
    return (
      <div className={containerClassName}>
        <label className={labelClassName}>Season:</label>
        <div
          className={`${compact ? 'w-16' : 'w-24'} h-8 bg-card-bg animate-pulse rounded`}
        ></div>
      </div>
    )
  }

  return (
    <div className={containerClassName}>
      <label htmlFor="season-select" className={labelClassName}>
        Season:
      </label>
      <select
        id="season-select"
        value={resolvedSeasonValue}
        onChange={(e) => handleSeasonChange(e.target.value)}
        className={selectorClassName}
        style={selectorStyle}
      >
        {seasonOptions.map((season) => (
          <option key={season} value={season}>
            {season}
          </option>
        ))}
      </select>
    </div>
  )
}

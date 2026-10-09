'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.SeasonSelector')
import { useClusterContext } from '@/app/hooks/useClusterContext'

const seasonErrorCodes = new Set([
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
  'PGRST116',
  'PGRST202',
  'PGRST301',
  'PGRST302',
  'PGRST303',
  '42501',
  '22023',
  '57014',
  '42P01',
  '42883'
])

function seasonRequestDiagnostic(
  status: unknown,
  error: unknown,
  queryAborted: boolean,
  navigationAborted: boolean
) {
  const value =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null
  const code = typeof value?.code === 'string' ? value.code : null
  const bytes =
    code !== null && code.length <= 8192
      ? new TextEncoder().encode(code).byteLength
      : null
  const oversized = code !== null && (bytes === null || bytes > 8192)
  const statusCode =
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 0 &&
    status <= 599
      ? status
      : -1
  const message = typeof value?.message === 'string' ? value.message : ''
  // These are reported SDK categories, not independently observed network causes.
  return {
    operation: 'season_list',
    request_category:
      statusCode === 0
        ? 'transport-result-error'
        : statusCode >= 400
          ? 'http-result-error'
          : statusCode >= 200 && statusCode < 300
            ? 'success-result-error'
            : 'other-result-error',
    status_code: statusCode,
    reported_error_name:
      ['AbortError', 'TypeError', 'FetchError', 'Error'].find((name) =>
        message.startsWith(`${name}:`)
      ) ?? 'other',
    error_code:
      code === null || code === ''
        ? 'none'
        : seasonErrorCodes.has(code)
          ? code
          : 'other',
    error_code_bytes: oversized ? null : bytes,
    error_code_size:
      code === null ? 'absent' : oversized ? 'oversized' : 'within-bound',
    query_aborted: queryAborted,
    navigation_aborted: navigationAborted
  }
}

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
        const { data, error, status } = await supabase
          .rpc('get_distinct_seasons_for_guild', {
            p_guild: guildCode ?? '',
            p_cluster_code: clusterCode ?? undefined
          })
          .abortSignal(navigationController.signal)
        if (navigationController.signal.aborted) return [] as string[]
        if (error) {
          logger.error(
            {
              err: error,
              ...seasonRequestDiagnostic(
                status,
                error,
                signal.aborted,
                navigationController.signal.aborted
              )
            },
            'Error fetching seasons:'
          )
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
    ? 'h-7 px-2 pr-6 rounded-sm bg-card-bg border border-primary-wh40k text-primary-wh40k text-sm font-semibold tabular-nums shrink-0 min-w-22 focus:border-accent-wh40k focus:outline-hidden'
    : 'px-3 py-1.5 rounded-sm bg-card-bg border border-primary-wh40k text-primary-wh40k text-sm focus:border-accent-wh40k focus:outline-hidden'
  const selectorStyle = undefined

  if (loading) {
    return (
      <div className={containerClassName}>
        <label className={labelClassName}>Season:</label>
        <div
          className={`${compact ? 'w-16' : 'w-24'} h-8 bg-card-bg animate-pulse rounded-sm`}
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

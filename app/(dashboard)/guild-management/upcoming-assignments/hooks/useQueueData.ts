import { useState, useCallback, useRef, useEffect } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.useQueueData'
)
import type { SolverResponse } from '../types'

export interface UseQueueDataReturn {
  data: SolverResponse | null
  loading: boolean
  error: string | null
  isStale: boolean
  fetchQueue: (
    mode: 'current',
    seasonNumber: string
  ) => Promise<SolverResponse | null>
  markStale: () => void
  setData: (data: SolverResponse | null) => void
}

export function useQueueData(): UseQueueDataReturn {
  const [data, setData] = useState<SolverResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const fetchQueue = useCallback(
    async (
      mode: 'current',
      seasonNumber: string
    ): Promise<SolverResponse | null> => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/guild-raid/unified-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            season_number: seasonNumber
          }),
          signal: controller.signal
        })

        if (!response.ok) {
          // Never render the raw body (e.g. HTML error pages).
          const body = await response.json().catch(() => null)
          throw new Error(
            extractErrorMessage(
              body,
              'Could not load the assignment queue. Please try again.'
            )
          )
        }

        const result = (await response.json()) as SolverResponse
        if (!result.success) {
          throw new Error(result.error || 'Queue fetch returned failure')
        }

        setData(result)
        setIsStale(false)
        return result
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return null
        const message =
          err instanceof Error ? err.message : 'Failed to fetch queue data'
        setError(message)
        logger.error({ error: message }, 'Queue data fetch failed')
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const markStale = useCallback(() => setIsStale(true), [])

  return { data, loading, error, isStale, fetchQueue, markStale, setData }
}

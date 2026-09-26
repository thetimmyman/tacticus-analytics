'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SYNC_FEEDS,
  readFeed,
  type SyncFeedKey,
  type SyncFeedReading,
  type SyncFeedStatus
} from '@/app/lib/sync/feed-freshness'

const REFETCH_MS = 60_000
const TICK_MS = 15_000

interface FreshnessResponse {
  feeds?: Array<{
    key: SyncFeedKey
    ageSeconds: number | null
    cadenceSeconds?: number
  }>
  serverTime?: string
  guildCode?: string | null
}

export function worstStatus(
  readings: SyncFeedReading[]
): SyncFeedStatus | null {
  if (readings.length === 0) return null
  const rank: Record<SyncFeedStatus, number> = {
    current: 0,
    late: 1,
    overdue: 2,
    never: 2
  }
  return readings.reduce(
    (worst, r) => (rank[r.status] > rank[worst] ? r.status : worst),
    'current' as SyncFeedStatus
  )
}

export function useSyncFeedFreshness(enabled: boolean = true): {
  readings: SyncFeedReading[]
  loaded: boolean
} {
  const lastWriteRef = useRef<Partial<Record<SyncFeedKey, number | null>>>({})
  const cadenceRef = useRef<Partial<Record<SyncFeedKey, number>>>({})
  const [readings, setReadings] = useState<SyncFeedReading[]>([])
  const [loaded, setLoaded] = useState(false)

  const recompute = useCallback(() => {
    const nowMs = Date.now()
    setReadings(
      SYNC_FEEDS.map((definition) =>
        readFeed(
          definition,
          lastWriteRef.current[definition.key] ?? null,
          nowMs,
          cadenceRef.current[definition.key]
        )
      )
    )
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // One controller per request: `pagehide` also fires on bfcache entry without unmounting, and a
    // long-lived controller would stay aborted after restore, making a healthy feed look stopped.
    const inFlight = new Set<AbortController>()
    const abortInFlight = () => {
      for (const controller of inFlight) controller.abort()
      inFlight.clear()
    }
    window.addEventListener('beforeunload', abortInFlight)
    window.addEventListener('pagehide', abortInFlight)

    const load = async () => {
      const controller = new AbortController()
      inFlight.add(controller)
      try {
        const res = await fetch('/api/sync/freshness', {
          credentials: 'include',
          signal: controller.signal
        })
        if (!res.ok) return
        const payload = (await res.json()) as FreshnessResponse
        if (cancelled || controller.signal.aborted) return

        const nowMs = Date.now()
        for (const feed of payload.feeds ?? []) {
          // Server sends an age, not an instant, so client clock skew is harmless.
          lastWriteRef.current[feed.key] =
            feed.ageSeconds === null ? null : nowMs - feed.ageSeconds * 1000
          if (typeof feed.cadenceSeconds === 'number') {
            cadenceRef.current[feed.key] = feed.cadenceSeconds
          }
        }
        setLoaded(true)
        recompute()
      } catch {
        // Keep the previous reading; blanking it would look like a recovery.
      } finally {
        inFlight.delete(controller)
      }
    }

    load()
    const refetch = setInterval(load, REFETCH_MS)
    const tick = setInterval(recompute, TICK_MS)
    return () => {
      cancelled = true
      abortInFlight()
      window.removeEventListener('beforeunload', abortInFlight)
      window.removeEventListener('pagehide', abortInFlight)
      clearInterval(refetch)
      clearInterval(tick)
    }
  }, [enabled, recompute])

  return { readings, loaded }
}

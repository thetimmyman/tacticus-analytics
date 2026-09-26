'use client'

import { useEffect, useState } from 'react'
import type { StatusResponse, StatusState } from '@/app/api/health/status/route'

const REFRESH_INTERVAL_MS = 60 * 1000

export const OPERATIONAL_STATE_STYLES: Record<
  StatusState,
  { dot: string; ring: string; label: string }
> = {
  green: {
    dot: 'bg-emerald-400',
    ring: 'ring-emerald-400/40',
    label: 'Operational'
  },
  yellow: { dot: 'bg-amber-400', ring: 'ring-amber-400/40', label: 'Degraded' },
  red: { dot: 'bg-red-500', ring: 'ring-red-500/40', label: 'Down' }
}

export function useOperationalStatus(): StatusResponse | null {
  const [data, setData] = useState<StatusResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/health/status', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as StatusResponse
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) {
          setData({ state: 'red', summary: 'Status check failed' })
        }
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return data
}

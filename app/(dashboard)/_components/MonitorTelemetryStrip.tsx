'use client'

import { useEffect, useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import type { TelemetryResponse } from '@/app/api/health/telemetry/route'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

function formatRelative(iso: string | null, hasMounted: boolean): string {
  if (!hasMounted) return '—'
  if (!iso) return 'never'
  const ageMs = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return '—'
  const seconds = Math.round(ageMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function formatCadence(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? '1 min' : `${minutes} min`
}

function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export default function MonitorTelemetryStrip() {
  const hasMounted = useHasMounted()
  const [data, setData] = useState<TelemetryResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchTelemetry = async () => {
      try {
        const res = await fetch('/api/health/telemetry', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as TelemetryResponse
        if (!cancelled) {
          setData(json)
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    fetchTelemetry()
    const interval = setInterval(fetchTelemetry, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (error || !data) {
    return null
  }

  return (
    <div className="border-t border-(--border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] px-4 py-2">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs text-(--text-tertiary)">
        <Kpi
          label="Last Poll"
          value={formatRelative(data.last_poll_at, hasMounted)}
        />
        <span className="opacity-40">·</span>
        <Kpi label="Cadence" value={formatCadence(data.poll_cadence_seconds)} />
        <span className="opacity-40">·</span>
        <Kpi label="API Calls (24h)" value={formatCount(data.api_calls_24h)} />
        <span className="opacity-40">·</span>
        <Kpi
          label="Errors (24h)"
          value={formatCount(data.errors_24h)}
          tone={data.errors_24h > 0 ? 'warn' : undefined}
        />
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'warn'
}) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <span className="text-secondary-wh40k uppercase tracking-wider">
        {label}
      </span>
      <span
        className={
          tone === 'warn'
            ? 'text-amber-400 font-semibold'
            : 'text-primary-wh40k'
        }
      >
        {value}
      </span>
    </span>
  )
}

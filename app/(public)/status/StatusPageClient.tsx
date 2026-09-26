'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Database,
  Shield,
  Calculator,
  Server,
  Activity,
  ExternalLink,
  RefreshCw
} from 'lucide-react'

interface HealthCheck {
  status: 'pass' | 'fail'
  responseTime?: number
  details: Record<string, unknown>
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  checks: {
    database?: HealthCheck
    auth?: HealthCheck
    calculations?: HealthCheck
  }
  memory?: {
    heapUsed: number
    heapTotal: number
    rss: number
    unit: string
  }
  uptime?: number
  environment?: string
  responseTime?: number
}

const StatusIcon = ({ status }: { status: 'pass' | 'fail' | 'unknown' }) => {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-5 w-5 text-emerald-400" />
    case 'fail':
      return <XCircle className="h-5 w-5 text-red-400" />
    default:
      return <AlertCircle className="h-5 w-5 text-[var(--text-secondary)]" />
  }
}

const ServiceCard = ({
  name,
  icon: Icon,
  status,
  responseTime,
  details
}: {
  name: string
  icon: React.ElementType
  status: 'pass' | 'fail' | 'unknown'
  responseTime?: number
  details?: string
}) => (
  <div className="bg-card/50 border border-[var(--card-border)] rounded-lg p-4">
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
      </div>
      <StatusIcon status={status} />
    </div>
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-secondary)]">
        {details || 'No details'}
      </span>
      {responseTime !== undefined && (
        <span className="text-[var(--text-secondary)]">{responseTime}ms</span>
      )}
    </div>
  </div>
)

const readDetailString = (
  details: Record<string, unknown> | undefined,
  key: string
) => {
  const value = details?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

const failedCheckDetails = (
  check: HealthCheck | undefined,
  fallback: string
) => {
  if (!check) return fallback
  return (
    readDetailString(check.details, 'error') ||
    (readDetailString(check.details, 'failedProbe')
      ? `Failed probe: ${readDetailString(check.details, 'failedProbe')}`
      : null) ||
    (readDetailString(check.details, 'probe')
      ? `Probe: ${readDetailString(check.details, 'probe')}`
      : null) ||
    (readDetailString(check.details, 'provider')
      ? `${readDetailString(check.details, 'provider')} unavailable`
      : null) ||
    fallback
  )
}

export default function StatusPageClient() {
  const hasMounted = useHasMounted()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchHealth = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/health', {
        cache: 'no-store'
      })
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
      const data = await response.json()
      setHealth(data)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  const getOverallStatusColor = () => {
    if (error) return 'bg-red-500'
    if (!health) return 'bg-slate-500'
    switch (health.status) {
      case 'healthy':
        return 'bg-emerald-500'
      case 'degraded':
        return 'bg-amber-500'
      case 'unhealthy':
        return 'bg-red-500'
      default:
        return 'bg-slate-500'
    }
  }

  const getOverallStatusText = () => {
    if (error) return 'Unable to connect'
    if (!health) return 'Checking...'
    switch (health.status) {
      case 'healthy':
        return 'All Systems Operational'
      case 'degraded':
        return 'Partial Service Disruption'
      case 'unhealthy':
        return 'Service Outage'
      default:
        return 'Unknown'
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Service Status
        </h1>
        <p className="text-[var(--text-secondary)]">
          Real-time status of Tacticus Analytics services
        </p>
      </div>

      {/* Overall Status */}
      <div className="bg-card/50 border border-[var(--card-border)] rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-4 h-4 rounded-full ${getOverallStatusColor()} animate-pulse`}
            />
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                {getOverallStatusText()}
              </h2>
              {lastUpdated && hasMounted && (
                <p className="text-sm text-[var(--text-secondary)] flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Updated{' '}
                  {
                    // eslint-disable-next-line no-restricted-syntax
                    lastUpdated.toLocaleTimeString()
                  }
                </p>
              )}
              {lastUpdated && !hasMounted && (
                <p className="text-sm text-[var(--text-secondary)] flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Updated —
                </p>
              )}
            </div>
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--card-bg)] hover:bg-slate-600 text-[var(--text-primary)] text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Service Checks */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Service Health
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ServiceCard
            name="Database"
            icon={Database}
            status={health?.checks.database?.status || 'unknown'}
            responseTime={health?.checks.database?.responseTime}
            details={
              health?.checks.database?.status === 'pass'
                ? 'Connected'
                : error ||
                  failedCheckDetails(health?.checks.database, 'Checking...')
            }
          />
          <ServiceCard
            name="Authentication"
            icon={Shield}
            status={health?.checks.auth?.status || 'unknown'}
            responseTime={health?.checks.auth?.responseTime}
            details={
              health?.checks.auth?.status === 'pass'
                ? 'Operational'
                : failedCheckDetails(health?.checks.auth, 'Checking...')
            }
          />
          <ServiceCard
            name="Metrics & Token State"
            icon={Calculator}
            status={health?.checks.calculations?.status || 'unknown'}
            responseTime={health?.checks.calculations?.responseTime}
            details={
              health?.checks.calculations?.status === 'pass'
                ? 'RPC probes available'
                : failedCheckDetails(health?.checks.calculations, 'Checking...')
            }
          />
        </div>
      </div>

      {/* System Info */}
      {health && (
        <div className="bg-card/30 border border-card-border/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Server className="h-4 w-4" />
            System Information
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[var(--text-secondary)]">Uptime</p>
              <p className="text-[var(--text-primary)] font-medium">
                {health.uptime ? formatUptime(health.uptime) : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Memory</p>
              <p className="text-[var(--text-primary)] font-medium">
                {health.memory
                  ? `${health.memory.heapUsed}/${health.memory.heapTotal} MB`
                  : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Response</p>
              <p className="text-[var(--text-primary)] font-medium">
                {health.responseTime ? `${health.responseTime}ms` : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Environment</p>
              <p className="text-[var(--text-primary)] font-medium">
                {health.environment || 'N/A'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Return to Tacticus Analytics
        </Link>
      </div>
    </div>
  )
}

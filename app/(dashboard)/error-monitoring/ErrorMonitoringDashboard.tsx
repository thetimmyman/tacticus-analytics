'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  AlertTriangle,
  TrendingUp,
  Clock,
  Bug,
  Download,
  RefreshCw
} from 'lucide-react'
import { Button, ClientDate } from '@tacticus/ui-kit'
import { getVersionInfo } from '@tacticus/app-core/error-handler'
import { createComponentLogger } from '@/app/lib/logging/client'
import { formatGuildCodeFallback } from '@/app/lib/format/guild'
const logger = createComponentLogger(
  'error-monitoring.ErrorMonitoringDashboard'
)

interface ErrorLogEntry {
  id: string
  code: string
  message: string
  category: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  timestamp: string
  version: string
  endpoint?: string
  user_id?: string
  guild_code?: string
  count: number
}

const secureRandom = (): number => {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return value[0]! / 0x1_0000_0000
}

const pickRandom = <T,>(items: readonly T[], fallback: T): T => {
  if (items.length === 0) {
    return fallback
  }

  const selected = items[Math.floor(secureRandom() * items.length)]
  return selected ?? fallback
}

// Simulated data; production would read the logging system.
const generateMockErrorData = (): ErrorLogEntry[] => {
  const errorCodes = [
    'UNAUTHORIZED',
    'INSUFFICIENT_PERMISSIONS',
    'INVALID_API_KEY',
    'DATABASE_ERROR',
    'FETCH_FAILED',
    'DISCORD_API_FAILURE',
    'TACTICUS_API_FAILURE',
    'MISSING_REQUIRED_FIELDS'
  ]

  const endpoints = [
    '/api/webhooks/save',
    '/api/player-api-key',
    '/api/discord-webhooks/leaderboard',
    '/api/meta-analysis/batch',
    '/api/guild/initial-sync',
    '/api/validate-api-key'
  ]

  const versions = ['1.39.52', '1.39.51', '1.39.50']
  const guilds = ['IW', 'AL', 'DA', 'HL', 'IH', 'RG', 'TS']

  const severityLevels: ErrorLogEntry['severity'][] = [
    'low',
    'medium',
    'high',
    'critical'
  ]

  const categories = ['auth', 'database', 'external', 'validation'] as const

  return Array.from({ length: 50 }, (_, i) => ({
    id: `error_${i}`,
    code: pickRandom(errorCodes, 'UNKNOWN_ERROR'),
    message: 'Error occurred during operation',
    category: pickRandom([...categories], 'external'),
    severity: pickRandom(severityLevels, 'low'),
    timestamp: new Date(
      Date.now() - secureRandom() * 7 * 24 * 60 * 60 * 1000
    ).toISOString(),
    version: pickRandom(versions, 'development'),
    endpoint: pickRandom(endpoints, '/api/status'),
    user_id:
      secureRandom() > 0.3
        ? `user_${Math.floor(secureRandom() * 100)}`
        : undefined,
    guild_code: secureRandom() > 0.4 ? pickRandom(guilds, 'IW') : undefined,
    count: Math.floor(secureRandom() * 20) + 1
  }))
}

export function ErrorMonitoringDashboard() {
  const [errors, setErrors] = useState<ErrorLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('24h')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all')
  const [selectedVersion, setSelectedVersion] = useState<string>('all')

  const versionInfo = getVersionInfo()

  useEffect(() => {
    loadErrorData()
  }, [timeRange])

  const loadErrorData = async () => {
    setLoading(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const mockData = generateMockErrorData()
      setErrors(mockData)
    } catch (error) {
      logger.error({ err: error }, 'Failed to load error monitoring data:')
    } finally {
      setLoading(false)
    }
  }

  const filteredErrors = useMemo(() => {
    let filtered = errors

    if (selectedSeverity !== 'all') {
      filtered = filtered.filter((error) => error.severity === selectedSeverity)
    }

    if (selectedVersion !== 'all') {
      filtered = filtered.filter((error) => error.version === selectedVersion)
    }

    return filtered.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  }, [errors, selectedSeverity, selectedVersion])

  const errorStats = useMemo(() => {
    const total = filteredErrors.length
    const totalOccurrences = filteredErrors.reduce(
      (sum, error) => sum + error.count,
      0
    )

    const bySeverity = filteredErrors.reduce(
      (acc, error) => {
        acc[error.severity] = (acc[error.severity] || 0) + error.count
        return acc
      },
      {} as Record<string, number>
    )

    const byVersion = filteredErrors.reduce(
      (acc, error) => {
        acc[error.version] = (acc[error.version] || 0) + error.count
        return acc
      },
      {} as Record<string, number>
    )

    const topErrors = Object.entries(
      filteredErrors.reduce(
        (acc, error) => {
          acc[error.code] = (acc[error.code] || 0) + error.count
          return acc
        },
        {} as Record<string, number>
      )
    )
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)

    return {
      total,
      totalOccurrences,
      bySeverity,
      byVersion,
      topErrors
    }
  }, [filteredErrors])

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-400 bg-red-500/10'
      case 'high':
        return 'text-orange-400 bg-orange-500/10'
      case 'medium':
        return 'text-yellow-400 bg-yellow-500/10'
      case 'low':
        return 'text-blue-400 bg-blue-500/10'
      default:
        return 'text-gray-400 bg-gray-500/10'
    }
  }

  const exportErrorData = () => {
    const csv = [
      'Code,Message,Severity,Version,Timestamp,Endpoint,Guild,Count',
      ...filteredErrors.map(
        (error) =>
          `${error.code},"${error.message}",${error.severity},${error.version},${error.timestamp},${error.endpoint || ''},${error.guild_code || ''},${error.count}`
      )
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `error-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 animate-spin text-[var(--primary)]" />
        <span className="ml-3 text-[var(--text-secondary)]">
          Loading error data...
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--text-secondary)] text-sm">
                Total Errors
              </p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {errorStats.total}
              </p>
            </div>
            <Bug className="w-8 h-8 text-red-400" />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--text-secondary)] text-sm">
                Total Occurrences
              </p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {errorStats.totalOccurrences}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-orange-400" />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--text-secondary)] text-sm">
                Critical Errors
              </p>
              <p className="text-2xl font-bold text-red-400">
                {errorStats.bySeverity.critical || 0}
              </p>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--text-secondary)] text-sm">
                Current Version
              </p>
              <p className="text-lg font-bold text-[var(--primary)]">
                {versionInfo.version}
              </p>
            </div>
            <Clock className="w-8 h-8 text-[var(--primary)]" />
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Time Range
              </label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded text-[var(--text-primary)]"
              >
                <option value="1h">Last Hour</option>
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Severity
              </label>
              <select
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded text-[var(--text-primary)]"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Version
              </label>
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded text-[var(--text-primary)]"
              >
                <option value="all">All Versions</option>
                {Object.keys(errorStats.byVersion).map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={loadErrorData} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button onClick={exportErrorData}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Top Errors */}
      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Top Error Codes
        </h3>
        <div className="space-y-3">
          {errorStats.topErrors.map(([code, count]) => (
            <div
              key={code}
              className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] hover:bg-card/80 transition-colors duration-200 rounded"
            >
              <span className="font-mono text-[var(--text-primary)]">
                {code}
              </span>
              <span className="text-[var(--text-secondary)]">
                {count} occurrences
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Error List */}
      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg">
        <div className="p-6 border-b border-[var(--card-border)]">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Recent Errors
          </h3>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            Showing {filteredErrors.length} error types
          </p>
        </div>

        <div className="divide-y divide-[var(--card-border)]">
          {filteredErrors.slice(0, 20).map((error) => (
            <div key={error.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-[var(--text-primary)] bg-[var(--bg-secondary)] px-2 py-1 rounded text-sm">
                      {error.code}
                    </span>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(error.severity)}`}
                    >
                      {error.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">
                      v{error.version}
                    </span>
                  </div>

                  <p className="text-[var(--text-secondary)] mb-2">
                    {error.message}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                    <span>
                      <ClientDate date={error.timestamp} format="full" />
                    </span>
                    {error.endpoint && <span>{error.endpoint}</span>}
                    {error.guild_code ? (
                      <span>
                        Guild: {formatGuildCodeFallback(error.guild_code)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-lg font-bold text-[var(--text-primary)]">
                    {error.count}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    occurrences
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredErrors.length > 20 && (
          <div className="p-6 border-t border-[var(--card-border)] text-center">
            <p className="text-[var(--text-secondary)]">
              Showing 20 of {filteredErrors.length} errors. Export CSV for
              complete data.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

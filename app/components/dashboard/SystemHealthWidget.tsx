'use client'

import { useState, useEffect } from 'react'
import { UserRole } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.dashboard.SystemHealthWidget')

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    database: { status: string }
    auth: { status: string }
    calculations: { status: string }
  }
}

interface SystemHealthWidgetProps {
  userRole?: UserRole
}

export function SystemHealthWidget({ userRole }: SystemHealthWidgetProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health')
      const data = await res.json()
      setHealth(data)
    } catch (err) {
      logger.error({ err: err }, 'Failed to fetch health status:')
    } finally {
      setLoading(false)
    }
  }

  if (loading || !health) {
    return null
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'pass':
        return 'bg-green-500'
      case 'degraded':
        return 'bg-amber-500'
      case 'unhealthy':
      case 'fail':
        return 'bg-red-500'
      default:
        return 'bg-(--card-bg)'
    }
  }

  const allHealthy = health.status === 'healthy'

  if (allHealthy && userRole !== 'leader') {
    return null
  }

  return (
    <div
      className={`rounded-lg p-3 sm:p-4 ${
        allHealthy
          ? 'bg-green-500/10 border border-green-500/30'
          : health.status === 'degraded'
            ? 'bg-amber-500/10 border border-amber-500/30'
            : 'bg-red-500/10 border border-red-500/30'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 sm:space-x-3">
          <div
            className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${getStatusColor(health.status)} animate-pulse`}
          />
          <div>
            <h3 className="text-xs sm:text-sm font-medium text-primary-wh40k">
              System Status:{' '}
              {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
            </h3>
            <div className="flex flex-wrap items-center gap-2 sm:gap-0 sm:space-x-4 mt-1 text-[10px] sm:text-xs text-secondary-wh40k">
              <span className="flex items-center space-x-1">
                <div
                  className={`w-2 h-2 rounded-full ${getStatusColor(health.checks.database.status)}`}
                />
                <span>Database</span>
              </span>
              <span className="flex items-center space-x-1">
                <div
                  className={`w-2 h-2 rounded-full ${getStatusColor(health.checks.auth.status)}`}
                />
                <span>Auth</span>
              </span>
              <span className="flex items-center space-x-1">
                <div
                  className={`w-2 h-2 rounded-full ${getStatusColor(health.checks.calculations.status)}`}
                />
                <span>Metrics</span>
              </span>
            </div>
          </div>
        </div>

        {userRole === 'leader' && (
          <span className="text-xs text-secondary-wh40k">
            {/* Monitoring dashboard removed during cleanup */}
          </span>
        )}
      </div>
    </div>
  )
}

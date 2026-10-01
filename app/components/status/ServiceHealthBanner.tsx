'use client'

import { useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  AlertTriangle,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import {
  useServiceHealth,
  SERVICE_DISPLAY_NAMES,
  type ServiceName
} from '@/app/contexts/ServiceHealthContext'

interface ServiceHealthBannerProps {
  dismissible?: boolean
  defaultExpanded?: boolean
  className?: string
}

export function ServiceHealthBanner({
  dismissible = true,
  defaultExpanded = false,
  className = ''
}: ServiceHealthBannerProps) {
  const hasMounted = useHasMounted()
  const {
    overall,
    getDegradedServices,
    getUnavailableServices,
    refresh,
    isLoading,
    lastChecked
  } = useServiceHealth()
  const [isDismissed, setIsDismissed] = useState(false)
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [prevOverall, setPrevOverall] = useState(overall)

  // Healthy → unhealthy resets dismissal.
  if (overall !== prevOverall) {
    setPrevOverall(overall)
    if (prevOverall === 'healthy' && overall !== 'healthy' && isDismissed) {
      setIsDismissed(false)
    }
  }

  if (
    typeof window === 'undefined' ||
    overall === 'healthy' ||
    isDismissed ||
    isLoading
  ) {
    return null
  }

  const degradedServices = getDegradedServices()
  const unavailableServices = getUnavailableServices()
  const allAffectedServices = [...unavailableServices, ...degradedServices]

  if (allAffectedServices.length === 0) {
    return null
  }

  const isUnavailable = overall === 'unavailable'
  const bannerBg = isUnavailable
    ? 'bg-red-500/90'
    : 'bg-linear-to-r from-amber-500 to-orange-500'
  const textColor = isUnavailable ? 'text-white' : 'text-black'

  const formatServiceList = (services: ServiceName[]): string => {
    return services.map((s) => SERVICE_DISPLAY_NAMES[s]).join(', ')
  }

  return (
    <div
      className={`${bannerBg} ${textColor} px-4 py-2 shadow-lg z-40 ${className}`}
    >
      <div className="container mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {isUnavailable ? 'Service Disruption' : 'Limited Service'}
              {' – '}
              {unavailableServices.length > 0 && (
                <>
                  {formatServiceList(unavailableServices)}
                  {unavailableServices.length === 1 ? ' is' : ' are'}{' '}
                  unavailable
                </>
              )}
              {unavailableServices.length > 0 &&
                degradedServices.length > 0 &&
                ', '}
              {degradedServices.length > 0 && (
                <>
                  {formatServiceList(degradedServices)}
                  {degradedServices.length === 1 ? ' is' : ' are'} degraded
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`p-1 rounded-sm hover:bg-black/10 transition-colors ${textColor}`}
              aria-label={isExpanded ? 'Hide details' : 'Show details'}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            <button
              onClick={() => refresh()}
              disabled={isLoading}
              className={`p-1 rounded-sm hover:bg-black/10 transition-colors ${textColor} disabled:opacity-50`}
              aria-label="Refresh status"
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
            </button>

            {dismissible && (
              <button
                onClick={() => setIsDismissed(true)}
                className={`p-1 rounded-sm hover:bg-black/10 transition-colors ${textColor}`}
                aria-label="Dismiss banner"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div
            className={`mt-2 pt-2 border-t ${isUnavailable ? 'border-white/20' : 'border-black/10'} text-sm`}
          >
            <p className="opacity-90">
              {isUnavailable
                ? '++ Grave machine-fault ++ Several cogitators are unresponsive. Some features may not work correctly. The Tech-Priests are conducting the rites of repair.'
                : '++ Reduced rites ++ Some features are operating with limited functionality. The Tech-Priests are restoring full service.'}
            </p>
            {lastChecked && hasMounted && (
              <p className="mt-1 opacity-75 text-xs">
                Last checked:{' '}
                {
                  // eslint-disable-next-line no-restricted-syntax
                  lastChecked.toLocaleTimeString()
                }
              </p>
            )}
            {lastChecked && !hasMounted && (
              <p className="mt-1 opacity-75 text-xs">Last checked: —</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

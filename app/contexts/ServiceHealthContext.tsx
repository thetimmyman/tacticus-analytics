'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode
} from 'react'
import { useToast } from '@/app/hooks/useToast'

export type ServiceStatus = 'healthy' | 'degraded' | 'unavailable'

export type ServiceName =
  'database' | 'auth' | 'calculations' | 'docker' | 'circuits'

export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  database: 'Database',
  auth: 'Authentication',
  calculations: 'Metrics Data Layer',
  docker: 'Infrastructure',
  circuits: 'External APIs'
}

interface HealthCheckResult {
  status: 'pass' | 'fail'
  responseTime?: number
  details: Record<string, unknown>
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  checks: Record<string, HealthCheckResult>
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    unit: string
  }
  uptime: number
  environment: string
  deployment: string
  responseTime: number
  requestId?: string
}

export interface ServiceHealth {
  database: ServiceStatus
  auth: ServiceStatus
  calculations: ServiceStatus
  docker: ServiceStatus
  circuits: ServiceStatus
  overall: ServiceStatus
  lastChecked: Date | null
  isLoading: boolean
  error: string | null
  responseTime: number | null
}

interface ServiceHealthContextValue extends ServiceHealth {
  refresh: () => Promise<void>
  getServiceStatus: (service: ServiceName) => ServiceStatus
  isServiceAvailable: (service: ServiceName) => boolean
  getDegradedServices: () => ServiceName[]
  getUnavailableServices: () => ServiceName[]
}

const DEFAULT_HEALTH: ServiceHealth = {
  database: 'healthy',
  auth: 'healthy',
  calculations: 'healthy',
  docker: 'healthy',
  circuits: 'healthy',
  overall: 'healthy',
  lastChecked: null,
  isLoading: true,
  error: null,
  responseTime: null
}

const ServiceHealthContext = createContext<ServiceHealthContextValue | null>(
  null
)

const HEALTH_CHECK_TIMEOUT_MS = 10000

function mapHealthResponse(
  response: HealthResponse
): Omit<ServiceHealth, 'isLoading' | 'error'> {
  const getStatus = (check: HealthCheckResult | undefined): ServiceStatus => {
    if (!check) return 'healthy' // Assume healthy if not checked
    return check.status === 'pass' ? 'healthy' : 'unavailable'
  }

  // Open circuits mean degraded, not unavailable.
  const getCircuitStatus = (
    check: HealthCheckResult | undefined
  ): ServiceStatus => {
    if (!check) return 'healthy'
    if (check.status === 'pass') return 'healthy'
    const details = check.details as { open?: number; halfOpen?: number }
    if (details.open && details.open > 0) return 'degraded'
    if (details.halfOpen && details.halfOpen > 0) return 'degraded'
    return 'healthy'
  }

  const database = getStatus(response.checks.database)
  const auth = getStatus(response.checks.auth)
  const calculations = getStatus(response.checks.calculations)
  const docker = response.checks.docker
    ? getStatus(response.checks.docker)
    : 'healthy'
  const circuits = response.checks.circuits
    ? getCircuitStatus(response.checks.circuits)
    : 'healthy'

  let overall: ServiceStatus = 'healthy'
  const allStatuses = [database, auth, calculations, docker, circuits]

  if (allStatuses.some((s) => s === 'unavailable')) {
    if (database === 'unavailable' || auth === 'unavailable') {
      overall = 'unavailable'
    } else {
      overall = 'degraded'
    }
  } else if (allStatuses.some((s) => s === 'degraded')) {
    overall = 'degraded'
  }

  if (response.status === 'unhealthy') {
    overall = 'unavailable'
  } else if (response.status === 'degraded' && overall === 'healthy') {
    overall = 'degraded'
  }

  return {
    database,
    auth,
    calculations,
    docker,
    circuits,
    overall,
    lastChecked: new Date(response.timestamp),
    responseTime: response.responseTime
  }
}

interface ServiceHealthProviderProps {
  children: ReactNode
  pollingInterval?: number
  showRecoveryToasts?: boolean
}

export function ServiceHealthProvider({
  children,
  pollingInterval = 60000,
  showRecoveryToasts = true
}: ServiceHealthProviderProps) {
  const [health, setHealth] = useState<ServiceHealth>(DEFAULT_HEALTH)
  const previousHealthRef = useRef<ServiceHealth>(DEFAULT_HEALTH)
  const { toast } = useToast()

  const checkHealth = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      // A TimeoutError reason matches what AbortSignal.timeout() would produce.
      () =>
        controller.abort(
          new DOMException('The operation timed out.', 'TimeoutError')
        ),
      HEALTH_CHECK_TIMEOUT_MS
    )

    try {
      const response = await fetch('/api/health', {
        // Explicit controller: older Safari lacks AbortSignal.timeout.
        signal: controller.signal
      })

      if (!response.ok) {
        setHealth((prev) => ({
          ...prev,
          overall: 'unavailable',
          isLoading: false,
          error: `Health check failed: ${response.status}`,
          lastChecked: new Date()
        }))
        return
      }

      const data: HealthResponse = await response.json()
      const mapped = mapHealthResponse(data)

      setHealth(() => ({
        ...mapped,
        isLoading: false,
        error: null
      }))
    } catch (error) {
      setHealth((prev) => ({
        ...prev,
        overall: 'degraded',
        isLoading: false,
        error: error instanceof Error ? error.message : 'Health check failed',
        lastChecked: new Date()
      }))
    } finally {
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (!showRecoveryToasts || health.isLoading) return

    const prevHealth = previousHealthRef.current
    const services: ServiceName[] = [
      'database',
      'auth',
      'calculations',
      'docker',
      'circuits'
    ]

    for (const service of services) {
      const prevStatus = prevHealth[service]
      const currentStatus = health[service]

      if (
        (prevStatus === 'unavailable' || prevStatus === 'degraded') &&
        currentStatus === 'healthy'
      ) {
        toast.success(
          `${SERVICE_DISPLAY_NAMES[service]} restored`,
          'Service is now operating normally'
        )
      }

      if (prevStatus === 'healthy' && currentStatus === 'unavailable') {
        toast.error(
          `${SERVICE_DISPLAY_NAMES[service]} unavailable`,
          'Some features may not work correctly'
        )
      }

      if (prevStatus === 'healthy' && currentStatus === 'degraded') {
        toast.warning(
          `${SERVICE_DISPLAY_NAMES[service]} degraded`,
          'Service operating with limited functionality'
        )
      }
    }

    previousHealthRef.current = health
  }, [health, showRecoveryToasts, toast])

  useEffect(() => {
    checkHealth()
  }, [checkHealth])

  useEffect(() => {
    if (pollingInterval <= 0) return

    const interval = setInterval(checkHealth, pollingInterval)
    return () => clearInterval(interval)
  }, [checkHealth, pollingInterval])

  const getServiceStatus = useCallback(
    (service: ServiceName): ServiceStatus => {
      return health[service]
    },
    [health]
  )

  const isServiceAvailable = useCallback(
    (service: ServiceName): boolean => {
      return health[service] !== 'unavailable'
    },
    [health]
  )

  const getDegradedServices = useCallback((): ServiceName[] => {
    const services: ServiceName[] = [
      'database',
      'auth',
      'calculations',
      'docker',
      'circuits'
    ]
    return services.filter((s) => health[s] === 'degraded')
  }, [health])

  const getUnavailableServices = useCallback((): ServiceName[] => {
    const services: ServiceName[] = [
      'database',
      'auth',
      'calculations',
      'docker',
      'circuits'
    ]
    return services.filter((s) => health[s] === 'unavailable')
  }, [health])

  const contextValue: ServiceHealthContextValue = {
    ...health,
    refresh: checkHealth,
    getServiceStatus,
    isServiceAvailable,
    getDegradedServices,
    getUnavailableServices
  }

  return (
    <ServiceHealthContext.Provider value={contextValue}>
      {children}
    </ServiceHealthContext.Provider>
  )
}

export function useServiceHealth(): ServiceHealthContextValue {
  const context = useContext(ServiceHealthContext)
  if (!context) {
    // Defaults outside the provider (e.g. SSR).
    return {
      ...DEFAULT_HEALTH,
      refresh: async () => {},
      getServiceStatus: () => 'healthy',
      isServiceAvailable: () => true,
      getDegradedServices: () => [],
      getUnavailableServices: () => []
    }
  }
  return context
}

export function useServiceStatus(service: ServiceName): ServiceStatus {
  const health = useServiceHealth()
  return health.getServiceStatus(service)
}

export function useIsServiceAvailable(service: ServiceName): boolean {
  const health = useServiceHealth()
  return health.isServiceAvailable(service)
}

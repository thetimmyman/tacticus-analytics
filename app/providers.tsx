'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState, useEffect } from 'react'
import { CACHE_CONFIG } from '@/app/lib/config/constants'
import { ToastProvider } from './providers/ToastProvider'
import { CornerDockProvider } from './providers/CornerDockContext'
import { SyncStatusPanel } from './components/ui/SyncStatusPanel'
import { ErrorBoundary } from './components/error/ErrorBoundary'
import {
  WinterThemeProvider,
  BossEasterEggProvider
} from './components/seasonal'
import { ServiceHealthProvider } from './contexts/ServiceHealthContext'
import { ServiceHealthBanner } from './components/status/ServiceHealthBanner'
import { useClusterContext } from '@/app/hooks/useClusterContext'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('providers')

function AuthenticatedSyncStatusPanel() {
  const { userId } = useClusterContext()

  // The freshness endpoint needs a membership, so anonymous pages never mount the poller.
  return userId ? <SyncStatusPanel /> : null
}

/** React Query configuration tuned to reduce database egress. */
export function Providers({ children }: { children: React.ReactNode }) {
  // Per-request client so data is never shared between users.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: CACHE_CONFIG.STALE_TIME.DEFAULT,
            gcTime: 60 * 60 * 1000, // 1 hour

            retry: (failureCount, error: unknown) => {
              const errorStatus =
                error && typeof error === 'object' && 'status' in error
                  ? (error as { status: number }).status
                  : null
              if (errorStatus && errorStatus >= 400 && errorStatus < 500)
                return false
              return failureCount < 2
            },

            refetchOnWindowFocus: false,
            refetchOnMount: false, // Prevent refetch when component mounts if data exists
            refetchInterval: false, // No automatic refetching (handled by background sync)
            refetchOnReconnect: true, // Only refetch when connection is restored

            networkMode: 'offlineFirst' // Try cache first, then network
          },
          mutations: {
            retry: 1,
            networkMode: 'online'
          }
        }
      })
  )

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (process.env.NODE_ENV === 'development' && event.type === 'updated') {
        const { query } = event
        if (query.state.error) {
          console.warn('[QueryCache] error', query.queryHash, query.state.error)
        }
      }
    })

    return unsubscribe
  }, [queryClient])

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        logger.error(
          {
            error,
            errorInfo,
            component: 'RootProviders'
          },
          'Root-level application error:'
        )
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ServiceHealthProvider>
            <ServiceHealthBanner />
            <WinterThemeProvider>
              <BossEasterEggProvider>
                {/* Lets the dashboard Tech Priest dock suppress the global SYS chip. */}
                <CornerDockProvider>
                  {children}
                  <AuthenticatedSyncStatusPanel />
                </CornerDockProvider>
              </BossEasterEggProvider>
            </WinterThemeProvider>
          </ServiceHealthProvider>
          {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

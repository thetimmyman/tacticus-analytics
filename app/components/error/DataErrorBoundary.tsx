'use client'

import React from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { RefreshCcw, AlertCircle } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.error.DataErrorBoundary')

interface DataErrorBoundaryProps {
  children: React.ReactNode
  onRetry?: () => void
  fallbackMessage?: string
}

export function DataErrorBoundary({
  children,
  onRetry,
  fallbackMessage = 'Failed to load data'
}: DataErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)]">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-(--accent)" />
            <div className="flex-1">
              <p className="text-primary-wh40k font-medium">
                {fallbackMessage}
              </p>
              <p className="text-sm text-secondary-wh40k mt-1">
                There was an issue loading the data. Please try again.
              </p>
            </div>
            {onRetry && (
              <Button
                onClick={onRetry}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                Retry
              </Button>
            )}
          </div>
        </div>
      }
      onError={(error, errorInfo) => {
        logger.error(
          {
            error,
            errorInfo,
            component: 'DataErrorBoundary'
          },
          'Data fetch error:'
        )
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

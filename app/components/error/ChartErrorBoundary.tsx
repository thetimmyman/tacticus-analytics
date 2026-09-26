'use client'

import React from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { BarChart3 } from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.error.ChartErrorBoundary')

interface ChartErrorBoundaryProps {
  children: React.ReactNode
  chartName?: string
}

export function ChartErrorBoundary({
  children,
  chartName = 'Chart'
}: ChartErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex flex-col items-center justify-center p-8 bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] min-h-[300px]">
          <div className="flex items-center justify-center w-12 h-12 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] rounded-full mb-4">
            <BarChart3 className="w-6 h-6 text-[var(--accent)]" />
          </div>
          <h3 className="text-[var(--text-primary)] font-medium mb-2">
            {chartName} Unavailable
          </h3>
          <p className="text-sm text-[var(--text-secondary)] text-center max-w-sm">
            Unable to render the chart. The data may be incomplete or
            unavailable.
          </p>
        </div>
      }
      onError={(error, errorInfo) => {
        logger.error(
          {
            error,
            errorInfo,
            chartName,
            component: 'ChartErrorBoundary'
          },
          'Chart rendering error:'
        )
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

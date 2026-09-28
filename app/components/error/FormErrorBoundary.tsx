'use client'

import React from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { AlertCircle } from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.error.FormErrorBoundary')

interface FormErrorBoundaryProps {
  children: React.ReactNode
  formName?: string
}

export function FormErrorBoundary({
  children,
  formName = 'Form'
}: FormErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-6 bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 rounded-lg border border-red-500/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
            <div>
              <h3 className="text-primary-wh40k font-medium mb-2">
                {formName} Error
              </h3>
              <p className="text-sm text-secondary-wh40k mb-3">
                There was an issue with the form. Please refresh the page and
                try again.
              </p>
              <p className="text-xs text-secondary-wh40k">
                If this issue persists, your data may have been saved. Check
                before resubmitting.
              </p>
            </div>
          </div>
        </div>
      }
      onError={(error, errorInfo) => {
        logger.error(
          {
            error,
            errorInfo,
            formName,
            component: 'FormErrorBoundary'
          },
          'Form error:'
        )
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

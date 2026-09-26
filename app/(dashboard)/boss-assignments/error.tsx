'use client'

import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
import { captureSentryException } from '@/app/lib/monitoring/sentry'

const logger = createComponentLogger('boss-assignments.error')

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function BossAssignmentsError({ error, reset }: ErrorProps) {
  useEffect(() => {
    logger.error({ err: error }, 'Boss assignments error:')
    // Route-segment boundaries bypass global-error, so report to Sentry here.
    captureSentryException(error)
  }, [error])

  return (
    <div className="px-4 py-10">
      <div className="card-wh40k mx-auto max-w-md p-8 text-center">
        <h2 className="subheading-wh40k text-lg">Assignments unavailable</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          The Machine Spirit could not marshal the boss assignments. The fault
          may be transient.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-[var(--text-tertiary)]">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={() => reset()}
          className="mt-5 inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  )
}

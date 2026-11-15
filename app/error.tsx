'use client'

import { useEffect, useState } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { browserRenderErrorTags } from '@/app/lib/monitoring/browser-render-error'
import { isTransientBrowserBoundaryError } from '@/app/lib/monitoring/browser-boundary-filter'
import {
  handleChunkLoadError,
  isChunkLoadError,
  type ChunkReloadOutcome
} from '@/app/lib/client/chunk-reload'

const logger = createComponentLogger('app.error')

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [outcome, setOutcome] = useState<ChunkReloadOutcome | 'pending'>(() =>
    isChunkLoadError(error) ? 'pending' : 'ignored'
  )

  useEffect(() => {
    logger.error({ err: error }, 'Route error boundary caught an error')
    // Stale/corrupted chunks get the guarded once-per-build reload; only
    // errors the guard did not already report (or suppress) are captured here.
    const result = handleChunkLoadError(error)
    setOutcome(result)
    if (result !== 'ignored' || isTransientBrowserBoundaryError(error)) {
      return
    }
    // This boundary catches far more than global-error; report so nothing is lost.
    captureSentryException(error, {
      tags: {
        component: 'app-error',
        ...browserRenderErrorTags(
          error,
          typeof window !== 'undefined' ? window.location.pathname : undefined
        )
      }
    })
  }, [error])

  if (outcome === 'pending' || outcome === 'attempted') {
    return null
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <h2>++ Cogitator fault ++ The Machine Spirit faltered.</h2>
        {error.digest && (
          <p className="mt-2 text-sm text-gray-400">
            Error ID: <code>{error.digest}</code>
          </p>
        )}
        <button
          onClick={() => reset()}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-sm hover:bg-red-700"
        >
          Invoke the rite of repair
        </button>
      </div>
    </div>
  )
}

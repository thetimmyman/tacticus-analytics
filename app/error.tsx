'use client'

import { useEffect } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
import { captureSentryException } from '@/app/lib/monitoring/sentry'

const logger = createComponentLogger('app.error')

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error({ err: error }, 'Route error boundary caught an error')
    // This boundary catches far more than global-error; report so nothing is lost.
    captureSentryException(error)
  }, [error])

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
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Invoke the rite of repair
        </button>
      </div>
    </div>
  )
}

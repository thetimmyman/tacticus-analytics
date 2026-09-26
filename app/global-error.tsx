'use client'

import { useEffect, useState } from 'react'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import {
  handleChunkLoadError,
  isChunkLoadError,
  type ChunkReloadOutcome
} from '@/app/lib/client/chunk-reload'

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // A stale chunk can throw at render: use the same once-per-build reload guard
  // as the window listeners, seeded from isChunkLoadError() so nothing flashes.
  const [outcome, setOutcome] = useState<ChunkReloadOutcome | 'pending'>(() =>
    isChunkLoadError(error) ? 'pending' : 'ignored'
  )

  useEffect(() => {
    const result = handleChunkLoadError(error)
    setOutcome(result)
    // Report only errors handleChunkLoadError did not already report.
    if (result === 'ignored') {
      captureSentryException(error)
    }
  }, [error])

  if (outcome === 'pending' || outcome === 'attempted') {
    return null
  }

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#020617',
            color: 'white'
          }}
        >
          <h1
            style={{
              fontSize: '2rem',
              fontWeight: 'bold',
              marginBottom: '1rem'
            }}
          >
            ++ Machine Spirit displeased ++ A grave fault has occurred.
          </h1>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
            The Tech-Priests have been alerted via noospheric vox.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#2563eb',
              borderRadius: '0.375rem',
              border: 'none',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Invoke the rite of repair
          </button>
        </div>
      </body>
    </html>
  )
}

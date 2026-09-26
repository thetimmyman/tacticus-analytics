'use client'

import { Spinner } from '@tacticus/ui-kit'

import { useState, useEffect } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  RadixDialog,
  RadixDialogContent,
  RadixDialogHeader,
  RadixDialogTitle,
  RadixDialogDescription,
  RadixDialogFooter
} from '@tacticus/ui-kit/radix-dialog'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('profile.RequestMyDataButton')

type ExportStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'

export default function RequestMyDataButton() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasMounted = useHasMounted()

  const reset = () => {
    setStatus('idle')
    setRequestId(null)
    setDownloadUrl(null)
    setError(null)
  }

  const handleRequest = async () => {
    setStatus('pending')
    setError(null)
    try {
      const response = await fetch('/api/gdpr/my-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(
          extractErrorMessage(data, 'Failed to create data export request')
        )
      }

      const data = await response.json()
      setRequestId(data.requestId)
      setStatus(data.status === 'completed' ? 'completed' : 'processing')
    } catch (err) {
      logger.error({ err: err }, 'GDPR data request failed:')
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to create data export request'
      )
      setStatus('failed')
    }
  }

  useEffect(() => {
    if (status !== 'processing' || !requestId) return

    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch(`/api/gdpr/my-data/${requestId}`)
        if (!response.ok) return
        const data = await response.json()
        if (cancelled) return
        if (data.status === 'completed' && data.downloadUrl) {
          setDownloadUrl(data.downloadUrl)
          setStatus('completed')
        } else if (data.status === 'failed') {
          setStatus('failed')
          setError('Export generation failed. Please try again later.')
        }
      } catch (err) {
        logger.error({ err: err }, 'Polling GDPR export status failed:')
      }
    }

    const interval = setInterval(poll, 3000)
    void poll()
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [status, requestId])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-wh40k bg-blue-900/20 border-blue-500/30 hover:bg-blue-900/30 text-blue-300"
      >
        Request My Data (GDPR)
      </button>

      <RadixDialog
        open={open}
        onOpenChange={(next) => {
          if (status === 'pending' || status === 'processing') return
          setOpen(next)
          if (!next) reset()
        }}
      >
        <RadixDialogContent className="max-w-md">
          <RadixDialogHeader>
            <RadixDialogTitle className="text-blue-300">
              Request a Copy of Your Data
            </RadixDialogTitle>
            <RadixDialogDescription>
              Under GDPR Article 15, you can request a copy of the personal data
              we hold about you. We&apos;ll generate a JSON export including
              your profile, guild memberships, and battle history.
            </RadixDialogDescription>
          </RadixDialogHeader>

          <div className="my-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                {error}
              </div>
            )}

            {status === 'idle' && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-blue-200">
                Export links are valid for 7 days and can be downloaded
                privately once generated. Most exports complete within a minute.
              </div>
            )}

            {(status === 'pending' || status === 'processing') && (
              <div className="p-6 text-center space-y-4">
                <Spinner size="lg" className="h-10 w-10 text-blue-400" />
                <p className="text-[var(--text-secondary)]">
                  {status === 'pending'
                    ? 'Creating export request…'
                    : 'Generating your data export…'}
                </p>
                {requestId && (
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Request ID: <span className="font-mono">{requestId}</span>
                  </p>
                )}
              </div>
            )}

            {status === 'completed' && downloadUrl && !hasMounted && (
              // Skeleton reserves the layout so the dialog does not jump when downloads mount.
              <div className="space-y-3" aria-hidden="true">
                <div className="h-10 bg-[var(--surface-raised)] rounded animate-pulse" />
                <div className="h-10 bg-[var(--surface-raised)] rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-[var(--surface-raised)] rounded animate-pulse" />
              </div>
            )}

            {status === 'completed' && downloadUrl && hasMounted && (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-sm text-emerald-300">
                  Your data export is ready.
                </div>
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-wh40k bg-emerald-900/20 border-emerald-500/30 hover:bg-emerald-900/30 text-emerald-300 inline-block w-full text-center"
                >
                  Download JSON
                </a>
                <p className="text-xs text-[var(--text-tertiary)]">
                  This link is private and expires in 7 days.
                </p>
              </div>
            )}
          </div>

          <RadixDialogFooter>
            {status === 'idle' && (
              <>
                <button onClick={() => setOpen(false)} className="btn-wh40k">
                  Cancel
                </button>
                <button
                  onClick={handleRequest}
                  className="btn-wh40k bg-blue-600 hover:bg-blue-700"
                >
                  Request My Data
                </button>
              </>
            )}
            {(status === 'completed' || status === 'failed') && (
              <button
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                className="btn-wh40k"
              >
                Close
              </button>
            )}
          </RadixDialogFooter>
        </RadixDialogContent>
      </RadixDialog>
    </>
  )
}

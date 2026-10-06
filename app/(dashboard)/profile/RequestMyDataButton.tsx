'use client'

import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
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
  const desktop = getRuntimeProfile() === 'desktop'
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)
  const hasMounted = useHasMounted()

  useEffect(() => {
    if (!desktop || !open) return
    let cancelled = false
    void fetch('/api/gdpr/my-data')
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Could not recover the local export request')
        const data = await response.json()
        if (cancelled || !data.requestId) return
        setRequestId(data.requestId)
        setDownloadUrl(data.downloadUrl)
        setStatus(data.status === 'pending' ? 'processing' : data.status)
        if (data.status === 'failed')
          setError('Export generation failed. You can request a new export.')
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            extractErrorMessage(
              err,
              'Could not recover the local export request'
            )
          )
      })
      .finally(() => {
        if (!cancelled) setRecovering(false)
      })
    return () => {
      cancelled = true
    }
  }, [desktop, open])

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
        onClick={() => {
          setRecovering(desktop)
          setOpen(true)
        }}
        className="btn-wh40k bg-blue-900/20 border-blue-500/30 hover:bg-blue-900/30 text-blue-300"
      >
        {desktop ? 'Export Local Profile Data' : 'Request My Data (GDPR)'}
      </button>

      <RadixDialog
        open={open}
        onOpenChange={(next) => {
          if (!desktop && (status === 'pending' || status === 'processing'))
            return
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
              {desktop
                ? 'Export your local profile, roster, achievements, preferences, and up to 1,000 linked battles as JSON (up to 8 MiB). Local identity claims remain unverified. Credentials are excluded.'
                : "Under GDPR Article 15, you can request a copy of the personal data we hold about you. We'll generate a JSON export including your profile, guild memberships, and battle history."}
            </RadixDialogDescription>
          </RadixDialogHeader>

          <div className="my-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-sm text-sm text-red-400">
                {error}
              </div>
            )}

            {status === 'idle' && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-sm text-sm text-blue-200">
                Export links are valid for 7 days and can be downloaded
                privately once generated. Most exports complete within a minute.
              </div>
            )}

            {(status === 'pending' || status === 'processing') && (
              <div className="p-6 text-center space-y-4">
                <Spinner size="lg" className="h-10 w-10 text-blue-400" />
                <p className="text-secondary-wh40k">
                  {status === 'pending'
                    ? 'Creating export request…'
                    : 'Generating your data export…'}
                </p>
                {requestId && (
                  <p className="text-xs text-(--text-tertiary)">
                    Request ID: <span className="font-mono">{requestId}</span>
                  </p>
                )}
                {desktop && (
                  <p className="text-sm text-secondary-wh40k">
                    You can close this dialog or the application. Processing
                    resumes when this workspace reopens.
                  </p>
                )}
              </div>
            )}

            {status === 'completed' && downloadUrl && !hasMounted && (
              // Skeleton reserves the layout so the dialog does not jump when downloads mount.
              <div className="space-y-3" aria-hidden="true">
                <div className="h-10 bg-(--surface-raised) rounded-sm animate-pulse" />
                <div className="h-10 bg-(--surface-raised) rounded-sm animate-pulse" />
                <div className="h-3 w-2/3 bg-(--surface-raised) rounded-sm animate-pulse" />
              </div>
            )}

            {status === 'completed' && downloadUrl && hasMounted && (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-sm text-sm text-emerald-300">
                  Your data export is ready.
                </div>
                <a
                  href={downloadUrl}
                  target={desktop ? undefined : '_blank'}
                  download={desktop ? 'local-profile-data.json' : undefined}
                  rel="noopener noreferrer"
                  className="btn-wh40k bg-emerald-900/20 border-emerald-500/30 hover:bg-emerald-900/30 text-emerald-300 inline-block w-full text-center"
                >
                  Download JSON
                </a>
                <p className="text-xs text-(--text-tertiary)">
                  {desktop
                    ? 'Download requires this workspace session and expires in 7 days.'
                    : 'This link is private and expires in 7 days.'}
                </p>
              </div>
            )}
          </div>

          <RadixDialogFooter>
            {desktop && (status === 'pending' || status === 'processing') && (
              <button onClick={() => setOpen(false)} className="btn-wh40k">
                Close
              </button>
            )}
            {status === 'idle' && (
              <>
                <button onClick={() => setOpen(false)} className="btn-wh40k">
                  Cancel
                </button>
                <button
                  onClick={handleRequest}
                  disabled={recovering}
                  className="btn-wh40k bg-blue-600 hover:bg-blue-700"
                >
                  {recovering ? 'Recovering export…' : 'Request My Data'}
                </button>
              </>
            )}
            {(status === 'completed' || status === 'failed') && (
              <>
                {desktop && (
                  <button onClick={reset} className="btn-wh40k">
                    New Export
                  </button>
                )}
                <button
                  onClick={() => {
                    setOpen(false)
                    reset()
                  }}
                  className="btn-wh40k"
                >
                  Close
                </button>
              </>
            )}
          </RadixDialogFooter>
        </RadixDialogContent>
      </RadixDialog>
    </>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { formatRelativeTime } from '@/app/lib/utils/date-format'

interface ReweaveLinkProps {
  hasKey: boolean
  lastVerified: string | null
}

export function ReweaveLink({ hasKey, lastVerified }: ReweaveLinkProps) {
  const hasMounted = useHasMounted()
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const verifiedDisplay = !lastVerified
    ? null
    : !hasMounted
      ? '—'
      : `Last verified ${formatRelativeTime(lastVerified, Date.now())}`

  async function handleSave() {
    if (!apiKey.trim()) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/player-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      })
      const data = await res.json()

      if (!res.ok) {
        setError(
          data.error?.message || data.message || 'Failed to save API key'
        )
        return
      }

      setSuccess(`Key verified and saved for ${data.playerName}`)
      setApiKey('')
      setShowForm(false)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleUnlink() {
    setUnlinking(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/player-api-key', { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok) {
        setError(
          data.error?.message || data.message || 'Failed to remove API key'
        )
        return
      }

      setSuccess('API key removed')
      setConfirmUnlink(false)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setUnlinking(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Status line */}
      <div className="flex items-center gap-3 flex-wrap">
        {hasKey ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-(--success-bg) text-(--success) border border-(--success-border)">
            Configured
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-(--warning-bg) text-(--warning) border border-(--warning-border)">
            Not Configured
          </span>
        )}
        {verifiedDisplay && (
          <span className="text-xs text-secondary-wh40k">
            {verifiedDisplay}
          </span>
        )}
      </div>

      {/* Actions */}
      {!showForm && !confirmUnlink && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowForm(true)
              setError(null)
              setSuccess(null)
            }}
            className="btn-wh40k text-sm"
          >
            {hasKey ? 'Reweave API Key' : 'Link API Key'}
          </button>
          {hasKey && (
            <button
              onClick={() => {
                setConfirmUnlink(true)
                setError(null)
                setSuccess(null)
              }}
              className="px-3 py-1.5 text-sm rounded-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Unlink
            </button>
          )}
        </div>
      )}

      {/* Key input form */}
      {showForm && (
        <div className="space-y-2">
          <p className="text-xs text-secondary-wh40k">
            Paste your Tacticus API key below. It will be validated against the
            live API before saving.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste API key..."
              className="flex-1 px-3 py-1.5 text-sm bg-(--input-bg) border border-(--card-border) rounded-sm text-primary-wh40k placeholder:text-secondary-wh40k focus:outline-hidden focus:border-accent-wh40k"
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              className="btn-wh40k text-sm disabled:opacity-50"
            >
              {saving ? 'Validating...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setApiKey('')
                setError(null)
              }}
              className="px-3 py-1.5 text-sm rounded-sm border border-(--card-border) text-secondary-wh40k hover:text-primary-wh40k transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Unlink confirmation */}
      {confirmUnlink && (
        <div className="p-3 rounded-sm border border-red-500/30 bg-red-500/5 space-y-2">
          <p className="text-sm text-red-300">
            Remove your Tacticus API key? You can re-link it later.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleUnlink}
              disabled={unlinking}
              className="px-3 py-1.5 text-sm rounded-sm bg-red-500 text-white hover:bg-red-400 disabled:opacity-50 transition-colors"
            >
              {unlinking ? 'Removing...' : 'Yes, unlink'}
            </button>
            <button
              onClick={() => setConfirmUnlink(false)}
              className="px-3 py-1.5 text-sm rounded-sm border border-(--card-border) text-secondary-wh40k hover:text-primary-wh40k transition-colors"
              disabled={unlinking}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-(--success)">{success}</p>}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Button, Input } from '@tacticus/ui-kit'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { BaseModalProps } from './types'

type InviteCodeModalProps = Omit<BaseModalProps, 'onMemberUpdate'>

export function InviteCodeModal({ member, onClose }: InviteCodeModalProps) {
  const hasMounted = useHasMounted()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/guild/invite-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: member.player_id,
          display_name: member.display_name,
          guild_code: member.guild_code,
          expires_hours: 72
        })
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMsg =
          typeof data.error === 'object' ? data.error?.message : data.error
        setError(errorMsg || 'Failed to generate invite code')
        return
      }

      setGeneratedCode(data.code)
      setExpiresAt(data.expires_at)
    } catch {
      setError('Failed to generate invite code')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!generatedCode) return

    const inviteUrl = `${window.location.origin}/onboarding/claim?code=${generatedCode}`

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = inviteUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleClose = () => {
    setGeneratedCode(null)
    setExpiresAt(null)
    setError(null)
    setCopied(false)
    onClose()
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">
        Invite Code - <MemberName value={member.display_name} />
      </h3>
      <div className="space-y-4">
        {!generatedCode ? (
          <>
            <p className="text-sm text-[var(--text-secondary)]">
              Generate an invite code that{' '}
              <MemberName value={member.display_name} /> can use to claim their
              profile. The code will be valid for 72 hours.
            </p>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                loading={loading}
                loadingText="Generating..."
              >
                Generate Code
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
              <p className="text-xs text-emerald-300 uppercase tracking-wide mb-2">
                Invite Code
              </p>
              <div className="flex items-center gap-3">
                <code className="text-2xl font-mono font-bold text-emerald-200 tracking-wider">
                  {generatedCode}
                </code>
              </div>
              {expiresAt && (
                <p className="text-xs text-emerald-300/70 mt-2">
                  Expires:{' '}
                  {hasMounted ? new Date(expiresAt).toLocaleString() : '—'}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
              <p className="text-xs text-blue-200 font-medium mb-2">
                Share this link with the player:
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/onboarding/claim?code=${generatedCode}`}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  size="sm"
                  onClick={handleCopy}
                  className="flex-shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              The player will need to create an account (or log in) and then
              enter this code to claim their profile. They will also need to
              provide their Player API key.
            </p>

            <div className="flex justify-end">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  )
}

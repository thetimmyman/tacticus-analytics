'use client'

import { useState } from 'react'
import { Button } from '@tacticus/ui-kit'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import { dbClient } from '@/app/lib/db/client'
import type { BaseModalProps } from './types'

const MIN_REASON_LENGTH = 10

export function AdminUnlinkModal({
  member,
  onClose,
  onMemberUpdate
}: BaseModalProps) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ priorUserId: string | null } | null>(
    null
  )

  const trimmedReason = reason.trim()
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH

  const handleUnlink = async () => {
    if (!reasonValid) return
    setLoading(true)
    setError(null)

    try {
      const supabase = dbClient()
      // DB types may lag this RPC until gen-types runs against a deployed copy.
      const rpcCall = (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{
          data: unknown
          error: { message?: string } | null
        }>
      )('admin_unlink_player_mapping', {
        p_player_id: member.player_id,
        p_guild_code: member.guild_code,
        p_reason: trimmedReason
      })
      const { data, error: rpcError } = await rpcCall

      if (rpcError) {
        setError(rpcError.message || 'RPC call failed')
        return
      }

      const result = data as {
        success?: boolean
        error?: string
        prior_user_id?: string | null
      } | null

      if (!result?.success) {
        setError(result?.error || 'Unlink failed')
        return
      }

      onMemberUpdate({
        player_id: member.player_id,
        user_id: null
      })
      setSuccess({ priorUserId: result.prior_user_id ?? null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlink failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k">
        Unlink Player — <MemberName value={member.display_name} />
      </h3>

      {success ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-sm text-emerald-200">
              Unlinked successfully. <MemberName value={member.display_name} />{' '}
              can now re-claim only with a fresh single-use invite code at{' '}
              <code className="font-mono">/onboarding/claim</code>.
            </p>
            {success.priorUserId && (
              <p className="text-xs text-emerald-300/70 mt-2 font-mono">
                Prior user_id: {success.priorUserId}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-medium mb-1">Admin action: this will:</p>
            <ul className="list-disc list-inside text-xs space-y-1 text-amber-200/90">
              <li>
                Revoke the ownership attestation and clear player/Discord
                authority
              </li>
              <li>Clear the stored Tacticus API key (forces re-validation)</li>
              <li>Write an audit row capturing your reason</li>
              <li>
                Require a fresh exact single-use invite before anyone can bind
                the slot again
              </li>
            </ul>
          </div>

          <div>
            <label
              htmlFor="unlink-reason"
              className="block text-xs font-medium text-secondary-wh40k uppercase tracking-wide mb-1"
            >
              Reason (required, min {MIN_REASON_LENGTH} chars — written to audit
              log)
            </label>
            <textarea
              id="unlink-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-(--border) bg-(--bg-secondary) px-3 py-2 text-sm text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent)"
              placeholder="e.g. Player reported leaked API key — clearing stale link so they can re-claim with fresh credentials."
              disabled={loading}
            />
            <p className="mt-1 text-xs text-(--text-tertiary)">
              {trimmedReason.length}/{MIN_REASON_LENGTH}+ chars
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleUnlink}
              disabled={!reasonValid || loading}
              loading={loading}
              loadingText="Unlinking..."
              className="bg-red-600 hover:bg-red-700"
            >
              Unlink
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

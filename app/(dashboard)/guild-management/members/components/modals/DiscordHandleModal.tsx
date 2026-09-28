'use client'

import { useState, useEffect } from 'react'
import { Input } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import type { AdminActionResult } from '@tacticus/app-core/types'
import { useToast } from '@/app/hooks/useToast'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { ModalWithSupabaseProps } from './types'
import { createComponentLogger } from '@/app/lib/logging/client'

const logger = createComponentLogger('guild-management.discord-handle')

export function DiscordHandleModal({
  member,
  onClose,
  onMemberUpdate,
  supabase
}: ModalWithSupabaseProps) {
  const [discordHandle, setDiscordHandle] = useState('')
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setDiscordHandle(member.discord_username ?? '')
  }, [member])

  const handleSave = async () => {
    setSaving(true)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_player_discord_admin',
        {
          p_player_id: member.player_id,
          p_discord_username: discordHandle.trim() || ''
        }
      )

      if (rpcError) throw new Error('Failed to update discord username via RPC')

      const result = rpcResult as AdminActionResult | null
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update discord username')
      }

      onMemberUpdate({
        player_id: member.player_id,
        discord_username: discordHandle.trim() || null
      })
      toast.success('Discord handle saved')
      onClose()
    } catch {
      logger.error('Failed to update Discord username')
      toast.error('Failed to update discord username')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k">
        Set Discord Handle - <MemberName value={member.display_name} />
      </h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary-wh40k mb-2">
            Discord Username
          </label>
          <Input
            value={discordHandle}
            onChange={(e) => setDiscordHandle(e.target.value)}
            placeholder="e.g. username or username#1234"
          />
          <p className="mt-2 text-xs text-(--text-tertiary)">
            Enter the player&apos;s Discord username. This helps with
            coordination and communication.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Discord Handle'}
        </Button>
      </div>
    </ModalShell>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@tacticus/ui-kit'
import type { AdminActionResult } from '@tacticus/app-core/types'
import { useToast } from '@/app/hooks/useToast'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { ModalWithSupabaseProps } from './types'

export function NotesModal({
  member,
  onClose,
  onMemberUpdate,
  supabase
}: ModalWithSupabaseProps) {
  const [notesForm, setNotesForm] = useState({ officer: '', player: '' })
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setNotesForm({
      officer: member.officer_notes ?? '',
      player: member.player_notes ?? ''
    })
  }, [member])

  const handleSave = async () => {
    setSaving(true)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_player_notes_admin',
        {
          p_player_id: member.player_id,
          p_officer_notes: notesForm.officer || undefined,
          p_player_notes: notesForm.player || undefined
        }
      )

      if (rpcError) throw new Error('Failed to update notes via RPC')

      const result = rpcResult as AdminActionResult | null
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update notes')
      }

      onMemberUpdate({
        player_id: member.player_id,
        officer_notes: notesForm.officer || null,
        player_notes: notesForm.player || null
      })
      toast.success('Notes saved')
      onClose()
    } catch (error) {
      console.error('Failed to update member notes:', error)
      toast.error('Failed to update member notes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k">
        Edit Notes - <MemberName value={member.display_name} />
      </h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary-wh40k mb-2">
            Officer Notes (private to leadership)
          </label>
          <textarea
            value={notesForm.officer}
            onChange={(e) =>
              setNotesForm({ ...notesForm, officer: e.target.value })
            }
            className="input-wh40k w-full"
            rows={3}
            placeholder="Add leadership notes..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary-wh40k mb-2">
            Player Notes (visible to the member)
          </label>
          <textarea
            value={notesForm.player}
            onChange={(e) =>
              setNotesForm({ ...notesForm, player: e.target.value })
            }
            className="input-wh40k w-full"
            rows={3}
            placeholder="Optional message or reminder for the player..."
          />
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Notes'}
        </Button>
      </div>
    </ModalShell>
  )
}

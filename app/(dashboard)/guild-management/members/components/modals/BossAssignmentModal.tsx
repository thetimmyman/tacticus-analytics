'use client'

import { useState, useEffect } from 'react'
import { Button } from '@tacticus/ui-kit'
import type { AdminActionResult } from '@tacticus/app-core/types'
import { useToast } from '@/app/hooks/useToast'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { BossAssignmentModalProps } from './types'

export function BossAssignmentModal({
  member,
  onClose,
  onMemberUpdate,
  supabase,
  availableBosses
}: BossAssignmentModalProps) {
  const [primaryBoss, setPrimaryBoss] = useState('')
  const [secondaryBoss, setSecondaryBoss] = useState('')
  const [assignmentNotes, setAssignmentNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setPrimaryBoss(member.primary_boss ?? '')
    setSecondaryBoss(member.secondary_boss ?? '')
    setAssignmentNotes(member.assignment_notes ?? '')
  }, [member])

  const handleSave = async () => {
    setSaving(true)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_player_boss_assignments_admin',
        {
          p_player_id: member.player_id,
          p_primary_boss: primaryBoss || undefined,
          p_secondary_boss: secondaryBoss || undefined,
          p_assignment_notes: assignmentNotes || undefined
        }
      )

      if (rpcError) throw new Error('Failed to update boss assignments via RPC')

      const result = rpcResult as AdminActionResult | null
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update boss assignments')
      }

      onMemberUpdate({
        player_id: member.player_id,
        primary_boss: primaryBoss || null,
        secondary_boss: secondaryBoss || null,
        assignment_notes: assignmentNotes || null
      })
      toast.success('Boss assignment saved')
      onClose()
    } catch (error) {
      console.error('Failed to save token assignment:', error)
      toast.error('Failed to save token assignment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Boss Assignments - <MemberName value={member.display_name} />
      </h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Primary Boss Assignment (2 tokens)
          </label>
          <select
            value={primaryBoss}
            onChange={(e) => setPrimaryBoss(e.target.value)}
            className="input-wh40k w-full"
          >
            <option value="">Select Primary Boss</option>
            {availableBosses.map((boss) => (
              <option key={boss.boss_type} value={boss.boss_type}>
                {boss.display_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Secondary Boss Assignment (1 token)
          </label>
          <select
            value={secondaryBoss}
            onChange={(e) => setSecondaryBoss(e.target.value)}
            className="input-wh40k w-full"
          >
            <option value="">Select Secondary Boss</option>
            {availableBosses
              .filter((boss) => boss.boss_type !== primaryBoss)
              .map((boss) => (
                <option key={boss.boss_type} value={boss.boss_type}>
                  {boss.display_name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Assignment Notes
          </label>
          <textarea
            value={assignmentNotes}
            onChange={(e) => setAssignmentNotes(e.target.value)}
            className="input-wh40k w-full"
            rows={3}
            placeholder="Add notes about this assignment..."
          />
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Assignment'}
        </Button>
      </div>
    </ModalShell>
  )
}

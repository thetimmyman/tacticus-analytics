'use client'

import { useState, useEffect } from 'react'
import { Button } from '@tacticus/ui-kit'
import type { AdminActionResult } from '@tacticus/app-core/types'
import { useToast } from '@/app/hooks/useToast'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { MetaTeamsModalProps } from './types'

export function MetaTeamsModal({
  member,
  onClose,
  onMemberUpdate,
  supabase,
  metaTeams,
  metaTeamsLoading
}: MetaTeamsModalProps) {
  const [draft, setDraft] = useState({
    primary: '',
    secondary: '',
    tertiary: ''
  })
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setDraft({
      primary: member.primary_team ?? '',
      secondary: member.secondary_team ?? '',
      tertiary: member.tertiary_team ?? ''
    })
  }, [member])

  const handleSave = async () => {
    setSaving(true)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_player_meta_teams_admin',
        {
          p_player_id: member.player_id,
          p_primary_team: draft.primary || undefined,
          p_secondary_team: draft.secondary || undefined,
          p_tertiary_team: draft.tertiary || undefined
        }
      )

      if (rpcError)
        throw new Error('Failed to update meta team preferences via RPC')

      const result = rpcResult as AdminActionResult | null
      if (!result?.success) {
        throw new Error(
          result?.error || 'Failed to update meta team preferences'
        )
      }

      onMemberUpdate({
        player_id: member.player_id,
        primary_team: draft.primary || null,
        secondary_team: draft.secondary || null,
        tertiary_team: draft.tertiary || null
      })
      toast.success('Meta team preferences saved')
      onClose()
    } catch (error) {
      console.error('Failed to update meta team preferences:', error)
      toast.error('Failed to update meta team preferences')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k mb-4">
        Meta Team Preferences - <MemberName value={member.display_name} />
      </h3>
      {metaTeamsLoading ? (
        <p className="text-sm text-secondary-wh40k">Loading meta teams...</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary-wh40k mb-2">
              Primary Team
            </label>
            <select
              value={draft.primary}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, primary: e.target.value }))
              }
              className="input-wh40k w-full"
            >
              <option value="">No preference</option>
              {metaTeams.map((team) => (
                <option key={team.team_name} value={team.team_name}>
                  {team.display_name || team.team_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-wh40k mb-2">
              Secondary Team
            </label>
            <select
              value={draft.secondary}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, secondary: e.target.value }))
              }
              className="input-wh40k w-full"
            >
              <option value="">No preference</option>
              {metaTeams.map((team) => (
                <option key={team.team_name} value={team.team_name}>
                  {team.display_name || team.team_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-wh40k mb-2">
              Tertiary Team
            </label>
            <select
              value={draft.tertiary}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, tertiary: e.target.value }))
              }
              className="input-wh40k w-full"
            >
              <option value="">No preference</option>
              {metaTeams.map((team) => (
                <option key={team.team_name} value={team.team_name}>
                  {team.display_name || team.team_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-3 mt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || metaTeamsLoading}>
          {saving ? 'Saving...' : 'Save Meta Teams'}
        </Button>
      </div>
    </ModalShell>
  )
}

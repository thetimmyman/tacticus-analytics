'use client'

import { useState, useEffect } from 'react'
import { Button } from '@tacticus/ui-kit'
import type { AdminActionResult } from '@tacticus/app-core/types'
import { useToast } from '@/app/hooks/useToast'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { BossPreferencesModalProps } from './types'

const BOSS_PREFERENCE_OPTIONS: Array<{
  value: 'preferred' | 'neutral' | 'avoid'
  label: string
}> = [
  { value: 'preferred', label: 'Preferred' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'avoid', label: 'Avoid' }
]

export function BossPreferencesModal({
  member,
  onClose,
  onMemberUpdate,
  supabase,
  bossDisplayNames
}: BossPreferencesModalProps) {
  const [draft, setDraft] = useState<Record<string, 'preferred' | 'avoid'>>({})
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const cleaned = member.boss_preferences
      ? Object.fromEntries(
          Object.entries(member.boss_preferences).filter(
            ([, value]) => value !== 'neutral'
          )
        )
      : {}
    setDraft(cleaned as Record<string, 'preferred' | 'avoid'>)
  }, [member])

  const handlePreferenceChange = (
    bossKey: string,
    preference: 'preferred' | 'neutral' | 'avoid'
  ) => {
    setDraft((prev) => {
      const next = { ...prev }
      if (preference === 'neutral') {
        delete next[bossKey]
      } else {
        next[bossKey] = preference
      }
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_player_boss_preferences_admin',
        {
          p_player_id: member.player_id,
          p_boss_preferences: draft
        }
      )

      if (rpcError) throw new Error('Failed to update boss preferences via RPC')

      const result = rpcResult as AdminActionResult | null
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update boss preferences')
      }

      onMemberUpdate({
        player_id: member.player_id,
        boss_preferences: Object.keys(draft).length ? draft : null
      })
      toast.success('Boss preferences saved')
      onClose()
    } catch (error) {
      console.error('Failed to update boss preferences:', error)
      toast.error('Failed to update boss preferences')
    } finally {
      setSaving(false)
    }
  }

  const bossEntries = Object.entries(bossDisplayNames)

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k mb-4">
        Boss Preferences - <MemberName value={member.display_name} />
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {bossEntries.map(([key, label]) => (
          <div
            key={key}
            className="rounded-lg border border-card-border/60 p-3"
          >
            <div className="text-sm font-medium text-primary-wh40k mb-2">
              {label}
            </div>
            <div className="flex gap-2">
              {BOSS_PREFERENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handlePreferenceChange(key, option.value)}
                  className={`flex-1 rounded border px-2 py-1 text-xs ${
                    draft[key] === option.value ||
                    (!draft[key] && option.value === 'neutral')
                      ? 'border-accent-wh40k text-(--accent) bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                      : 'border-(--card-border) text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3 mt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </ModalShell>
  )
}

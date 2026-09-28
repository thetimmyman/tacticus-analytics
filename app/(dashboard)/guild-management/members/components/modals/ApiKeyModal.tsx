'use client'

import { useState } from 'react'
import { Button } from '@tacticus/ui-kit'
import { ValidatedApiKeyInput } from '@/app/components/validation/ValidatedApiKeyInput'
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import { useToast } from '@/app/hooks/useToast'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { BaseModalProps } from './types'

const TACTICUS_SITE = `${TACTICUS_API.ORIGIN}/`

type ApiKeyModalProps = Omit<BaseModalProps, 'onMemberUpdate'>

export function ApiKeyModal({ member, onClose }: ApiKeyModalProps) {
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeyValidated, setApiKeyValidated] = useState(false)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const handleSave = async () => {
    if (!apiKeyValue.trim() || !apiKeyValidated) return
    setSaving(true)

    try {
      const response = await fetch('/api/admin/player-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: member.player_id,
          apiKey: apiKeyValue.trim()
        })
      })

      const payload = await response.json()
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to save API key')
      }

      toast.success('API key saved successfully')
      onClose()
    } catch (error) {
      console.error('Failed to save player API key:', error)
      toast.error(
        'Failed to save API key',
        error instanceof Error ? error.message : undefined
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k">
        Add Player API Key - <MemberName value={member.display_name} />
      </h3>
      <p className="text-sm text-secondary-wh40k">
        Important: You must collect this player&apos;s API key directly from
        them. Do not enter your own key.
      </p>
      <ValidatedApiKeyInput
        label="Player API Key"
        value={apiKeyValue}
        onChange={(value) => {
          setApiKeyValue(value)
          setApiKeyValidated(false)
        }}
        onValidationChange={(isValid) => setApiKeyValidated(isValid)}
        showInstructions={false}
        validationScope="player"
        placeholder="Paste the player API key"
      />
      <div className="text-xs text-(--text-tertiary) bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] p-3 rounded-sm space-y-2">
        <p>
          Important: Ask the player to go to{' '}
          <a
            href={TACTICUS_SITE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-(--accent) underline"
          >
            {TACTICUS_SITE}
          </a>
          , click &quot;Create New API Key&quot; with read access to: Player,
          and send you the key. Do not enter your own API key.
        </p>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!apiKeyValidated || saving}>
          {saving ? 'Saving...' : 'Save API Key'}
        </Button>
      </div>
    </ModalShell>
  )
}

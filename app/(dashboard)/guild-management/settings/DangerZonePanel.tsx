'use client'

import { useState } from 'react'
import { SettingsSection } from './SettingsSection'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { AlertTriangle, Skull, Slash } from 'lucide-react'
import { cn } from '@/app/lib/utils/cn'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'

interface DangerZonePanelProps {
  guildCode: string
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  saving: boolean
  deleting: boolean
  canModifyStatus: boolean
  canDeleteGuild: boolean
  onDeleteGuild: () => Promise<void> | void
}

export function DangerZonePanel({
  guildCode,
  enabled,
  onEnabledChange,
  saving,
  deleting,
  canModifyStatus,
  canDeleteGuild,
  onDeleteGuild
}: DangerZonePanelProps) {
  const [confirmationText, setConfirmationText] = useState('')
  const guildDisplayLabel = useGuildDisplayLabel(guildCode)

  const handleDeleteClick = () => {
    if (
      !canDeleteGuild ||
      confirmationText.trim().toUpperCase() !== guildDisplayLabel.toUpperCase()
    ) {
      return
    }
    onDeleteGuild()
  }

  return (
    <SettingsSection
      id="danger-zone"
      title="Danger Zone"
      description="Irreversible operations that wipe data from the platform. Proceed only if you understand the consequences."
      icon={Skull}
      tone="danger"
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-red-600/40 bg-red-950/40 p-5 shadow-inner shadow-red-900/30">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/60 bg-red-900/50 text-red-200">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-100">
                Disable guild analytics
              </h3>
              <p className="text-sm text-red-200/80">
                Turning this off hides the guild from dashboards, leaderboards,
                and automation pipelines immediately.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={onEnabledChange}
              disabled={saving || !canModifyStatus}
            />
          </div>
          {!canModifyStatus && (
            <p className="mt-3 text-xs text-red-300">
              Only leaders or officers can toggle guild visibility.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-red-700/50 bg-red-950/60 p-6 shadow-inner shadow-red-900/30">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-600/60 bg-red-900/60 text-red-200">
              <Slash className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-100">
                Delete guild records
              </h3>
              <p className="text-sm text-red-200/80">
                This permanently removes all raid logs, player mappings, webhook
                history, and configuration for{' '}
                <span className="font-semibold text-red-100">
                  {guildDisplayLabel}
                </span>
                . This action cannot be undone.
              </p>
              <div className="mt-5 space-y-3">
                <Label
                  htmlFor="danger-confirm"
                  className="text-xs font-semibold uppercase tracking-wide text-red-200/80"
                >
                  Type the guild name to confirm
                </Label>
                <Input
                  id="danger-confirm"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  placeholder={guildDisplayLabel}
                  className="rounded-xl border-red-500/40 bg-red-900/40 text-red-100 placeholder:text-red-300/50 focus:border-red-400 focus:ring-red-400"
                  disabled={deleting || !canDeleteGuild}
                />
                <p className="text-xs text-red-200/70">
                  All data is purged immediately. Webhooks stop posting,
                  dashboards lose historical context, and members will no longer
                  see this guild in any listings.
                </p>
                <Button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={
                    deleting ||
                    !canDeleteGuild ||
                    confirmationText.trim().toUpperCase() !==
                      guildDisplayLabel.toUpperCase()
                  }
                  loading={deleting}
                  loadingText="Deleting..."
                  className={cn(
                    'w-full justify-center border border-red-500/60 bg-red-700/80 text-red-50 hover:bg-red-600',
                    'rounded-xl font-semibold shadow-lg shadow-red-900/40'
                  )}
                >
                  Delete guild &amp; all data
                </Button>
                {!canDeleteGuild && (
                  <p className="text-xs font-medium text-red-300">
                    Only app admins can authorize data deletion.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}

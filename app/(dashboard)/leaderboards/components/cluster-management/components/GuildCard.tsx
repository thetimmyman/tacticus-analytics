'use client'

import React from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Spinner } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { Save, X, CheckCircle, MessageSquare } from 'lucide-react'
import InlineWebhookManager from '../../InlineWebhookManager'
import type { Guild } from '../types'
import { formatGuildTag } from '@/app/lib/format/guild'
import { GuildActionsMenu } from './GuildActionsMenu'

interface GuildCardProps {
  guild: Guild
  isEditing: boolean
  editedGuild: Guild | null
  validatingKey: string | null
  expandedWebhooks: string | null
  clusterId: string | null
  onEdit: (guild: Guild) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: (guildCode: string) => void
  onValidateKey: (guildCode: string) => void
  onToggleWebhooks: (guildCode: string | null) => void
  onEditedGuildChange: (guild: Guild) => void
  getApiKeyStatus: (guild: Guild) => { text: string; color: string }
}

export function GuildCard({
  guild,
  isEditing,
  editedGuild,
  validatingKey,
  expandedWebhooks,
  clusterId,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onValidateKey,
  onToggleWebhooks,
  onEditedGuildChange,
  getApiKeyStatus
}: GuildCardProps) {
  const hasMounted = useHasMounted()
  if (isEditing && editedGuild) {
    return (
      <div className="card-wh40k p-4 space-y-3">
        <div className="space-y-3">
          <div className="flex justify-between items-start">
            <span className="font-bold text-accent-wh40k text-lg">
              {formatGuildTag(guild)}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={onSaveEdit}
                className="text-green-500 hover:text-green-400"
              >
                <Save className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelEdit}
                className="text-[var(--accent)] hover:text-[var(--accent)]"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <Label className="text-xs">Display Name (Read-only)</Label>
              <Input
                value={editedGuild?.display_name || ''}
                disabled
                className="mt-1 opacity-60 cursor-not-allowed"
                title="Guild name is managed by the game API"
              />
            </div>

            <div>
              <Label className="text-xs">API Key</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="text"
                  value={editedGuild?.api_key || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onEditedGuildChange({
                      ...editedGuild,
                      api_key: e.target.value
                    })
                  }
                  placeholder="Enter API key"
                  className="flex-1 font-mono"
                  autoComplete="off"
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onValidateKey(editedGuild.guild_code)}
                  disabled={validatingKey === editedGuild?.guild_code}
                  className="text-[var(--accent)] hover:text-blue-300"
                  title="Validate API key"
                >
                  {validatingKey === editedGuild?.guild_code ? (
                    <Spinner size="sm" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs">API Key Owner</Label>
              <Input
                value={editedGuild?.API_Owner || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onEditedGuildChange({
                    ...editedGuild,
                    API_Owner: e.target.value
                  })
                }
                placeholder="Owner name"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">GR Rank (Read-only)</Label>
                <Input
                  type="number"
                  value={editedGuild?.GR_Ranking || ''}
                  disabled
                  className="mt-1 opacity-60 cursor-not-allowed"
                  title="Rankings are managed by the game API"
                />
              </div>
              <div>
                <Label className="text-xs">GW Rank (Read-only)</Label>
                <Input
                  type="number"
                  value={editedGuild?.GW_Ranking || ''}
                  disabled
                  className="mt-1 opacity-60 cursor-not-allowed"
                  title="Rankings are managed by the game API"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={editedGuild?.enabled ?? false}
                onCheckedChange={(checked: boolean) =>
                  onEditedGuildChange({ ...editedGuild, enabled: checked })
                }
              />
              <Label>Guild Enabled</Label>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const status = getApiKeyStatus(guild)
  const lastValidatedLabel =
    hasMounted && guild.api_key_last_validated
      ? new Date(guild.api_key_last_validated).toLocaleDateString()
      : '—'

  return (
    <div className="card-wh40k p-4 space-y-3">
      <div className="space-y-3">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <span className="font-bold text-accent-wh40k text-lg">
              {formatGuildTag(guild)}
            </span>
            <div className="text-primary-wh40k truncate">
              {guild.display_name || '-'}
            </div>
          </div>
          <GuildActionsMenu
            mobile
            isWebhooksExpanded={expandedWebhooks === guild.guild_code}
            onEdit={() => onEdit(guild)}
            onToggleWebhooks={() =>
              onToggleWebhooks(
                expandedWebhooks === guild.guild_code ? null : guild.guild_code
              )
            }
            onDelete={() => onDelete(guild.guild_code)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-secondary-wh40k">Status</div>
            <span
              className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                guild.enabled
                  ? 'bg-green-900/50 text-green-400'
                  : 'bg-red-900/50 text-red-400'
              }`}
            >
              {guild.enabled ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div>
            <div className="text-xs text-secondary-wh40k">Discord</div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onToggleWebhooks(
                  expandedWebhooks === guild.guild_code
                    ? null
                    : guild.guild_code
                )
              }
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] min-h-[36px] w-full justify-start"
            >
              <MessageSquare className="w-3 h-3 mr-1 flex-shrink-0" />
              Webhooks
            </Button>
          </div>

          <div>
            <div className="text-xs text-secondary-wh40k">GR Rank</div>
            <span className="text-primary-wh40k">
              {guild.GR_Ranking || '-'}
            </span>
          </div>

          <div>
            <div className="text-xs text-secondary-wh40k">GW Rank</div>
            <span className="text-primary-wh40k">
              {guild.GW_Ranking || '-'}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--card-border)] space-y-2">
          <div>
            <div className="text-xs text-secondary-wh40k mb-1">
              API Key Status
            </div>
            <div>
              <span className={`text-sm font-medium ${status.color}`}>
                {status.text}
              </span>
              {guild.api_key_last_validated && (
                <div className="text-xs text-[var(--text-secondary)] mt-1">
                  Checked: {lastValidatedLabel}
                </div>
              )}
            </div>
          </div>
          {guild.api_owner_display && (
            <div>
              <div className="text-xs text-secondary-wh40k mb-1">
                API Key Owner
              </div>
              <span className="text-primary-wh40k text-sm">
                {guild.api_owner_display}
              </span>
            </div>
          )}
        </div>

        {expandedWebhooks === guild.guild_code && clusterId && (
          <div className="mt-3 pt-3 border-t border-[var(--card-border)]">
            <InlineWebhookManager
              guildCode={guild.guild_code}
              guildName={guild.display_name || guild.guild_code}
              clusterId={clusterId}
              onClose={() => onToggleWebhooks(null)}
              compact={true}
            />
          </div>
        )}
      </div>
    </div>
  )
}

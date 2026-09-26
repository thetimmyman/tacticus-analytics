'use client'

import React from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Spinner } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { Save, X, CheckCircle, MessageSquare } from 'lucide-react'
import type { Guild } from '../types'
import { formatGuildTag } from '@/app/lib/format/guild'
import { GuildActionsMenu } from './GuildActionsMenu'

interface GuildTableRowProps {
  guild: Guild
  isEditing: boolean
  editedGuild: Guild | null
  validatingKey: string | null
  expandedWebhooks: string | null
  onEdit: (guild: Guild) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: (guildCode: string) => void
  onValidateKey: (guildCode: string) => void
  onToggleWebhooks: (guildCode: string) => void
  onEditedGuildChange: (guild: Guild) => void
  getApiKeyStatus: (guild: Guild) => { text: string; color: string }
}

export function GuildTableRow({
  guild,
  isEditing,
  editedGuild,
  validatingKey,
  expandedWebhooks,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onValidateKey,
  onToggleWebhooks,
  onEditedGuildChange,
  getApiKeyStatus
}: GuildTableRowProps) {
  const hasMounted = useHasMounted()
  if (isEditing && editedGuild) {
    return (
      <tr className="border-t border-[var(--card-border)] hover:bg-card/30 hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors duration-150">
        <td className="px-4 py-3">
          <span className="font-bold text-accent-wh40k">
            {formatGuildTag(guild)}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="px-3 py-1 text-sm text-[var(--text-primary)] bg-card/50 hover:bg-card/80 transition-colors duration-200 rounded border border-[var(--card-border)] opacity-60">
            {editedGuild?.display_name || '-'}
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center gap-1">
            <Input
              type="text"
              value={editedGuild?.api_key || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onEditedGuildChange({ ...editedGuild, api_key: e.target.value })
              }
              placeholder="Enter API key"
              className="font-mono max-w-[100px]"
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
        </td>
        <td className="px-4 py-3">
          <Input
            value={editedGuild?.API_Owner || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onEditedGuildChange({ ...editedGuild, API_Owner: e.target.value })
            }
            placeholder="Owner name"
            className="max-w-[120px]"
          />
        </td>
        <td className="px-4 py-3 text-center">
          <Switch
            checked={editedGuild?.enabled ?? false}
            onCheckedChange={(checked: boolean) =>
              onEditedGuildChange({ ...editedGuild, enabled: checked })
            }
          />
        </td>
        <td className="px-4 py-3">
          <div className="text-center px-2 py-1 text-sm text-[var(--text-primary)] bg-card/50 hover:bg-card/80 transition-colors duration-200 rounded border border-[var(--card-border)] opacity-60 max-w-[60px] mx-auto">
            {editedGuild?.GR_Ranking || '-'}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="text-center px-2 py-1 text-sm text-[var(--text-primary)] bg-card/50 hover:bg-card/80 transition-colors duration-200 rounded border border-[var(--card-border)] opacity-60 max-w-[60px] mx-auto">
            {editedGuild?.GW_Ranking || '-'}
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-[var(--text-secondary)]">
            Managed via Webhooks
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-center gap-1">
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
        </td>
      </tr>
    )
  }

  const status = getApiKeyStatus(guild)
  const lastValidatedLabel =
    hasMounted && guild.api_key_last_validated
      ? new Date(guild.api_key_last_validated).toLocaleDateString()
      : '—'

  return (
    <tr className="border-t border-[var(--card-border)] hover:bg-card/30 hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors duration-150">
      <td className="px-4 py-3">
        <span className="font-bold text-accent-wh40k">
          {formatGuildTag(guild)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-primary-wh40k">{guild.display_name || '-'}</span>
      </td>
      <td className="px-4 py-3 text-center">
        <div>
          <div className="flex items-center justify-center gap-2">
            <span className={`text-sm font-medium ${status.color}`}>
              {status.text}
            </span>
            {guild.has_api_key && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onValidateKey(guild.guild_code)}
                disabled={validatingKey === guild.guild_code}
                className={`p-1 transition-colors ${
                  guild.api_key_is_valid === true
                    ? 'text-green-500 hover:text-green-400'
                    : guild.api_key_is_valid === false
                      ? 'text-red-500 hover:text-red-400'
                      : 'text-gray-400 hover:text-[var(--accent)]'
                }`}
                title={
                  guild.api_key_is_valid === true
                    ? 'API key is valid - Click to re-validate'
                    : guild.api_key_is_valid === false
                      ? 'API key is invalid - Click to retry validation'
                      : 'Click to validate API key'
                }
              >
                {validatingKey === guild.guild_code ? (
                  <Spinner size="sm" className="h-3 w-3 text-current" />
                ) : (
                  <CheckCircle className="w-3 h-3" />
                )}
              </Button>
            )}
          </div>
          {guild.api_key_last_validated && (
            <div className="text-xs text-[var(--text-secondary)] mt-1">
              Last checked: {lastValidatedLabel}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-primary-wh40k text-sm">
          {guild.api_owner_display || '-'}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            guild.enabled
              ? 'bg-green-900/50 text-green-400'
              : 'bg-red-900/50 text-red-400'
          }`}
        >
          {guild.enabled ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-primary-wh40k">{guild.GR_Ranking || '-'}</span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-primary-wh40k">{guild.GW_Ranking || '-'}</span>
      </td>
      <td className="px-4 py-3 text-center">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onToggleWebhooks(guild.guild_code)}
        >
          <MessageSquare className="w-4 h-4" />
        </Button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-center">
          <GuildActionsMenu
            isWebhooksExpanded={expandedWebhooks === guild.guild_code}
            onEdit={() => onEdit(guild)}
            onToggleWebhooks={() => onToggleWebhooks(guild.guild_code)}
            onDelete={() => onDelete(guild.guild_code)}
          />
        </div>
      </td>
    </tr>
  )
}

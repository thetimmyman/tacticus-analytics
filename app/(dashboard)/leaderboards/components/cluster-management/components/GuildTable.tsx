'use client'

import React from 'react'
import InlineWebhookManager from '../../InlineWebhookManager'
import { GuildTableRow } from './GuildTableRow'
import type { Guild } from '../types'

interface GuildTableProps {
  guilds: Guild[]
  editingGuild: string | null
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

export function GuildTable({
  guilds,
  editingGuild,
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
}: GuildTableProps) {
  return (
    <div className="hidden lg:block card-wh40k overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-card/50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-bold text-primary-wh40k">
                Guild
              </th>
              <th className="text-left px-4 py-3 text-xs font-bold text-primary-wh40k">
                Display Name
              </th>
              <th className="text-center px-4 py-3 text-xs font-bold text-primary-wh40k">
                API Key Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-bold text-primary-wh40k">
                API Key Owner
              </th>
              <th className="text-center px-4 py-3 text-xs font-bold text-primary-wh40k">
                Status
              </th>
              <th className="text-center px-4 py-3 text-xs font-bold text-primary-wh40k">
                GR Rank
              </th>
              <th className="text-center px-4 py-3 text-xs font-bold text-primary-wh40k">
                GW Rank
              </th>
              <th className="text-center px-4 py-3 text-xs font-bold text-primary-wh40k">
                Discord
              </th>
              <th className="text-center px-4 py-3 text-xs font-bold text-primary-wh40k">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {guilds.map((guild) => (
              <React.Fragment key={guild.guild_code}>
                <GuildTableRow
                  guild={guild}
                  isEditing={editingGuild === guild.guild_code}
                  editedGuild={editedGuild}
                  validatingKey={validatingKey}
                  expandedWebhooks={expandedWebhooks}
                  onEdit={onEdit}
                  onCancelEdit={onCancelEdit}
                  onSaveEdit={onSaveEdit}
                  onDelete={onDelete}
                  onValidateKey={onValidateKey}
                  onToggleWebhooks={(guildCode) =>
                    onToggleWebhooks(
                      expandedWebhooks === guildCode ? null : guildCode
                    )
                  }
                  onEditedGuildChange={onEditedGuildChange}
                  getApiKeyStatus={getApiKeyStatus}
                />
                {expandedWebhooks === guild.guild_code && clusterId && (
                  <tr>
                    <td colSpan={9} className="px-4 py-3 bg-(--card-hover)">
                      <InlineWebhookManager
                        guildCode={guild.guild_code}
                        guildName={guild.display_name || guild.guild_code}
                        clusterId={clusterId}
                        onClose={() => onToggleWebhooks(null)}
                        compact={false}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

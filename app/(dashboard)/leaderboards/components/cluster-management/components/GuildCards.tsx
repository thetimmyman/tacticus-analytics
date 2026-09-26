'use client'

import { GuildCard } from './GuildCard'
import type { Guild } from '../types'

interface GuildCardsProps {
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

export function GuildCards({
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
}: GuildCardsProps) {
  return (
    <div className="lg:hidden space-y-4">
      {guilds.map((guild) => (
        <GuildCard
          key={guild.guild_code}
          guild={guild}
          isEditing={editingGuild === guild.guild_code}
          editedGuild={editedGuild}
          validatingKey={validatingKey}
          expandedWebhooks={expandedWebhooks}
          clusterId={clusterId}
          onEdit={onEdit}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onDelete={onDelete}
          onValidateKey={onValidateKey}
          onToggleWebhooks={onToggleWebhooks}
          onEditedGuildChange={onEditedGuildChange}
          getApiKeyStatus={getApiKeyStatus}
        />
      ))}
    </div>
  )
}

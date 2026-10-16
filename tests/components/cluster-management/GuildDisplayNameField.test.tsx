import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GuildTableRow } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/GuildTableRow'
import { GuildCard } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/GuildCard'
import type { Guild } from '@/app/(dashboard)/leaderboards/components/cluster-management/types'
import { GUILD_DISPLAY_NAME_MAX_LENGTH } from '@/app/lib/validation/guild-display-name'

// Fixtures are synthetic; never use real guild codes or names.

const guild: Guild = {
  guild_code: 'GUILD1',
  guild_tag: 'GUILD1',
  display_name: 'Old Name',
  has_api_key: false,
  API_Owner: null,
  enabled: true,
  GR_Ranking: null,
  GW_Ranking: null,
  token_offender_threshold: null,
  token_abuser_threshold: null,
  cluster_code: 'CLU'
}

const commonProps = {
  guild,
  isEditing: true,
  editedGuild: guild,
  validatingKey: null,
  expandedWebhooks: null,
  onEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onSaveEdit: vi.fn(),
  onDelete: vi.fn(),
  onValidateKey: vi.fn(),
  onToggleWebhooks: vi.fn(),
  getApiKeyStatus: () => ({ text: 'Not set', color: '' })
}

describe('guild display name field in edit mode', () => {
  it('GuildTableRow lets the display name be edited', () => {
    const onEditedGuildChange = vi.fn()
    render(
      <table>
        <tbody>
          <GuildTableRow
            {...commonProps}
            onEditedGuildChange={onEditedGuildChange}
          />
        </tbody>
      </table>
    )
    const input = screen.getByLabelText('Guild display name')
    expect(input).toHaveValue('Old Name')
    expect(input).toHaveAttribute(
      'maxLength',
      String(GUILD_DISPLAY_NAME_MAX_LENGTH)
    )
    fireEvent.change(input, { target: { value: 'New Name' } })
    expect(onEditedGuildChange).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'New Name' })
    )
  })

  it('GuildCard lets the display name be edited', () => {
    const onEditedGuildChange = vi.fn()
    render(
      <GuildCard
        {...commonProps}
        clusterId={null}
        onEditedGuildChange={onEditedGuildChange}
      />
    )
    const input = screen.getByLabelText('Guild display name')
    expect(input).toHaveValue('Old Name')
    fireEvent.change(input, { target: { value: 'New Name' } })
    expect(onEditedGuildChange).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'New Name' })
    )
  })
})

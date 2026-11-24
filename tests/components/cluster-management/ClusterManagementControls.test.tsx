import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuildTableRow } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/GuildTableRow'
import { GuildCard } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/GuildCard'
import { DiscordBotSection } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/DiscordBotSection'
import { GuildTable } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/GuildTable'
import ClusterManagement from '@/app/(dashboard)/leaderboards/components/cluster-management/ClusterManagement'
import type { Guild } from '@/app/(dashboard)/leaderboards/components/cluster-management/types'

// Fixtures are synthetic; never use real guild codes or names.

vi.mock(
  '@/app/(dashboard)/leaderboards/components/InlineWebhookManager',
  () => ({
    default: () => <div>webhook manager</div>
  })
)

vi.mock(
  '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useClusterData',
  () => ({
    useClusterData: () => ({
      guilds: [],
      loading: false,
      clusterId: 'CLU1',
      currentUserDisplayName: null,
      discordLinks: [],
      discordLinksLoading: false,
      discordLinksError: null,
      clusterInvites: [],
      setGuilds: vi.fn(),
      fetchGuilds: vi.fn(),
      fetchDiscordLinks: vi.fn(),
      setDiscordLinksError: vi.fn()
    })
  })
)

vi.mock(
  '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useGuildActions',
  () => ({
    useGuildActions: () => ({
      editingGuild: null,
      editedGuild: null,
      addingGuild: false,
      newGuild: {},
      addingGuildPending: false,
      validatingKey: null,
      deleteConfirmOpen: false,
      guildToDelete: null,
      deleteConfirmText: '',
      setEditingGuild: vi.fn(),
      setEditedGuild: vi.fn(),
      setAddingGuild: vi.fn(),
      setNewGuild: vi.fn(),
      setDeleteConfirmOpen: vi.fn(),
      setGuildToDelete: vi.fn(),
      setDeleteConfirmText: vi.fn(),
      handleEdit: vi.fn(),
      handleCancelEdit: vi.fn(),
      handleSaveEdit: vi.fn(),
      handleDelete: vi.fn(),
      handleDeleteConfirmed: vi.fn(),
      handleAddGuild: vi.fn(),
      checkGuildExists: vi.fn(),
      resetClaimMode: vi.fn(),
      claimMode: false,
      claimGuildInfo: null,
      checkingGuild: false,
      validateApiKey: vi.fn(),
      getApiKeyStatus: () => ({ text: '', color: '' })
    })
  })
)

vi.mock(
  '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useDiscordInvites',
  () => ({
    useDiscordInvites: () => ({
      copiedInvite: null,
      generatingInviteFor: null,
      inviteSuccessMessage: null,
      deletingInviteId: null,
      handleCopyInvite: vi.fn(),
      handleGenerateInvite: vi.fn(),
      handleDeleteInvite: vi.fn()
    })
  })
)

vi.mock(
  '@/app/(dashboard)/leaderboards/components/cluster-management/components',
  () => ({
    ClusterHeader: () => null,
    LeaderWarningBanner: () => null,
    AddGuildForm: () => null,
    DeleteConfirmDialog: () => null,
    GuildTable: () => null,
    GuildCards: () => null,
    DiscordBotSection: () => null
  })
)

vi.mock(
  '@/app/(dashboard)/leaderboards/components/ClusterIdentityManager',
  () => ({ default: () => null })
)
vi.mock(
  '@/app/(dashboard)/leaderboards/components/UnifiedWebhookManager',
  () => ({ default: () => null })
)

const guild: Guild = {
  guild_code: 'TEST1',
  guild_tag: 'TEST1',
  display_name: 'Example Guild',
  has_api_key: true,
  API_Owner: 'Example Leader',
  enabled: true,
  GR_Ranking: 1,
  GW_Ranking: 2,
  token_offender_threshold: 10,
  token_abuser_threshold: 15,
  cluster_code: 'CLU'
}

const commonProps = {
  guild,
  isEditing: false,
  editedGuild: null as Guild | null,
  validatingKey: null,
  expandedWebhooks: null as string | null,
  onEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onSaveEdit: vi.fn(),
  onDelete: vi.fn(),
  onValidateKey: vi.fn(),
  onToggleWebhooks: vi.fn(),
  onEditedGuildChange: vi.fn(),
  getApiKeyStatus: () => ({ text: 'Not set', color: '' })
}

const clusterInvite = {
  id: 1,
  inviteCode: 'CLUSTER-INV',
  createdAt: null,
  expiresAt: null,
  maxUses: 10,
  currentUses: 0,
  isActive: true
}

const guildInvite = {
  id: 2,
  inviteCode: 'GUILD-INV',
  createdAt: null,
  expiresAt: null,
  maxUses: 5,
  currentUses: 1,
  isActive: true
}

describe('cluster management labelled controls', () => {
  it('GuildTableRow edit row labels its icon-only buttons and inputs', () => {
    render(
      <table>
        <tbody>
          <GuildTableRow
            {...commonProps}
            isEditing
            editedGuild={guild}
            onEditedGuildChange={vi.fn()}
          />
        </tbody>
      </table>
    )

    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.getByLabelText('API key owner')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Guild enabled' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Save guild changes' })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Validate API key' })
    ).toBeTruthy()
  })

  it('GuildTableRow webhooks toggle exposes its expanded state', () => {
    render(
      <table>
        <tbody>
          <GuildTableRow {...commonProps} expandedWebhooks="TEST1" />
        </tbody>
      </table>
    )

    const toggle = screen.getByRole('button', {
      name: 'Manage webhooks for Example Guild'
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'guild-webhooks-TEST1')
  })

  it('GuildTable gives the expanded webhook region a matching id', () => {
    render(
      <GuildTable
        guilds={[guild]}
        editingGuild={null}
        editedGuild={null}
        validatingKey={null}
        expandedWebhooks="TEST1"
        clusterId="CLU1"
        onEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onDelete={vi.fn()}
        onValidateKey={vi.fn()}
        onToggleWebhooks={vi.fn()}
        onEditedGuildChange={vi.fn()}
        getApiKeyStatus={commonProps.getApiKeyStatus}
      />
    )

    const toggle = screen.getByRole('button', {
      name: 'Manage webhooks for Example Guild'
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('guild-webhooks-TEST1')).toBeTruthy()
  })

  it('GuildCard edit form associates labels with inputs and switch', () => {
    render(
      <GuildCard
        {...commonProps}
        isEditing
        editedGuild={guild}
        clusterId="CLU1"
      />
    )

    expect(screen.getByLabelText('API Key')).toBeTruthy()
    expect(screen.getByLabelText('API Key Owner')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Guild Enabled' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Save guild changes' })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Validate API key' })
    ).toBeTruthy()
  })

  it('GuildCard webhooks toggle exposes its expanded state and region', () => {
    render(
      <GuildCard {...commonProps} expandedWebhooks="TEST1" clusterId="CLU1" />
    )

    const toggle = screen.getByRole('button', { name: 'Webhooks' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'guild-webhooks-TEST1')
    expect(document.getElementById('guild-webhooks-TEST1')).toBeTruthy()
  })

  it('DiscordBotSection labels its icon-only copy and delete invite buttons', () => {
    render(
      <DiscordBotSection
        clusterCode="TEST"
        discordLinks={[
          {
            guildCode: 'TEST1',
            displayName: 'Example Guild',
            discordLink: null,
            invites: [guildInvite]
          }
        ]}
        discordLinksLoading={false}
        discordLinksError={null}
        clusterInvites={[clusterInvite]}
        copiedInvite={null}
        generatingInviteFor={null}
        inviteSuccessMessage={null}
        deletingInviteId={null}
        onRefresh={vi.fn()}
        onGenerateInvite={vi.fn()}
        onCopyInvite={vi.fn()}
        onDeleteInvite={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Copy invite CLUSTER-INV' })
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Delete invite CLUSTER-INV' })
    ).toBeTruthy()
    // Both the table and the mobile card chrome render the guild invite.
    expect(
      screen.getAllByRole('button', { name: 'Copy invite GUILD-INV' })
    ).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: 'Delete invite GUILD-INV' })
    ).toHaveLength(2)
  })

  it('ClusterManagement webhook settings toggle exposes expanded state', () => {
    render(
      <ClusterManagement
        season="S1"
        userRole="leader"
        userGuildCode="TEST1"
        clusterCode="TEST"
      />
    )

    const toggle = screen.getByRole('button', { name: /show settings/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute(
      'aria-controls',
      'discord-webhook-management'
    )

    fireEvent.click(toggle)

    expect(
      screen.getByRole('button', { name: /hide settings/i })
    ).toHaveAttribute('aria-expanded', 'true')
  })
})

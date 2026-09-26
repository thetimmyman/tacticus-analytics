'use client'

import { useState } from 'react'
import { Button } from '@tacticus/ui-kit'
import { TableSkeleton } from '@tacticus/ui-kit/loading'
import { AlertCircle, Palette, Eye, EyeOff } from 'lucide-react'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import ClusterIdentityManager from '../ClusterIdentityManager'
import UnifiedWebhookManager from '../UnifiedWebhookManager'
import { useClusterData } from './hooks/useClusterData'
import { useGuildActions } from './hooks/useGuildActions'
import { useDiscordInvites } from './hooks/useDiscordInvites'
import {
  ClusterHeader,
  LeaderWarningBanner,
  AddGuildForm,
  DeleteConfirmDialog,
  ClusterConfigSection,
  GuildTable,
  GuildCards,
  DiscordBotSection
} from './components'
import type { ClusterManagementProps, Guild } from './types'

interface WebhookManagementSectionProps {
  clusterId: string
  clusterCode: string
  guildCode: string | null
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

function WebhookManagementSection({
  clusterId,
  clusterCode,
  guildCode,
  expanded,
  onExpandedChange
}: WebhookManagementSectionProps) {
  return (
    <div
      id="discord-webhook-management"
      className="bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] backdrop-blur-sm rounded-lg border border-amber-400/30 p-6"
    >
      <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--primary)]">
            Discord Webhook Management
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Configure all Discord notifications in one place
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExpandedChange(!expanded)}
          className="flex shrink-0 items-center gap-2 self-start sm:self-auto"
        >
          {expanded ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          {expanded ? 'Hide Settings' : 'Show Settings'}
        </Button>
      </div>

      {expanded && (
        <UnifiedWebhookManager
          clusterId={clusterId}
          clusterCode={clusterCode}
          guildCode={guildCode}
          userRole="leader"
        />
      )}
    </div>
  )
}

export default function ClusterManagement({
  userGuildCode,
  userRole,
  clusterCode
}: ClusterManagementProps) {
  const [webhooksExpanded, setWebhooksExpanded] = useState(false)
  const [expandedWebhooks, setExpandedWebhooks] = useState<string | null>(null)
  const [clusterConfigExpanded, setClusterConfigExpanded] = useState(false)
  const isLeader = isClusterLeaderRole(userRole)

  const {
    guilds,
    loading,
    clusterId,
    clusterConfig,
    currentUserDisplayName,
    discordLinks,
    discordLinksLoading,
    discordLinksError,
    clusterInvites,
    setGuilds,
    setClusterConfig,
    fetchGuilds,
    fetchDiscordLinks,
    setDiscordLinksError: _setDiscordLinksError
  } = useClusterData({ clusterCode })

  const {
    editingGuild,
    editedGuild,
    addingGuild,
    newGuild,
    addingGuildPending,
    validatingKey,
    deleteConfirmOpen,
    guildToDelete,
    deleteConfirmText,
    savingClusterConfig,
    errorMessage,
    successMessage,
    setEditingGuild: _setEditingGuild,
    setEditedGuild,
    setAddingGuild,
    setNewGuild,
    setDeleteConfirmOpen,
    setGuildToDelete,
    setDeleteConfirmText,
    setErrorMessage: _setErrorMessage,
    setSuccessMessage: _setSuccessMessage,
    handleEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleDelete,
    handleDeleteConfirmed,
    handleAddGuild,
    checkGuildExists,
    resetClaimMode,
    claimMode,
    claimGuildInfo,
    checkingGuild,
    validateApiKey,
    saveClusterConfig,
    getApiKeyStatus
  } = useGuildActions({
    clusterCode,
    clusterId,
    guilds,
    currentUserDisplayName,
    setGuilds,
    fetchGuilds
  })

  const {
    copiedInvite,
    generatingInviteFor,
    inviteSuccessMessage,
    deletingInviteId,
    handleCopyInvite,
    handleGenerateInvite,
    handleDeleteInvite
  } = useDiscordInvites({ fetchDiscordLinks })

  if (loading) {
    return (
      <div className="py-6">
        <TableSkeleton rows={4} columns={5} />
        <p className="mt-4 text-center text-secondary-wh40k">
          Loading guild configurations...
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ClusterHeader
        guilds={guilds}
        addingGuild={addingGuild}
        onAddGuildClick={() => setAddingGuild(true)}
      />

      <LeaderWarningBanner />

      {addingGuild && (
        <AddGuildForm
          newGuild={newGuild}
          addingGuildPending={addingGuildPending}
          claimMode={claimMode}
          claimGuildInfo={claimGuildInfo}
          checkingGuild={checkingGuild}
          onNewGuildChange={setNewGuild}
          onCheckGuild={checkGuildExists}
          onCancel={() => {
            setAddingGuild(false)
            resetClaimMode()
            setNewGuild({
              enabled: true,
              token_offender_threshold: 10,
              token_abuser_threshold: 15
            })
          }}
          onSubmit={handleAddGuild}
        />
      )}

      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Cluster Identity & Branding
        </h2>
        {clusterCode ? (
          <ClusterIdentityManager
            clusterCode={clusterCode}
            isAdmin={userRole === 'leader'}
          />
        ) : (
          <div className="bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-[var(--primary)] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-[var(--primary)] mb-2">
                  Cluster Access Required
                </h3>
                <p className="text-[var(--text-secondary)] mb-4">
                  You need proper cluster access to manage cluster identity and
                  branding. This typically means you need to be:
                </p>
                <ul className="list-disc list-inside text-[var(--text-secondary)] text-sm space-y-1 mb-4">
                  <li>A Guild Leader in a cluster-enabled guild</li>
                  <li>
                    Assigned to a guild that belongs to a specific cluster
                  </li>
                  <li>
                    Have the cluster configuration properly set up in the
                    database
                  </li>
                </ul>
                <p className="text-[var(--text-secondary)] text-sm">
                  If you believe you should have cluster access, please contact
                  your system administrator or check your guild configuration.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {clusterId && isLeader && clusterCode && (
        <WebhookManagementSection
          clusterId={clusterId}
          clusterCode={clusterCode}
          guildCode={userGuildCode ?? null}
          expanded={webhooksExpanded}
          onExpandedChange={setWebhooksExpanded}
        />
      )}

      <GuildTable
        guilds={guilds}
        editingGuild={editingGuild}
        editedGuild={editedGuild}
        validatingKey={validatingKey}
        expandedWebhooks={expandedWebhooks}
        clusterId={clusterId}
        onEdit={handleEdit}
        onCancelEdit={handleCancelEdit}
        onSaveEdit={handleSaveEdit}
        onDelete={handleDelete}
        onValidateKey={validateApiKey}
        onToggleWebhooks={setExpandedWebhooks}
        onEditedGuildChange={setEditedGuild as (guild: Guild) => void}
        getApiKeyStatus={getApiKeyStatus}
      />

      {clusterCode && (
        <DiscordBotSection
          clusterCode={clusterCode}
          discordLinks={discordLinks}
          discordLinksLoading={discordLinksLoading}
          discordLinksError={discordLinksError}
          clusterInvites={clusterInvites}
          copiedInvite={copiedInvite}
          generatingInviteFor={generatingInviteFor}
          inviteSuccessMessage={inviteSuccessMessage}
          deletingInviteId={deletingInviteId}
          onRefresh={fetchDiscordLinks}
          onGenerateInvite={handleGenerateInvite}
          onCopyInvite={handleCopyInvite}
          onDeleteInvite={handleDeleteInvite}
        />
      )}

      <GuildCards
        guilds={guilds}
        editingGuild={editingGuild}
        editedGuild={editedGuild}
        validatingKey={validatingKey}
        expandedWebhooks={expandedWebhooks}
        clusterId={clusterId}
        onEdit={handleEdit}
        onCancelEdit={handleCancelEdit}
        onSaveEdit={handleSaveEdit}
        onDelete={handleDelete}
        onValidateKey={validateApiKey}
        onToggleWebhooks={setExpandedWebhooks}
        onEditedGuildChange={setEditedGuild as (guild: Guild) => void}
        getApiKeyStatus={getApiKeyStatus}
      />

      {userRole === 'leader' && (
        <ClusterConfigSection
          clusterConfig={clusterConfig}
          expanded={clusterConfigExpanded}
          savingClusterConfig={savingClusterConfig}
          errorMessage={errorMessage}
          successMessage={successMessage}
          onConfigChange={setClusterConfig}
          onExpandedChange={setClusterConfigExpanded}
          onSave={() => saveClusterConfig(clusterConfig)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        guildCode={guildToDelete}
        confirmText={deleteConfirmText}
        onOpenChange={setDeleteConfirmOpen}
        onConfirmTextChange={setDeleteConfirmText}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => {
          setDeleteConfirmOpen(false)
          setGuildToDelete(null)
          setDeleteConfirmText('')
        }}
      />
    </div>
  )
}

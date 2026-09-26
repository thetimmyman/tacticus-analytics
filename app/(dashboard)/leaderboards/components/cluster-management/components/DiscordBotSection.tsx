'use client'

import { Button } from '@tacticus/ui-kit'
import { TableSkeleton } from '@tacticus/ui-kit/loading'
import {
  Plus,
  Copy,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle,
  MessageSquare,
  Globe,
  Users
} from 'lucide-react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import type { GuildDiscordLink, ClusterInvite } from '../types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

interface DiscordBotSectionProps {
  clusterCode: string
  discordLinks: GuildDiscordLink[]
  discordLinksLoading: boolean
  discordLinksError: string | null
  clusterInvites: ClusterInvite[]
  copiedInvite: string | null
  generatingInviteFor: string | null
  inviteSuccessMessage: string | null
  deletingInviteId: number | null
  onRefresh: () => void
  onGenerateInvite: (guildCode?: string | null) => void
  onCopyInvite: (inviteCode: string) => void
  onDeleteInvite: (inviteId: number) => void
}

export function DiscordBotSection({
  clusterCode,
  discordLinks,
  discordLinksLoading,
  discordLinksError,
  clusterInvites,
  copiedInvite,
  generatingInviteFor,
  inviteSuccessMessage,
  deletingInviteId,
  onRefresh,
  onGenerateInvite,
  onCopyInvite,
  onDeleteInvite
}: DiscordBotSectionProps) {
  return (
    <div className="mt-8">
      <div className="card-wh40k p-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-[var(--primary)] flex items-center gap-2">
              <MessageSquare className="w-6 h-6" />
              Discord Bot Integration
            </h2>
            <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
              Manage Discord server links and invite codes for all guilds in
              cluster {clusterCode}. Generate cluster-wide invites for easy
              multi-guild bot deployment.
            </p>
          </div>
          <Button
            onClick={onRefresh}
            disabled={discordLinksLoading}
            variant="outline"
            className="flex items-center gap-2 self-start sm:self-auto"
          >
            <RefreshCw
              className={`w-4 h-4 ${discordLinksLoading ? 'animate-spin' : ''}`}
            />
            {discordLinksLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {discordLinksError && (
          <div className="p-4 bg-red-900/20 border border-red-600/30 rounded-lg text-red-300 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Error Loading Discord Links</p>
              <p className="mt-1">{discordLinksError}</p>
            </div>
          </div>
        )}
        {inviteSuccessMessage && (
          <div className="p-4 bg-green-900/20 border border-green-600/30 rounded-lg text-green-300 text-sm flex items-start gap-3">
            <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Success</p>
              <p className="mt-1">{inviteSuccessMessage}</p>
            </div>
          </div>
        )}

        <div className="border border-[var(--card-border)] rounded-lg overflow-hidden bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)]">
          <div className="px-4 py-3 border-b border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-[var(--primary)] flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Cluster-Wide Invite Codes
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  These invites work for any guild in the cluster. Share with
                  guild officers to run:
                  <br />
                  <code className="mt-1 inline-block px-2 py-1 bg-[color-mix(in_srgb,var(--bg-primary)_20%,transparent)] rounded text-[var(--text-primary)] text-xs">
                    /link guild:GUILDCODE invite:INVITECODE
                  </code>
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => onGenerateInvite(null)}
                disabled={
                  generatingInviteFor === 'cluster' || discordLinksLoading
                }
                className="bg-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_90%,transparent)] text-white flex items-center gap-2 self-start sm:self-auto"
              >
                {generatingInviteFor === 'cluster' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Generate Invite
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="p-4">
            {clusterInvites.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">
                <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">No cluster invites yet</p>
                <p className="text-xs mt-1">
                  Generate an invite to get started
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {clusterInvites.map((invite) => (
                  <InviteCard
                    key={invite.id}
                    invite={invite}
                    copiedInvite={copiedInvite}
                    deletingInviteId={deletingInviteId}
                    onCopy={onCopyInvite}
                    onDelete={onDeleteInvite}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--primary)]" />
            <h3 className="text-lg font-semibold text-[var(--primary)]">
              Guild Discord Links
            </h3>
          </div>

          {discordLinksLoading ? (
            <TableSkeleton rows={3} columns={3} />
          ) : discordLinks.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No guild data available</p>
              <p className="text-xs mt-1">Check cluster configuration</p>
            </div>
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto border border-[var(--card-border)] rounded-lg">
                <GuildDiscordTable
                  discordLinks={discordLinks}
                  copiedInvite={copiedInvite}
                  generatingInviteFor={generatingInviteFor}
                  deletingInviteId={deletingInviteId}
                  onGenerateInvite={onGenerateInvite}
                  onCopyInvite={onCopyInvite}
                  onDeleteInvite={onDeleteInvite}
                />
              </div>

              <div className="lg:hidden space-y-4">
                {discordLinks.map((link) => (
                  <GuildDiscordCard
                    key={`${link.guildCode}-mobile`}
                    link={link}
                    copiedInvite={copiedInvite}
                    generatingInviteFor={generatingInviteFor}
                    deletingInviteId={deletingInviteId}
                    onGenerateInvite={onGenerateInvite}
                    onCopyInvite={onCopyInvite}
                    onDeleteInvite={onDeleteInvite}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function InviteCard({
  invite,
  copiedInvite,
  deletingInviteId,
  onCopy,
  onDelete
}: {
  invite: ClusterInvite
  copiedInvite: string | null
  deletingInviteId: number | null
  onCopy: (code: string) => void
  onDelete: (id: number) => void
}) {
  const hasMounted = useHasMounted()
  return (
    <div className="border border-[var(--card-border)] rounded-lg p-4 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm text-[var(--text-primary)] break-all">
            {invite.inviteCode}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                invite.isActive
                  ? 'bg-green-900/30 text-green-300 border border-green-600/30'
                  : 'bg-gray-900/30 text-gray-400 border border-gray-600/30'
              }`}
            >
              {invite.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(invite.inviteCode)}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {copiedInvite === invite.inviteCode ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
          {invite.isActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(invite.id)}
              disabled={deletingInviteId === invite.id}
              className="text-red-400 hover:text-red-300"
            >
              {deletingInviteId === invite.id ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center justify-between">
          <span>Usage:</span>
          <span className="font-medium">
            {invite.currentUses}/{invite.maxUses}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Expires:</span>
          <span className="font-medium">
            {}
            {hasMounted
              ? invite.expiresAt
                ? new Date(invite.expiresAt).toLocaleDateString()
                : 'Never'
              : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Created:</span>
          <span className="font-medium">
            {}
            {hasMounted
              ? invite.createdAt
                ? new Date(invite.createdAt).toLocaleDateString()
                : '—'
              : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

function GuildDiscordTable({
  discordLinks,
  copiedInvite,
  generatingInviteFor,
  deletingInviteId,
  onGenerateInvite,
  onCopyInvite,
  onDeleteInvite
}: {
  discordLinks: GuildDiscordLink[]
  copiedInvite: string | null
  generatingInviteFor: string | null
  deletingInviteId: number | null
  onGenerateInvite: (guildCode?: string | null) => void
  onCopyInvite: (code: string) => void
  onDeleteInvite: (id: number) => void
}) {
  const hasMounted = useHasMounted()

  const columns: DataTableColumn<GuildDiscordLink>[] = [
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      className: 'align-top',
      render: (link) => (
        <div className="space-y-1">
          {/* text-base keeps this in step with the mobile card; DataTable's text-sm would shrink it. */}
          <div className="text-base font-semibold text-[var(--text-primary)]">
            {formatGuildDisplayLabel(
              {
                display_name: link.displayName,
                guild_code: link.guildCode
              },
              link.guildCode
            )}
          </div>
        </div>
      )
    },
    {
      key: 'discordServer',
      header: 'Discord Server',
      sortable: false,
      className: 'align-top',
      render: (link) =>
        link.discordLink ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-300 border border-green-600/30">
                Connected
              </span>
            </div>
            <div className="font-mono text-sm text-[var(--text-primary)] break-all">
              {link.discordLink.discordGuildId}
            </div>
            <div className="text-xs text-[var(--text-secondary)] space-y-1">
              <div>
                Linked:{' '}
                {hasMounted
                  ? link.discordLink.linkedAt
                    ? new Date(link.discordLink.linkedAt).toLocaleDateString()
                    : '—'
                  : '—'}
              </div>
              {link.discordLink.linkedByUserId && (
                <div>By: {link.discordLink.linkedByUserId}</div>
              )}
              {link.discordLink.invitedWithCode && (
                <div>Code: {link.discordLink.invitedWithCode}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-900/30 text-yellow-300 border border-yellow-600/30">
              Not Connected
            </span>
          </div>
        )
    },
    {
      key: 'invites',
      header: 'Guild-Specific Invites',
      sortable: false,
      className: 'align-top',
      render: (link) => (
        <div className="space-y-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onGenerateInvite(link.guildCode)}
            disabled={generatingInviteFor === link.guildCode}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {generatingInviteFor === link.guildCode ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-3 h-3 mr-2" />
                Generate Invite
              </>
            )}
          </Button>
          {link.invites.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              No guild-specific invites
            </p>
          ) : (
            <div className="space-y-2">
              {link.invites.map((invite) => (
                <SmallInviteCard
                  key={invite.id}
                  invite={invite}
                  copiedInvite={copiedInvite}
                  deletingInviteId={deletingInviteId}
                  onCopy={onCopyInvite}
                  onDelete={onDeleteInvite}
                />
              ))}
            </div>
          )}
        </div>
      )
    }
  ]

  return (
    <DataTable
      rows={discordLinks}
      columns={columns}
      rowKey={(link) => link.guildCode}
      tableClassName="[&_tbody]:bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]"
    />
  )
}

function SmallInviteCard({
  invite,
  copiedInvite,
  deletingInviteId,
  onCopy,
  onDelete
}: {
  invite: ClusterInvite
  copiedInvite: string | null
  deletingInviteId: number | null
  onCopy: (code: string) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="border border-[var(--card-border)] rounded p-2 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-[var(--text-primary)] break-all">
          {invite.inviteCode}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(invite.inviteCode)}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {copiedInvite === invite.inviteCode ? (
              <CheckCircle className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </Button>
          {invite.isActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(invite.id)}
              disabled={deletingInviteId === invite.id}
              className="text-red-400 hover:text-red-300"
            >
              {deletingInviteId === invite.id ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3" />
              )}
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            invite.isActive
              ? 'bg-green-900/30 text-green-300 border border-green-600/30'
              : 'bg-gray-900/30 text-gray-400 border border-gray-600/30'
          }`}
        >
          {invite.isActive ? 'Active' : 'Inactive'}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
          {invite.currentUses}/{invite.maxUses} uses
        </span>
      </div>
    </div>
  )
}

function GuildDiscordCard({
  link,
  copiedInvite,
  generatingInviteFor,
  deletingInviteId,
  onGenerateInvite,
  onCopyInvite,
  onDeleteInvite
}: {
  link: GuildDiscordLink
  copiedInvite: string | null
  generatingInviteFor: string | null
  deletingInviteId: number | null
  onGenerateInvite: (guildCode?: string | null) => void
  onCopyInvite: (code: string) => void
  onDeleteInvite: (id: number) => void
}) {
  const hasMounted = useHasMounted()
  return (
    <div className="border border-[var(--card-border)] rounded-lg p-4 bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)] space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-semibold text-[var(--text-primary)]">
            {formatGuildDisplayLabel(
              {
                display_name: link.displayName,
                guild_code: link.guildCode
              },
              link.guildCode
            )}
          </h4>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onGenerateInvite(link.guildCode)}
          disabled={generatingInviteFor === link.guildCode}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {generatingInviteFor === link.guildCode ? (
            <>
              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="w-3 h-3 mr-1" />
              Generate
            </>
          )}
        </Button>
      </div>

      <div className="border-t border-[var(--card-border)] pt-3">
        <h5 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-2">
          Discord Connection
        </h5>
        {link.discordLink ? (
          <div className="space-y-2">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-300 border border-green-600/30">
              Connected
            </span>
            <div className="text-xs text-[var(--text-secondary)] space-y-1">
              <div>
                Server ID:{' '}
                <span className="font-mono">
                  {link.discordLink.discordGuildId}
                </span>
              </div>
              {}
              <div>
                Linked:{' '}
                {hasMounted
                  ? link.discordLink.linkedAt
                    ? new Date(link.discordLink.linkedAt).toLocaleDateString()
                    : '—'
                  : '—'}
              </div>
            </div>
          </div>
        ) : (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-900/30 text-yellow-300 border border-yellow-600/30">
            Not Connected
          </span>
        )}
      </div>

      <div className="border-t border-[var(--card-border)] pt-3">
        <h5 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-2">
          Guild-Specific Invites
        </h5>
        {link.invites.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">
            No guild-specific invites yet
          </p>
        ) : (
          <div className="space-y-2">
            {link.invites.map((invite) => (
              <SmallInviteCard
                key={invite.id}
                invite={invite}
                copiedInvite={copiedInvite}
                deletingInviteId={deletingInviteId}
                onCopy={onCopyInvite}
                onDelete={onDeleteInvite}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

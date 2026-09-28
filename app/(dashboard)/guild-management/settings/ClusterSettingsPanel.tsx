'use client'

import { Button } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import {
  Users,
  Crown,
  MessageSquare,
  BarChart,
  Plus,
  AlertCircle,
  Loader2,
  Settings,
  Hash
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { UserRole } from '@tacticus/app-core/types'
import type {
  GuildSettingsRecord,
  ClusterDetails
} from '@/app/lib/services/guild-settings-service'
import { SettingsSection } from './SettingsSection'
import { cn } from '@/app/lib/utils/cn'

interface ClusterSettingsPanelProps {
  userRole: UserRole
  guildConfig: GuildSettingsRecord
  loadingClusterInfo: boolean
  clusterInfo: ClusterDetails | null
  onCreateCluster: () => void
  onJoinCluster: () => void
  saving: boolean
}

export function ClusterSettingsPanel({
  userRole,
  guildConfig,
  loadingClusterInfo,
  clusterInfo,
  onCreateCluster,
  onJoinCluster,
  saving
}: ClusterSettingsPanelProps) {
  if (userRole !== 'leader' && userRole !== 'officer') {
    return (
      <SettingsSection
        title="Cluster command locked"
        description="Only guild leaders and officers can review cluster membership. Coordinate with your primarch to gain access."
        icon={Users}
        tone="warning"
      >
        <p className="text-sm text-secondary-wh40k">
          Members can view cluster benefits once leadership has provisioned a
          cluster.
        </p>
      </SettingsSection>
    )
  }

  if (!guildConfig.cluster_id && !guildConfig.cluster_code) {
    return (
      <SettingsSection
        title="Cluster alliance"
        description="Create a new cluster to lead, or join an existing one with an invite code from another guild leader."
        icon={Crown}
        tone="accent"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <ClusterHighlight
            icon={Crown}
            title="Cluster leadership"
            description="You become the cluster admin with full management privileges."
          />
          <ClusterHighlight
            icon={MessageSquare}
            title="Invite network"
            description="Generate invite codes or send encrypted summons to leaders directly."
          />
          <ClusterHighlight
            icon={BarChart}
            title="Unified analytics"
            description="Shared dashboards, leaderboards, and raid preparation across every member guild."
          />
        </div>

        <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
          <Button
            type="button"
            onClick={onCreateCluster}
            className="min-w-[220px]"
            disabled={saving}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create new cluster
          </Button>
          <Button
            type="button"
            onClick={onJoinCluster}
            variant="outline"
            className="min-w-[220px]"
            disabled={saving}
          >
            <Hash className="w-4 h-4 mr-2" />
            Join with invite code
          </Button>
        </div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      title="Cluster Membership"
      description="Review the strategic particulars for your current cluster coalition."
      icon={Users}
    >
      {loadingClusterInfo ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-(--accent)" />
          <span className="ml-3 text-sm text-secondary-wh40k">
            Contacting cluster archives…
          </span>
        </div>
      ) : clusterInfo ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <ClusterInfoField
              label="Cluster code"
              value={clusterInfo.cluster_code}
              mono
            />
            <ClusterInfoField
              label="Display name"
              value={clusterInfo.display_name}
            />
          </div>
          {clusterInfo.description && (
            <div className="space-y-2">
              <Label>Description</Label>
              <div className="rounded-2xl border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] px-4 py-3 text-sm text-secondary-wh40k">
                {clusterInfo.description}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            <Button
              type="button"
              onClick={() => window.open('/leaderboards', '_blank')}
              variant="outline"
              className="rounded-xl"
            >
              <BarChart className="w-4 h-4 mr-2" />
              View cluster dashboard
            </Button>
            <Button
              type="button"
              onClick={() =>
                window.open('/leaderboards?tab=management', '_blank')
              }
              variant="outline"
              className="rounded-xl"
            >
              <Settings className="w-4 h-4 mr-2" />
              Open management console
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-4 text-sm text-primary-wh40k">
          <AlertCircle className="h-5 w-5 text-(--accent)" />
          Unable to load cluster details—refresh to retry or verify permissions.
        </div>
      )}
    </SettingsSection>
  )
}

function ClusterHighlight({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-4 text-sm text-secondary-wh40k shadow-[0_12px_24px_rgba(4,8,20,0.4)]">
      <Icon className="mx-auto mb-3 h-8 w-8 text-(--accent)" />
      <h3 className="text-center text-primary-wh40k font-semibold mb-1">
        {title}
      </h3>
      <p className="text-center">{description}</p>
    </div>
  )
}

function ClusterInfoField({
  label,
  value,
  mono
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div
        className={cn(
          'rounded-2xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] px-4 py-3 text-sm text-primary-wh40k',
          mono && 'font-mono tracking-widest'
        )}
      >
        {value || '—'}
      </div>
    </div>
  )
}

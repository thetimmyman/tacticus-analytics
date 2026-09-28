import type { Dispatch, SetStateAction } from 'react'
import { RefreshCw, Users } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  StatusLabel
} from '@tacticus/ui-kit'
import type {
  ClusterGuildSummary,
  ClusterSummary
} from '@tacticus/app-core/onboarding.types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { JOB_STATUS_LABELS } from './OnboardingStatusCards'

interface ClusterForm {
  name: string
  code: string
  description: string
}

interface ClusterGuildForm {
  code: string
  name: string
  apiKey: string
}

interface ClusterOnboardingCardProps {
  cluster: ClusterSummary | null
  clusterGuilds: ClusterGuildSummary[]
  clusterForm: ClusterForm
  setClusterForm: Dispatch<SetStateAction<ClusterForm>>
  clusterGuildForm: ClusterGuildForm
  setClusterGuildForm: Dispatch<SetStateAction<ClusterGuildForm>>
  pendingAction: string | null
  clusterRequeueTarget: string | null
  onRefresh: () => void
  onCreateCluster: () => void
  onAddGuild: () => void
  onRequeueGuild: (guildCode: string) => void
}

export function ClusterOnboardingCard({
  cluster,
  clusterGuilds,
  clusterForm,
  setClusterForm,
  clusterGuildForm,
  setClusterGuildForm,
  pendingAction,
  clusterRequeueTarget,
  onRefresh,
  onCreateCluster,
  onAddGuild,
  onRequeueGuild
}: ClusterOnboardingCardProps) {
  return (
    <Card className="border-card-border/60 bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] backdrop-blur-xs">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-(--accent)" />
            Cluster onboarding
          </CardTitle>
          <StatusLabel type={cluster ? 'success' : 'inactive'} size="xs">
            {cluster ? 'Configured' : 'Not started'}
          </StatusLabel>
        </div>
        <p className="text-sm text-secondary-wh40k">
          Create or manage a cluster and queue guild sync jobs without leaving
          the dashboard.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {cluster ? (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm text-secondary-wh40k">Cluster code</p>
                <p className="text-lg font-semibold text-primary-wh40k">
                  {cluster.cluster_code}
                </p>
                {cluster.description && (
                  <p className="text-xs text-secondary-wh40k mt-1">
                    {cluster.description}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={pendingAction !== null}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh status
              </Button>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-primary-wh40k">
                Guilds in this cluster
              </h4>
              {clusterGuilds.length === 0 ? (
                <p className="text-sm text-secondary-wh40k">
                  No guilds are linked yet. Add a guild below to queue its
                  initial sync.
                </p>
              ) : (
                <div className="space-y-3">
                  {clusterGuilds.map((guild) => {
                    const status = guild.job
                      ? {
                          label:
                            JOB_STATUS_LABELS[guild.job.status] ??
                            guild.job.status,
                          type:
                            guild.job.status === 'completed'
                              ? ('success' as const)
                              : guild.job.status === 'failed'
                                ? ('error' as const)
                                : ('pending' as const)
                        }
                      : guild.onboarding_completed || guild.enabled
                        ? { label: 'Ready', type: 'success' as const }
                        : { label: 'Pending', type: 'pending' as const }
                    const isProcessing = guild.job?.status === 'processing'
                    const actionLabel = isProcessing
                      ? 'Sync in progress'
                      : guild.job
                        ? 'Retry sync'
                        : 'Queue sync'

                    return (
                      <div
                        key={guild.guild_code}
                        className="rounded-lg border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] p-4 space-y-2"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm font-semibold text-primary-wh40k">
                            {formatGuildDisplayLabel(
                              {
                                display_name: guild.display_name,
                                guild_tag: (
                                  guild as { guild_tag?: string | null }
                                ).guild_tag,
                                guild_code: guild.guild_code
                              },
                              guild.guild_code
                            )}
                          </p>
                          <StatusLabel type={status.type} size="xs">
                            {status.label}
                          </StatusLabel>
                        </div>
                        {guild.job && (
                          <div className="flex flex-wrap items-center gap-3 text-xs text-secondary-wh40k">
                            <span>
                              Attempts {guild.job.attempts}/
                              {guild.job.max_attempts}
                            </span>
                            {guild.job.error_message && (
                              <span className="text-red-300">
                                Last error: {guild.job.error_message}
                              </span>
                            )}
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRequeueGuild(guild.guild_code)}
                          disabled={
                            isProcessing ||
                            (pendingAction !== null &&
                              pendingAction !== 'cluster_requeue') ||
                            (pendingAction === 'cluster_requeue' &&
                              clusterRequeueTarget !== guild.guild_code)
                          }
                          loading={
                            pendingAction === 'cluster_requeue' &&
                            clusterRequeueTarget === guild.guild_code
                          }
                        >
                          {actionLabel}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-primary-wh40k">
                Add a guild to this cluster
              </h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="clusterGuildCode">Guild code</Label>
                  <Input
                    id="clusterGuildCode"
                    placeholder="e.g. NOVA"
                    value={clusterGuildForm.code}
                    onChange={(event) =>
                      setClusterGuildForm((previous) => ({
                        ...previous,
                        code: event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clusterGuildName">Guild name</Label>
                  <Input
                    id="clusterGuildName"
                    placeholder="Guild display name"
                    value={clusterGuildForm.name}
                    onChange={(event) =>
                      setClusterGuildForm((previous) => ({
                        ...previous,
                        name: event.target.value
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clusterGuildApiKey">Leader API key</Label>
                  <Input
                    id="clusterGuildApiKey"
                    placeholder="Paste API key"
                    value={clusterGuildForm.apiKey}
                    onChange={(event) =>
                      setClusterGuildForm((previous) => ({
                        ...previous,
                        apiKey: event.target.value
                      }))
                    }
                    type="password"
                  />
                </div>
              </div>
              <p className="text-xs text-secondary-wh40k">
                We store leader API keys encrypted and queue an initial sync job
                automatically.
              </p>
              <Button
                onClick={onAddGuild}
                loading={pendingAction === 'cluster_guild'}
                disabled={pendingAction !== null}
              >
                Queue guild sync
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-secondary-wh40k">
              Create a cluster to onboard multiple guilds together and unlock
              shared analytics.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clusterName">Cluster name</Label>
                <Input
                  id="clusterName"
                  placeholder="Cluster display name"
                  value={clusterForm.name}
                  onChange={(event) =>
                    setClusterForm((previous) => ({
                      ...previous,
                      name: event.target.value
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clusterCode">Cluster code</Label>
                <Input
                  id="clusterCode"
                  placeholder="2-10 letters or numbers"
                  value={clusterForm.code}
                  onChange={(event) =>
                    setClusterForm((previous) => ({
                      ...previous,
                      code: event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clusterDescription">Description (optional)</Label>
              <textarea
                id="clusterDescription"
                value={clusterForm.description}
                onChange={(event) =>
                  setClusterForm((previous) => ({
                    ...previous,
                    description: event.target.value
                  }))
                }
                rows={3}
                className="w-full rounded-md border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] px-3 py-2 text-sm text-primary-wh40k focus:outline-hidden focus:ring-1 focus:ring-(--accent)"
                placeholder="Share how the cluster operates or who it serves."
              />
            </div>
            <Button
              onClick={onCreateCluster}
              loading={pendingAction === 'cluster_create'}
              disabled={pendingAction !== null}
            >
              Create cluster
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

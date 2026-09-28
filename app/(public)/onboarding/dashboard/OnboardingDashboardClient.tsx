'use client'

import { useMemo } from 'react'
import type { ComponentProps } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { StatusLabel } from '@tacticus/ui-kit'
import { CheckCircle2, RefreshCw, Shield } from 'lucide-react'
import type {
  OnboardingGuildStatus,
  OnboardingSyncStatus,
  OnboardingProfileStatus
} from '@tacticus/app-core/onboarding.types'
import { cn } from '@/app/lib/utils/cn'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { ClusterOnboardingCard } from './ClusterOnboardingCard'
import type { OnboardingDashboardProps } from './onboarding-dashboard-types'
import { formatRelativeTime } from './onboarding-dashboard-utils'
import {
  displayableStepError,
  JOB_STATUS_LABELS,
  ProfileClaimCard,
  StepErrorBanner,
  SyncStatusCard
} from './OnboardingStatusCards'
import { useClusterOnboarding } from './useClusterOnboarding'
import { useGuildOnboardingSteps } from './useGuildOnboardingSteps'
import { useOnboardingProgress } from './useOnboardingProgress'

type StatusType = ComponentProps<typeof StatusLabel>['type']

const GUILD_STATUS_LABELS: Record<
  OnboardingGuildStatus,
  { label: string; type: StatusType }
> = {
  not_started: { label: 'Not started', type: 'inactive' },
  pending: { label: 'Pending review', type: 'pending' },
  in_progress: { label: 'In progress', type: 'in_progress' },
  complete: { label: 'Complete', type: 'completed' },
  failed: { label: 'Needs attention', type: 'error' }
}

const SYNC_STATUS_LABELS: Record<
  OnboardingSyncStatus,
  { label: string; type: StatusType }
> = {
  not_required: { label: 'Not required', type: 'info' },
  pending: { label: 'Ready to sync', type: 'pending' },
  syncing: { label: 'Syncing...', type: 'pending' },
  complete: { label: 'Sync complete', type: 'completed' },
  failed: { label: 'Sync failed', type: 'error' }
}

const PROFILE_STATUS_LABELS: Record<
  OnboardingProfileStatus,
  { label: string; type: StatusType }
> = {
  not_started: { label: 'Not started', type: 'inactive' },
  pending: { label: 'Verifying player', type: 'pending' },
  complete: { label: 'Profile claimed', type: 'completed' },
  failed: { label: 'Claim failed', type: 'error' }
}

export default function OnboardingDashboardClient({
  user,
  initialProgress,
  initialSyncStatus,
  initialJob,
  initialCluster,
  initialClusterGuilds,
  guildAwaitingFirstClaim = false
}: OnboardingDashboardProps) {
  const progressState = useOnboardingProgress({
    initialProgress,
    initialSyncStatus,
    initialJob,
    initialCluster,
    initialClusterGuilds,
    guildAwaitingFirstClaim
  })
  const {
    progress,
    setProgress,
    mode,
    setMode,
    existingGuildCode,
    setExistingGuildCode,
    pendingAction,
    setPendingAction,
    syncMeta,
    job,
    setJob,
    cluster,
    setCluster,
    clusterGuilds,
    setClusterGuilds,
    awaitingFirstClaim,
    setAwaitingFirstClaim,
    seatClaimed,
    setSeatClaimed,
    refreshProgress
  } = progressState
  const guildSteps = useGuildOnboardingSteps({
    progress,
    setProgress,
    mode,
    setMode,
    existingGuildCode,
    pendingAction,
    setPendingAction,
    setJob,
    setCluster,
    setClusterGuilds,
    setAwaitingFirstClaim,
    refreshProgress
  })
  const {
    newGuildCode,
    setNewGuildCode,
    newGuildName,
    setNewGuildName,
    newGuildApiKey,
    setNewGuildApiKey,
    syncApiKey,
    syncKeyRequired,
    handleSyncApiKeyChange,
    handleModeChange,
    submitExistingGuild,
    submitNewGuild,
    startSync
  } = guildSteps
  const clusterSteps = useClusterOnboarding({
    cluster,
    clusterGuilds,
    pendingAction,
    setPendingAction,
    refreshProgress
  })
  const {
    clusterForm,
    setClusterForm,
    clusterGuildForm,
    setClusterGuildForm,
    clusterRequeueTarget,
    handleCreateCluster,
    handleAddClusterGuild,
    handleRequeueClusterGuild
  } = clusterSteps

  const progressGuildLabel = formatGuildDisplayLabel(
    { display_name: progress.guild_name, guild_code: progress.guild_code },
    progress.guild_code
  )
  const guildStatus = useMemo(
    () => GUILD_STATUS_LABELS[progress.guild_status],
    [progress.guild_status]
  )
  const syncStatus = useMemo(
    () =>
      SYNC_STATUS_LABELS[progress.sync_status] ?? {
        label: 'Awaiting kickoff',
        type: 'inactive'
      },
    [progress.sync_status]
  )
  const profileStatus = useMemo(
    () => PROFILE_STATUS_LABELS[progress.profile_status],
    [progress.profile_status]
  )
  const lastSyncValue = syncMeta?.last_sync ?? null
  const lastSyncRelative = (() => {
    if (!lastSyncValue) return null
    const parsed = new Date(lastSyncValue)
    return Number.isNaN(parsed.getTime()) ? null : formatRelativeTime(parsed)
  })()
  const latestJobStatus = job
    ? (JOB_STATUS_LABELS[job.status] ?? job.status)
    : null
  const jobTimestamp =
    job?.completed_at ?? job?.started_at ?? job?.created_at ?? null
  const jobRelative = (() => {
    if (!jobTimestamp) return null
    const parsed = new Date(jobTimestamp)
    return Number.isNaN(parsed.getTime()) ? null : formatRelativeTime(parsed)
  })()
  const isLeader = progress.role_intent === 'leader'
  const guildComplete = progress.guild_status === 'complete'
  const syncComplete =
    progress.sync_status === 'complete' ||
    progress.sync_status === 'not_required'
  const profileComplete = progress.profile_status === 'complete'
  const allStepsComplete = guildComplete && syncComplete && profileComplete
  const refreshDisabled =
    pendingAction !== null || progress.sync_status === 'syncing'

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase text-(--accent) tracking-wide">
            Welcome, {user.displayName || user.email}
          </p>
          <h1 className="text-3xl font-semibold text-primary-wh40k">
            Onboarding Dashboard
          </h1>
          <p className="text-sm text-secondary-wh40k">
            Complete the steps below to finish setting up your guild analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshProgress(true)}
            loading={pendingAction === 'refresh'}
            disabled={refreshDisabled}
            tooltip="Refresh onboarding progress"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {profileComplete ? (
            <StatusLabel type="success" className="text-xs">
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Onboarding complete
            </StatusLabel>
          ) : (
            <StatusLabel type="pending" className="text-xs">
              <RefreshCw className="h-4 w-4" />
              In progress
            </StatusLabel>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-card-border/60 bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] backdrop-blur-xs">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Shield className="h-5 w-5 text-(--accent)" />
                Step 1 - Guild setup
              </CardTitle>
              <StatusLabel type={guildStatus.type} size="xs">
                {guildStatus.label}
              </StatusLabel>
            </div>
            <p className="text-sm text-secondary-wh40k">
              Choose whether you&apos;re joining an existing guild or
              registering a new one.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {progress.guild_status === 'failed' && (
              <StepErrorBanner
                title="Guild setup failed"
                message={displayableStepError(progress.guild_error_message)}
                fallback="Please check the details above and try again."
              />
            )}

            <div className="flex gap-2">
              <Button
                variant={mode === 'existing_guild' ? 'default' : 'outline'}
                className={cn('flex-1')}
                onClick={() => handleModeChange('existing_guild')}
                loading={pendingAction === 'mode' && mode === 'existing_guild'}
                disabled={pendingAction !== null && pendingAction !== 'mode'}
              >
                Join Existing Guild
              </Button>
              <Button
                variant={mode === 'new_guild' ? 'default' : 'outline'}
                className={cn('flex-1')}
                onClick={() => handleModeChange('new_guild')}
                loading={pendingAction === 'mode' && mode === 'new_guild'}
                disabled={pendingAction !== null && pendingAction !== 'mode'}
              >
                Register New Guild
              </Button>
            </div>

            {mode === 'existing_guild' ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitExistingGuild()
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="existingGuildCode">Guild code</Label>
                  <p className="text-xs text-secondary-wh40k">
                    Enter the guild code shown on your guild&rsquo;s overview
                    screen inside Tacticus.
                  </p>
                  <Input
                    id="existingGuildCode"
                    placeholder="Enter guild code (e.g. OVJUY)"
                    value={existingGuildCode}
                    onChange={(event) =>
                      setExistingGuildCode(event.target.value.toUpperCase())
                    }
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  loading={pendingAction === 'existing'}
                >
                  Save guild
                </Button>
              </form>
            ) : (
              <form
                method="post"
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitNewGuild()
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="newGuildCode">Guild code</Label>
                  <p className="text-xs text-secondary-wh40k">
                    Pick a unique 2-7 letter identifier players will use when
                    joining onboarding.
                  </p>
                  <Input
                    id="newGuildCode"
                    placeholder="Unique code (2-7 letters)"
                    value={newGuildCode}
                    onChange={(event) =>
                      setNewGuildCode(event.target.value.toUpperCase())
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newGuildName">Guild name</Label>
                  <p className="text-xs text-secondary-wh40k">
                    This is the display name everyone will see in analytics. You
                    can tweak it later in guild settings.
                  </p>
                  <Input
                    id="newGuildName"
                    placeholder="Displayed guild name"
                    value={newGuildName}
                    onChange={(event) => setNewGuildName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newGuildApiKey">Guild leader API key</Label>
                  <ol className="text-xs text-secondary-wh40k list-decimal list-inside space-y-0.5 my-1">
                    <li>
                      Go to{' '}
                      <a
                        href="https://api.tacticusgame.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-(--accent) underline hover:opacity-80"
                      >
                        api.tacticusgame.com
                      </a>
                    </li>
                    {/* Player is listed so ONE key also satisfies the Step 3 seat claim (/guild AND /player). */}
                    <li>
                      Click &quot;Create New API Key&quot; with read access to:
                      Guild, Guild Raid &amp; Player
                    </li>
                    <li>Copy and paste it below</li>
                  </ol>
                  <Input
                    id="newGuildApiKey"
                    placeholder="Paste the leader API key"
                    value={newGuildApiKey}
                    onChange={(event) => setNewGuildApiKey(event.target.value)}
                    type="password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  loading={pendingAction === 'new'}
                >
                  Register guild
                </Button>
              </form>
            )}

            {guildComplete && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-100">
                    Guild confirmed: {progressGuildLabel}
                  </p>
                  <p className="text-emerald-200/80">
                    Continue to the data sync step to populate analytics.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <SyncStatusCard
          progress={progress}
          status={syncStatus}
          job={job}
          latestJobStatus={latestJobStatus}
          jobRelative={jobRelative}
          lastSyncRelative={lastSyncRelative}
          syncMetaStatus={syncMeta?.status ?? null}
          guildComplete={guildComplete}
          syncComplete={syncComplete}
          mode={mode}
          pendingSync={pendingAction === 'sync'}
          onStartSync={startSync}
          apiKeyRequired={syncKeyRequired}
          apiKeyValue={syncApiKey}
          onApiKeyChange={handleSyncApiKeyChange}
        />

        <ProfileClaimCard
          progress={progress}
          status={profileStatus}
          profileComplete={profileComplete}
          guildComplete={guildComplete}
          syncComplete={syncComplete}
          guildAwaitingFirstClaim={awaitingFirstClaim}
          seatClaimed={seatClaimed}
          onSeatClaimed={() => setSeatClaimed(true)}
        />
      </div>

      {isLeader && (
        <ClusterOnboardingCard
          cluster={cluster}
          clusterGuilds={clusterGuilds}
          clusterForm={clusterForm}
          setClusterForm={setClusterForm}
          clusterGuildForm={clusterGuildForm}
          setClusterGuildForm={setClusterGuildForm}
          pendingAction={pendingAction}
          clusterRequeueTarget={clusterRequeueTarget}
          onRefresh={() => refreshProgress(true)}
          onCreateCluster={handleCreateCluster}
          onAddGuild={handleAddClusterGuild}
          onRequeueGuild={handleRequeueClusterGuild}
        />
      )}

      {allStepsComplete && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            <p className="font-semibold text-emerald-50">Onboarding complete</p>
          </div>
          <p className="text-emerald-200/80">
            You&apos;re ready to explore the analytics dashboard. Bookmark the
            links below or invite fellow guildmates to onboard.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-accent-wh40k px-3 py-2 text-sm font-medium text-(--bg-primary) hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] transition-colors"
            >
              Go to analytics dashboard
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

import Link from 'next/link'
import type { ComponentProps } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Sparkles,
  User
} from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  StatusLabel
} from '@tacticus/ui-kit'
import type {
  GuildMode,
  OnboardingJob,
  OnboardingJobStatus,
  OnboardingProgress
} from '@tacticus/app-core/onboarding.types'
import { cn } from '@/app/lib/utils/cn'
import { LeaderSeatClaim } from './LeaderSeatClaim'

type StatusType = ComponentProps<typeof StatusLabel>['type']

interface StatusDescriptor {
  label: string
  type: StatusType
}

interface SyncStatusCardProps {
  progress: OnboardingProgress
  status: StatusDescriptor
  job: OnboardingJob | null
  latestJobStatus: string | null
  jobRelative: string | null
  lastSyncRelative: string | null
  syncMetaStatus: string | null
  guildComplete: boolean
  syncComplete: boolean
  mode: GuildMode
  pendingSync: boolean
  onStartSync: () => void
  /** Last sync failed with GUILD_ATTESTATION_REQUIRED. */
  apiKeyRequired?: boolean
  apiKeyValue?: string
  onApiKeyChange?: (value: string) => void
}

export const JOB_STATUS_LABELS: Record<OnboardingJobStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed'
}

export function StepErrorBanner({
  title,
  message,
  fallback
}: {
  title: string
  message: string | null
  fallback: string
}) {
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5" />
      <div>
        <p className="font-medium">{title}</p>
        <p>{message || fallback}</p>
      </div>
    </div>
  )
}

const MAX_STEP_ERROR_LENGTH = 300

/** Legacy rows can hold a serialized AppError with raw PostgREST text. */
export function displayableStepError(message: string | null): string | null {
  if (!message) return null
  const trimmed = message.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) return null
  if (trimmed.length > MAX_STEP_ERROR_LENGTH) return null
  return trimmed
}

export function SyncStatusCard({
  progress,
  status,
  job,
  latestJobStatus,
  jobRelative,
  lastSyncRelative,
  syncMetaStatus,
  guildComplete,
  syncComplete,
  mode,
  pendingSync,
  onStartSync,
  apiKeyRequired = false,
  apiKeyValue = '',
  onApiKeyChange
}: SyncStatusCardProps) {
  return (
    <Card className="border-card-border/60 bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] backdrop-blur-xs">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-(--accent)" />
            Step 2 - Initial data sync
          </CardTitle>
          <StatusLabel type={status.type} size="xs">
            {status.label}
          </StatusLabel>
        </div>
        <p className="text-sm text-secondary-wh40k">
          We pull raid data and player mappings using your leader key.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {progress.sync_status === 'failed' && (
          <StepErrorBanner
            title="Sync failed"
            message={progress.sync_error_message}
            fallback="Please check your API key and try again."
          />
        )}

        {job && (
          <div className="rounded-lg border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-4 py-3 text-xs text-secondary-wh40k space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-primary-wh40k">
                Sync job: {latestJobStatus}
              </p>
              <StatusLabel
                type={
                  job.status === 'completed'
                    ? 'success'
                    : job.status === 'failed'
                      ? 'error'
                      : 'pending'
                }
                size="xs"
              >
                {JOB_STATUS_LABELS[job.status]}
              </StatusLabel>
            </div>
            <div className="flex items-center justify-between text-secondary-wh40k">
              <span>
                Attempts {job.attempts}/{job.max_attempts}
              </span>
              {jobRelative && <span>Updated {jobRelative}</span>}
            </div>
            {job.error_message ? (
              <p className="text-red-300">Last error: {job.error_message}</p>
            ) : (
              job.status === 'processing' && (
                <p className="text-secondary-wh40k">
                  We&apos;re importing data in the background. Feel free to
                  navigate elsewhere—progress will continue.
                </p>
              )
            )}
            {job.status === 'failed' && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onStartSync}
                disabled={pendingSync}
              >
                Retry sync
              </Button>
            )}
          </div>
        )}

        <div className="rounded-lg border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] px-4 py-3 text-sm text-primary-wh40k">
          <p>
            <span className="font-medium">Records synced:</span>{' '}
            {progress.sync_records_synced}
          </p>
          <p>
            <span className="font-medium">Progress:</span>{' '}
            {progress.sync_progress}%
          </p>
          <p className="text-xs text-secondary-wh40k">
            Last sync: {lastSyncRelative ?? 'Not yet recorded'}
          </p>
          {syncMetaStatus && (
            <p className="text-xs text-secondary-wh40k">
              Sync status: {syncMetaStatus}
            </p>
          )}
        </div>

        {apiKeyRequired && onApiKeyChange && (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
              <KeyRound className="h-4 w-4" />
              Confirm your guild API key
            </div>
            <p className="text-xs text-amber-200/80">
              We ask Tacticus which guild this key belongs to and sync that
              guild — we never take the guild from your browser.
            </p>
            <Input
              id="syncApiKey"
              aria-label="Guild API key for sync"
              type="password"
              value={apiKeyValue}
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder="Paste your guild API key"
              className="min-h-[44px]"
            />
          </div>
        )}

        <Button
          className="w-full"
          onClick={onStartSync}
          loading={pendingSync}
          disabled={
            !guildComplete ||
            progress.sync_status === 'syncing' ||
            progress.sync_status === 'complete' ||
            progress.sync_status === 'not_required' ||
            (apiKeyRequired && apiKeyValue.trim().length === 0)
          }
        >
          {progress.sync_status === 'complete'
            ? 'Sync completed'
            : 'Start data sync'}
        </Button>

        {syncComplete && mode === 'existing_guild' && (
          <p className="text-xs text-secondary-wh40k">
            Your guild data is already synced. You can proceed to profile
            verification.
          </p>
        )}
        {!syncComplete && mode === 'existing_guild' && (
          <p className="text-xs text-amber-300">
            Your guild needs to complete its initial data sync before you can
            claim your profile. Click &quot;Start data sync&quot; above.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface ProfileClaimCardProps {
  progress: OnboardingProgress
  status: StatusDescriptor
  profileComplete: boolean
  guildComplete: boolean
  syncComplete: boolean
  guildAwaitingFirstClaim?: boolean | null
  seatClaimed?: boolean
  onSeatClaimed?: () => void
}

export function ProfileClaimCard({
  progress,
  status,
  profileComplete,
  guildComplete,
  syncComplete,
  guildAwaitingFirstClaim = false,
  seatClaimed = false,
  onSeatClaimed
}: ProfileClaimCardProps) {
  // The server flag flips false once the seat is bound, which would swap the success panel away.
  const showSeatBootstrap = guildAwaitingFirstClaim === true || seatClaimed
  const claimOptionsUnknown = guildAwaitingFirstClaim === null && !seatClaimed
  // Neither claim route works until the roster has synced.
  const rosterNotReady = guildComplete && !syncComplete

  return (
    <Card className="border-card-border/60 bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] backdrop-blur-xs">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <User className="h-5 w-5 text-(--accent)" />
            Step 3 - Claim your profile
          </CardTitle>
          <StatusLabel type={status.type} size="xs">
            {status.label}
          </StatusLabel>
        </div>
        <p className="text-sm text-secondary-wh40k">
          {showSeatBootstrap
            ? 'Link your own roster profile with a Player API key. No invite code is required for the first registrar.'
            : 'Use the single-use invite issued for your exact roster entry. Player IDs and display names are not ownership proof.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* A new guild's registrar has nobody to ask for an invite code. */}
        {!profileComplete && guildComplete && showSeatBootstrap && (
          <LeaderSeatClaim
            guildName={progress.guild_name}
            onClaimed={onSeatClaimed}
          />
        )}

        {!profileComplete && (
          <div className="space-y-3">
            <p className="text-xs text-secondary-wh40k">
              {claimOptionsUnknown
                ? 'Checking how you can claim your seat…'
                : showSeatBootstrap
                  ? 'Already have an invite code? Use it here instead.'
                  : rosterNotReady
                    ? // isGuildAwaitingFirstClaim() is false until the roster syncs.
                      'Finish Step 2 first — your roster is still syncing. Your claim options appear here once it completes.'
                    : 'Ask a guild officer or administrator for a fresh invite code, then consume it while signed in to this account.'}
            </p>
            <Link
              href="/onboarding/claim"
              className={cn(
                'inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors',
                guildComplete && syncComplete
                  ? 'bg-accent-wh40k text-(--bg-primary) hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)]'
                  : 'pointer-events-none bg-(--card-border) text-secondary-wh40k opacity-60'
              )}
              aria-disabled={!guildComplete || !syncComplete}
            >
              Enter invite code
            </Link>
          </div>
        )}

        {profileComplete && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-emerald-100">
                  Player linked: {progress.player_name || 'verified profile'}
                </p>
                <p className="text-emerald-200/80">
                  You now have full access to analytics as a{' '}
                  {showSeatBootstrap ? 'guild leader' : 'guild member'}.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/home"
                className="inline-flex items-center justify-center rounded-md bg-accent-wh40k px-3 py-2 text-sm font-medium text-(--bg-primary) hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] transition-colors"
              >
                Open dashboard
              </Link>
              <Link
                href="/profile"
                className="inline-flex items-center justify-center rounded-md border border-(--card-border) px-3 py-2 text-sm font-medium text-primary-wh40k hover:bg-[color-mix(in_srgb,var(--card-border)_20%,transparent)] transition-colors"
              >
                Manage profile
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

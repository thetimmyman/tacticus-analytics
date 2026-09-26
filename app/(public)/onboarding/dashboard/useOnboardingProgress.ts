'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  ClusterGuildSummary,
  ClusterSummary,
  GuildMode,
  OnboardingJob,
  OnboardingProgress
} from '@tacticus/app-core/onboarding.types'
import { useToast } from '@/app/hooks/useToast'
import type {
  OnboardingDashboardProps,
  PendingAction,
  SyncStatusMeta
} from './onboarding-dashboard-types'

type ProgressInputs = Pick<
  OnboardingDashboardProps,
  | 'initialProgress'
  | 'initialSyncStatus'
  | 'initialJob'
  | 'initialCluster'
  | 'initialClusterGuilds'
  | 'guildAwaitingFirstClaim'
>

export function useOnboardingProgress({
  initialProgress,
  initialSyncStatus,
  initialJob,
  initialCluster,
  initialClusterGuilds,
  guildAwaitingFirstClaim = false
}: ProgressInputs) {
  const { toast } = useToast()
  const [progress, setProgress] = useState<OnboardingProgress>(initialProgress)
  const [mode, setMode] = useState<GuildMode>(initialProgress.guild_mode)
  const [existingGuildCode, setExistingGuildCode] = useState(
    initialProgress.guild_code ?? ''
  )
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [syncMeta, setSyncMeta] = useState<SyncStatusMeta | null>(
    initialSyncStatus
  )
  const [job, setJob] = useState<OnboardingJob | null>(initialJob)
  const [cluster, setCluster] = useState<ClusterSummary | null>(initialCluster)
  const [clusterGuilds, setClusterGuilds] =
    useState<ClusterGuildSummary[]>(initialClusterGuilds)
  const [awaitingFirstClaim, setAwaitingFirstClaim] = useState<boolean | null>(
    guildAwaitingFirstClaim
  )
  const [seatClaimed, setSeatClaimed] = useState(false)

  useEffect(() => {
    setProgress(initialProgress)
    setMode(initialProgress.guild_mode)
    setExistingGuildCode(initialProgress.guild_code ?? '')
  }, [initialProgress])

  useEffect(() => setSyncMeta(initialSyncStatus), [initialSyncStatus])
  useEffect(() => setJob(initialJob), [initialJob])
  useEffect(() => {
    setCluster(initialCluster)
    setClusterGuilds(initialClusterGuilds)
  }, [initialCluster, initialClusterGuilds])

  // Changes only after a server refresh, so it cannot clobber a locally invalidated `null`.
  useEffect(() => {
    setAwaitingFirstClaim(guildAwaitingFirstClaim)
  }, [guildAwaitingFirstClaim])

  const refreshProgress = useCallback(
    async (showToast = false) => {
      setPendingAction('refresh')
      // Step 1 blanks this on guild change; a failed refresh must restore it.
      const lastKnownAwaitingFirstClaim = awaitingFirstClaim
      try {
        const response = await fetch('/api/onboarding/progress')
        if (!response.ok) {
          throw new Error('Unable to refresh onboarding state.')
        }
        const data = await response.json()
        if (data?.progress) {
          setProgress(data.progress)
          setMode(data.progress.guild_mode)
          setExistingGuildCode(data.progress.guild_code ?? '')
        }
        setSyncMeta(
          data?.syncStatus ? (data.syncStatus as SyncStatusMeta) : null
        )
        setJob(data?.job ? (data.job as OnboardingJob) : null)
        setCluster(data?.cluster ? (data.cluster as ClusterSummary) : null)
        setClusterGuilds(
          Array.isArray(data?.clusterGuilds)
            ? (data.clusterGuilds as ClusterGuildSummary[])
            : []
        )
        setAwaitingFirstClaim(
          typeof data?.guildAwaitingFirstClaim === 'boolean'
            ? data.guildAwaitingFirstClaim
            : null
        )
        if (showToast) {
          toast.success(
            'Progress updated',
            'Fetched the latest onboarding state.'
          )
        }
      } catch (error) {
        setAwaitingFirstClaim(lastKnownAwaitingFirstClaim)
        toast.error(
          'Refresh failed',
          (error as Error)?.message ?? 'Unable to refresh progress.'
        )
      } finally {
        setPendingAction(null)
      }
    },
    [awaitingFirstClaim, toast]
  )

  useEffect(() => {
    if (progress.sync_status !== 'syncing') return undefined
    const interval = window.setInterval(() => refreshProgress(false), 10000)
    return () => window.clearInterval(interval)
  }, [progress.sync_status, refreshProgress])

  return {
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
  }
}

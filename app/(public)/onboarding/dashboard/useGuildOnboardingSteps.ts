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
import type { PendingAction } from './onboarding-dashboard-types'
import { extractApiError } from './onboarding-dashboard-utils'

interface GuildOnboardingInputs {
  progress: OnboardingProgress
  setProgress: (progress: OnboardingProgress) => void
  mode: GuildMode
  setMode: (mode: GuildMode) => void
  existingGuildCode: string
  pendingAction: PendingAction
  setPendingAction: (action: PendingAction) => void
  setJob: (job: OnboardingJob | null) => void
  setCluster: (cluster: ClusterSummary | null) => void
  setClusterGuilds: (guilds: ClusterGuildSummary[]) => void
  setAwaitingFirstClaim: (value: boolean | null) => void
  refreshProgress: (showToast?: boolean) => Promise<void>
}

export function useGuildOnboardingSteps({
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
}: GuildOnboardingInputs) {
  const { toast } = useToast()
  const [newGuildCode, setNewGuildCode] = useState('')
  const [newGuildName, setNewGuildName] = useState('')
  const [newGuildApiKey, setNewGuildApiKey] = useState('')
  const [syncApiKey, setSyncApiKey] = useState('')
  const [syncApiKeyGuild, setSyncApiKeyGuild] = useState<string | null>(null)
  const [syncKeyRequired, setSyncKeyRequired] = useState(false)

  // Drop a carried key on guild change, tolerating the one-render gap before progress catches up.
  useEffect(() => {
    if (
      syncApiKeyGuild &&
      progress.guild_code &&
      syncApiKeyGuild !== progress.guild_code
    ) {
      setSyncApiKey('')
      setSyncApiKeyGuild(null)
    }
  }, [progress.guild_code, syncApiKeyGuild])

  const handleModeChange = useCallback(
    async (nextMode: GuildMode) => {
      if (pendingAction || mode === nextMode) return
      setPendingAction('mode')
      setMode(nextMode)
      // A carried key does not attest to the guild about to be selected.
      setSyncApiKey('')
      setSyncApiKeyGuild(null)
      try {
        const response = await fetch('/api/onboarding/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildMode: nextMode })
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(
            extractApiError(data, 'Failed to update onboarding mode')
          )
        }
        const data = await response.json()
        if (data?.progress) setProgress(data.progress)
        toast.success(
          'Mode updated',
          nextMode === 'new_guild'
            ? 'You will register a new guild as leader.'
            : 'You will join an existing guild.'
        )
      } catch (error) {
        toast.error(
          'Unable to switch mode',
          (error as Error)?.message ?? 'Please try again.'
        )
        setMode(progress.guild_mode)
      } finally {
        setPendingAction(null)
      }
    },
    [
      mode,
      pendingAction,
      progress.guild_mode,
      setMode,
      setPendingAction,
      setProgress,
      toast
    ]
  )

  const submitExistingGuild = useCallback(async () => {
    if (!existingGuildCode.trim()) {
      toast.error(
        'Missing guild code',
        'Enter the guild code you want to join.'
      )
      return
    }
    if (pendingAction) return
    if (mode !== 'existing_guild') await handleModeChange('existing_guild')

    setPendingAction('existing')
    try {
      const response = await fetch('/api/onboarding/guild/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildMode: 'existing_guild',
          guildCode: existingGuildCode.trim()
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractApiError(data, 'Unable to join guild.'))
      }
      if (data?.progress) setProgress(data.progress)
      // The server-rendered flag described the previous guild.
      setAwaitingFirstClaim(null)
      toast.success('Guild saved', 'Guild selection updated successfully.')
    } catch (error) {
      toast.error(
        'Guild selection failed',
        (error as Error)?.message ?? 'Please verify the guild code.'
      )
    } finally {
      setPendingAction(null)
      void refreshProgress()
    }
  }, [
    existingGuildCode,
    handleModeChange,
    mode,
    pendingAction,
    refreshProgress,
    setAwaitingFirstClaim,
    setPendingAction,
    setProgress,
    toast
  ])

  const submitNewGuild = useCallback(async () => {
    if (
      !newGuildCode.trim() ||
      !newGuildName.trim() ||
      !newGuildApiKey.trim()
    ) {
      toast.error(
        'Missing details',
        'Provide guild code, guild name, and API key.'
      )
      return
    }
    if (pendingAction) return
    if (mode !== 'new_guild') await handleModeChange('new_guild')

    setPendingAction('new')
    try {
      const response = await fetch('/api/onboarding/guild/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildMode: 'new_guild',
          guildCode: newGuildCode.trim(),
          guildName: newGuildName.trim(),
          apiKey: newGuildApiKey.trim()
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractApiError(data, 'Unable to register guild.'))
      }
      if (data?.progress) setProgress(data.progress)
      // Avoids flashing the officer dead-end while the claim state loads.
      setAwaitingFirstClaim(null)
      // Pinned to the committed guild so an adopted code cannot retarget the sync.
      setSyncApiKey(newGuildApiKey.trim())
      setSyncApiKeyGuild(
        typeof data?.progress?.guild_code === 'string'
          ? data.progress.guild_code
          : newGuildCode.trim()
      )
      setSyncKeyRequired(false)
      setNewGuildCode('')
      setNewGuildName('')
      setNewGuildApiKey('')
      toast.success(
        'Guild registered',
        'We saved your guild configuration. Continue with data sync.'
      )
    } catch (error) {
      toast.error(
        'Guild registration failed',
        (error as Error)?.message ?? 'Please verify your API key.'
      )
    } finally {
      setPendingAction(null)
      void refreshProgress()
    }
  }, [
    handleModeChange,
    mode,
    newGuildApiKey,
    newGuildCode,
    newGuildName,
    pendingAction,
    refreshProgress,
    setAwaitingFirstClaim,
    setPendingAction,
    setProgress,
    toast
  ])

  const handleSyncApiKeyChange = useCallback(
    (value: string) => {
      setSyncApiKey(value)
      setSyncApiKeyGuild(value ? (progress.guild_code ?? null) : null)
    },
    [progress.guild_code]
  )

  const startSync = useCallback(async () => {
    const guildComplete = progress.guild_status === 'complete'
    if (!guildComplete || progress.sync_status === 'syncing' || pendingAction) {
      return
    }
    const trimmedKey = syncApiKey.trim()
    const attestingKey =
      trimmedKey &&
      (syncApiKeyGuild === null || syncApiKeyGuild === progress.guild_code)
        ? trimmedKey
        : ''

    setPendingAction('sync')
    try {
      const response = await fetch('/api/onboarding/data-sync/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attestingKey ? { apiKey: attestingKey } : {})
      })
      const data = await response.json()
      if (!response.ok) {
        const code = (data as { error?: { code?: unknown } })?.error?.code
        if (response.status === 409 && code === 'GUILD_ATTESTATION_REQUIRED') {
          setSyncKeyRequired(true)
        }
        throw new Error(extractApiError(data, 'Sync failed. Please try again.'))
      }

      setSyncKeyRequired(false)
      // The server stored the credential; keeping it in memory only widens exposure.
      setSyncApiKey('')
      setSyncApiKeyGuild(null)
      if (data?.progress) setProgress(data.progress)
      if (data?.job) setJob(data.job as OnboardingJob)
      else if (response.status !== 200) setJob(null)
      if (data?.cluster) setCluster(data.cluster as ClusterSummary)
      if (Array.isArray(data?.clusterGuilds)) {
        setClusterGuilds(data.clusterGuilds as ClusterGuildSummary[])
      }
      const syncMessage =
        typeof data?.message === 'string'
          ? data.message
          : response.status === 202
            ? 'Sync job queued. It will run shortly.'
            : 'We are importing guild data. This may take a moment.'
      toast.success('Sync update', syncMessage)
    } catch (error) {
      toast.error(
        'Sync failed',
        (error as Error)?.message ?? 'Unable to start data sync.'
      )
    } finally {
      setPendingAction(null)
      void refreshProgress(true)
    }
  }, [
    pendingAction,
    progress.guild_code,
    progress.guild_status,
    progress.sync_status,
    refreshProgress,
    setCluster,
    setClusterGuilds,
    setJob,
    setPendingAction,
    setProgress,
    syncApiKey,
    syncApiKeyGuild,
    toast
  ])

  return {
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
  }
}

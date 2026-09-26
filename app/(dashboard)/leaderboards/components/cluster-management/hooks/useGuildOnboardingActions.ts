'use client'

import { useState } from 'react'

import { createComponentLogger } from '@/app/lib/logging/client'
import type { Guild } from '../types'

const logger = createComponentLogger(
  'leaderboards.cluster-management.useGuildOnboardingActions'
)

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

export interface ClaimGuildInfo {
  display_name: string | null
  cluster_code: string | null
  enabled: boolean
}

interface Options {
  clusterCode?: string
  clusterId: string | null
  fetchGuilds: () => Promise<void>
  toast: ToastApi
}

const emptyGuildDraft = (): Partial<Guild> => ({
  enabled: true,
  token_offender_threshold: 10,
  token_abuser_threshold: 15
})

async function readServerError(response: Response, fallback: string) {
  const raw = await response.text()
  try {
    const body = raw ? JSON.parse(raw) : null
    const message =
      (typeof body?.error === 'string' && body.error) ||
      body?.error?.message ||
      body?.message
    const details =
      (typeof body?.error === 'object' && body.error?.details) || body?.details
    return [message, details].filter(Boolean).join(' — ') || fallback
  } catch {
    return fallback
  }
}

export function useGuildOnboardingActions({
  clusterCode,
  clusterId,
  fetchGuilds,
  toast
}: Options) {
  const [addingGuild, setAddingGuild] = useState(false)
  const [newGuild, setNewGuild] = useState<Partial<Guild>>(emptyGuildDraft)
  const [addingGuildPending, setAddingGuildPending] = useState(false)
  const [claimMode, setClaimMode] = useState(false)
  const [claimGuildInfo, setClaimGuildInfo] = useState<ClaimGuildInfo | null>(
    null
  )
  const [checkingGuild, setCheckingGuild] = useState(false)

  const resetClaimMode = () => {
    setClaimMode(false)
    setClaimGuildInfo(null)
  }

  const resetDraft = () => {
    setAddingGuild(false)
    setNewGuild(emptyGuildDraft())
  }

  const checkGuildExists = async (guildCode: string) => {
    const trimmed = guildCode.trim().toUpperCase()
    if (!trimmed || trimmed.length < 2) {
      resetClaimMode()
      return
    }

    setCheckingGuild(true)
    try {
      const response = await fetch(
        `/api/guild/check-status?guild_code=${encodeURIComponent(trimmed)}`
      )
      if (!response.ok) {
        resetClaimMode()
        return
      }
      const result = await response.json()
      if (!result.exists) {
        resetClaimMode()
        return
      }

      const config = result.config as ClaimGuildInfo
      if (config.cluster_code === clusterCode) {
        toast.info('This guild is already in your cluster')
        resetClaimMode()
        return
      }
      setClaimMode(true)
      setClaimGuildInfo(config)
    } catch (error) {
      logger.error({ err: error }, 'Error checking guild existence:')
      resetClaimMode()
    } finally {
      setCheckingGuild(false)
    }
  }

  const handleClaimGuild = async () => {
    const guildCode = newGuild.guild_code?.trim().toUpperCase()
    const apiKey = newGuild.api_key?.trim()
    if (!guildCode) {
      toast.warning('Guild code is required')
      return
    }
    if (!apiKey) {
      toast.warning('An API key is required to claim this guild')
      return
    }

    setAddingGuildPending(true)
    try {
      const response = await fetch('/api/guild/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: guildCode,
          api_key: apiKey,
          cluster_code: clusterCode,
          api_key_owner: newGuild.API_Owner || null
        })
      })
      if (!response.ok) {
        toast.error(await readServerError(response, 'Failed to claim guild'))
        return
      }

      const result = await response.json()
      try {
        await fetch('/api/guild/initial-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: guildCode, api_key: apiKey })
        })
      } catch (error) {
        logger.warn({ err: error }, 'Initial sync after claim failed:')
      }

      toast.success(
        `Guild ${result.data?.display_name || guildCode} has been claimed into your cluster!`
      )
      await fetchGuilds()
      resetDraft()
      resetClaimMode()
    } catch (error) {
      logger.error({ err: error }, 'Error claiming guild:')
      toast.error(
        'An error occurred while claiming the guild. Please try again.'
      )
    } finally {
      setAddingGuildPending(false)
    }
  }

  const handleCreateGuild = async () => {
    const guildCode = newGuild.guild_code?.trim().toUpperCase()
    const displayName = newGuild.display_name?.trim()
    const apiKey = newGuild.api_key?.trim()
    if (!guildCode || !displayName) {
      toast.warning('Guild code and display name are required')
      return
    }
    if (!apiKey) {
      toast.warning('An API key is required for secure onboarding')
      return
    }

    setAddingGuildPending(true)
    try {
      const response = await fetch('/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: guildCode,
          display_name: displayName,
          api_key: apiKey,
          cluster_code: clusterCode || null,
          // create-config persists settings server-side; the browser never writes guild_config.
          api_owner: newGuild.API_Owner ?? null,
          gr_ranking: newGuild.GR_Ranking ?? null,
          gw_ranking: newGuild.GW_Ranking ?? null,
          token_offender_threshold: newGuild.token_offender_threshold ?? null,
          token_abuser_threshold: newGuild.token_abuser_threshold ?? null,
          enabled:
            typeof newGuild.enabled === 'boolean' ? newGuild.enabled : null
        })
      })
      if (!response.ok) {
        toast.error(await readServerError(response, 'Failed to add guild'))
        return
      }

      // A missing cluster_id means created but not linked: surface it, no false success.
      const createResult = await response.json().catch(() => null)
      const stampedClusterId = createResult?.data?.cluster_id ?? null
      if (
        clusterCode &&
        (!stampedClusterId || (clusterId && stampedClusterId !== clusterId))
      ) {
        logger.error(
          {
            guild_code: guildCode,
            cluster_code: clusterCode,
            expectedClusterId: clusterId,
            stampedClusterId
          },
          'Guild created without expected cluster membership'
        )
        toast.error(
          `Guild ${guildCode} was created but could not be linked to your cluster. Please refresh and verify before retrying.`
        )
        await fetchGuilds()
        return
      }

      try {
        const syncResponse = await fetch('/api/guild/initial-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: guildCode, api_key: apiKey })
        })
        if (!syncResponse.ok) {
          const syncBody = await syncResponse.json().catch(() => null)
          toast.warning(
            `Guild ${guildCode} was created, but initial sync failed: ${syncBody?.error || 'Unknown error'}`
          )
        }
      } catch (error) {
        logger.error({ err: error }, 'Error triggering initial sync')
        toast.warning(
          `Guild ${guildCode} was created, but we could not start the initial sync.`
        )
      }

      // No client guild_config write: cluster linkage is server-only (a client write fails 42501).
      toast.success(
        `Guild ${guildCode} has been successfully added to the cluster!`
      )
      await fetchGuilds()
      resetDraft()
    } catch (error) {
      logger.error({ err: error }, 'Error adding guild:')
      toast.error('An error occurred while adding the guild. Please try again.')
    } finally {
      setAddingGuildPending(false)
    }
  }

  const handleAddGuild = async () =>
    claimMode ? handleClaimGuild() : handleCreateGuild()

  return {
    addingGuild,
    setAddingGuild,
    newGuild,
    setNewGuild,
    addingGuildPending,
    claimMode,
    claimGuildInfo,
    checkingGuild,
    checkGuildExists,
    resetClaimMode,
    handleAddGuild
  }
}

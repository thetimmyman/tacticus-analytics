'use client'

import { useCallback, useState } from 'react'
import type {
  ClusterGuildSummary,
  ClusterSummary
} from '@tacticus/app-core/onboarding.types'
import { useToast } from '@/app/hooks/useToast'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import type { PendingAction } from './onboarding-dashboard-types'
import { extractApiError } from './onboarding-dashboard-utils'

interface ClusterOnboardingInputs {
  cluster: ClusterSummary | null
  clusterGuilds: ClusterGuildSummary[]
  pendingAction: PendingAction
  setPendingAction: (action: PendingAction) => void
  refreshProgress: (showToast?: boolean) => Promise<void>
}

export function useClusterOnboarding({
  cluster,
  clusterGuilds,
  pendingAction,
  setPendingAction,
  refreshProgress
}: ClusterOnboardingInputs) {
  const { toast } = useToast()
  const [clusterForm, setClusterForm] = useState({
    name: '',
    code: '',
    description: ''
  })
  const [clusterGuildForm, setClusterGuildForm] = useState({
    code: '',
    name: '',
    apiKey: ''
  })
  const [clusterRequeueTarget, setClusterRequeueTarget] = useState<
    string | null
  >(null)

  const getClusterGuildLabel = useCallback(
    (guildCode: string | null | undefined) => {
      const match = clusterGuilds.find(
        (guild) => guild.guild_code === guildCode
      )
      return formatGuildDisplayLabel(
        {
          display_name: match?.display_name,
          guild_tag: (match as { guild_tag?: string | null } | undefined)
            ?.guild_tag,
          guild_code: guildCode
        },
        guildCode
      )
    },
    [clusterGuilds]
  )

  const handleCreateCluster = useCallback(async () => {
    if (cluster) {
      toast.error(
        'Cluster already exists',
        'You already have an active cluster. Add guilds below instead.'
      )
      return
    }

    const name = clusterForm.name.trim()
    const code = clusterForm.code.trim().toUpperCase()
    if (!name || !code) {
      toast.error('Missing details', 'Provide a cluster name and code.')
      return
    }
    if (!/^[A-Z0-9]{2,10}$/.test(code)) {
      toast.error(
        'Invalid code',
        'Cluster code must be 2-10 letters or numbers.'
      )
      return
    }
    if (pendingAction) return

    setPendingAction('cluster_create')
    try {
      const response = await fetch('/api/clusters/create-cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cluster_code: code,
          display_name: name,
          description: clusterForm.description.trim() || null,
          primary_language: 'en',
          time_zone: 'UTC'
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractApiError(data, 'Unable to create cluster.'))
      }
      toast.success(
        'Cluster created',
        'Add your guilds to the cluster to begin syncing.'
      )
      setClusterForm({ name: '', code: '', description: '' })
      await refreshProgress(true)
    } catch (error) {
      toast.error(
        'Cluster creation failed',
        (error as Error)?.message ?? 'Unable to create cluster.'
      )
    } finally {
      setPendingAction(null)
    }
  }, [
    cluster,
    clusterForm,
    pendingAction,
    refreshProgress,
    setPendingAction,
    toast
  ])

  const handleAddClusterGuild = useCallback(async () => {
    if (!cluster) {
      toast.error('Cluster required', 'Create a cluster before adding guilds.')
      return
    }
    const code = clusterGuildForm.code.trim().toUpperCase()
    const name = clusterGuildForm.name.trim()
    const apiKey = clusterGuildForm.apiKey.trim()
    if (!code || !name || !apiKey) {
      toast.error(
        'Missing details',
        'Provide guild code, guild name, and API key.'
      )
      return
    }
    if (!/^[A-Z0-9]{2,7}$/.test(code)) {
      toast.error(
        'Invalid guild code',
        'Guild code must be 2-7 uppercase letters or numbers.'
      )
      return
    }
    if (clusterGuilds.some((guild) => guild.guild_code === code)) {
      toast.error(
        'Duplicate guild',
        'This guild is already linked to the cluster.'
      )
      return
    }
    if (pendingAction) return

    setPendingAction('cluster_guild')
    try {
      const response = await fetch('/api/onboarding/cluster/add-guild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterCode: cluster.cluster_code,
          guildCode: code,
          guildName: name,
          apiKey
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(
          extractApiError(data, 'Unable to add guild to cluster.')
        )
      }
      toast.success('Guild queued', `${name} has been queued for onboarding.`)
      setClusterGuildForm({ code: '', name: '', apiKey: '' })
      await refreshProgress(true)
    } catch (error) {
      toast.error(
        'Guild onboarding failed',
        (error as Error)?.message ?? 'Unable to add guild to cluster.'
      )
    } finally {
      setPendingAction(null)
    }
  }, [
    cluster,
    clusterGuildForm,
    clusterGuilds,
    pendingAction,
    refreshProgress,
    setPendingAction,
    toast
  ])

  const handleRequeueClusterGuild = useCallback(
    async (guildCode: string) => {
      if (!cluster) {
        toast.error(
          'Cluster required',
          'Create a cluster before retrying guild syncs.'
        )
        return
      }
      if (pendingAction) return

      setPendingAction('cluster_requeue')
      setClusterRequeueTarget(guildCode)
      try {
        const response = await fetch('/api/onboarding/cluster/requeue-guild', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusterCode: cluster.cluster_code,
            guildCode
          })
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(extractApiError(data, 'Unable to queue guild sync.'))
        }
        toast.success(
          'Sync queued',
          `${getClusterGuildLabel(guildCode)} is queued for a fresh sync.`
        )
        await refreshProgress(true)
      } catch (error) {
        toast.error(
          'Queueing failed',
          (error as Error)?.message ?? 'Unable to queue guild sync.'
        )
      } finally {
        setPendingAction(null)
        setClusterRequeueTarget(null)
      }
    },
    [
      cluster,
      getClusterGuildLabel,
      pendingAction,
      refreshProgress,
      setPendingAction,
      toast
    ]
  )

  return {
    clusterForm,
    setClusterForm,
    clusterGuildForm,
    setClusterGuildForm,
    clusterRequeueTarget,
    handleCreateCluster,
    handleAddClusterGuild,
    handleRequeueClusterGuild
  }
}

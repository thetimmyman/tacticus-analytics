import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/hooks/useToast'
import type {
  ClusterDetails,
  GuildSettingsRecord
} from '@/app/lib/services/guild-settings-service'

export interface LeaveClusterControls {
  open: boolean
  busy: boolean
  onOpen: () => void
  onCancel: () => void
  onConfirm: () => void
}

function errorMessageFrom(payload: unknown, fallback: string): string {
  const error = (payload as { error?: unknown } | null)?.error
  if (typeof error === 'string' && error) return error
  const nested = (error as { message?: unknown } | null)?.message
  return typeof nested === 'string' && nested ? nested : fallback
}

export function useGuildClusterSettings(config: GuildSettingsRecord) {
  const { toast } = useToast()
  const [clusterInfo, setClusterInfo] = useState<ClusterDetails | null>(null)
  const [loadingClusterInfo, setLoadingClusterInfo] = useState(false)
  const [showClusterWizard, setShowClusterWizard] = useState(false)
  const [showJoinCluster, setShowJoinCluster] = useState(false)
  const [showLeaveCluster, setShowLeaveCluster] = useState(false)
  const [leavingCluster, setLeavingCluster] = useState(false)
  const fetchedClusterCodes = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!config.cluster_code) return
    const clusterCode = config.cluster_code
    if (fetchedClusterCodes.current.has(clusterCode)) return
    let cancelled = false

    const fetchClusterInfo = async () => {
      setLoadingClusterInfo(true)
      try {
        const response = await fetch(
          `/api/cluster/info?code=${encodeURIComponent(clusterCode)}`
        )
        if (!response.ok) {
          const payload = await response
            .json()
            .catch(() => ({}) as { error?: unknown })
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : (payload?.error as { message?: string })?.message ||
                'Unable to load cluster information'
          throw new Error(message)
        }

        const data = await response.json()
        if (data?.success && !cancelled) {
          setClusterInfo(data.data)
          fetchedClusterCodes.current.add(clusterCode)
        } else if (!data?.success) {
          const message =
            typeof data?.error === 'string'
              ? data.error
              : (data?.error as { message?: string })?.message ||
                'Unable to load cluster information'
          toast.error('Cluster Error', message)
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to load cluster information'
          toast.error('Cluster Error', message)
        }
      } finally {
        if (!cancelled) setLoadingClusterInfo(false)
      }
    }

    void fetchClusterInfo()
    return () => {
      cancelled = true
    }
  }, [config.cluster_code, toast])

  const handleClusterCreated = useCallback(
    (created: Record<string, unknown>) => {
      setShowClusterWizard(false)
      const sanitized: ClusterDetails = {
        cluster_code:
          typeof created.cluster_code === 'string'
            ? created.cluster_code
            : config.cluster_code || config.guild_code,
        display_name:
          typeof created.display_name === 'string'
            ? created.display_name
            : config.display_name,
        description:
          typeof created.description === 'string' ? created.description : null
      }
      setClusterInfo(sanitized)
      toast.success(
        'Cluster created',
        `${sanitized.display_name} is ready for use.`
      )
      window.location.reload()
    },
    [config.cluster_code, config.display_name, config.guild_code, toast]
  )

  const confirmLeaveCluster = useCallback(async () => {
    const clusterCode = config.cluster_code
    if (!clusterCode || leavingCluster) return
    setLeavingCluster(true)
    try {
      const response = await fetch('/api/clusters/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterCode })
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        toast.error(
          'Could not leave the cluster',
          errorMessageFrom(payload, 'The cluster leave could not be completed.')
        )
        setLeavingCluster(false)
        return
      }
      setShowLeaveCluster(false)
      toast.success(
        'Left the cluster',
        'Your guild is independent now. Join another cluster with an invite code.'
      )
      window.location.reload()
    } catch {
      toast.error(
        'Could not leave the cluster',
        'The request did not reach the server. Check your connection and try again.'
      )
      setLeavingCluster(false)
    }
  }, [config.cluster_code, leavingCluster, toast])

  const leaveCluster: LeaveClusterControls = {
    open: showLeaveCluster,
    busy: leavingCluster,
    onOpen: () => setShowLeaveCluster(true),
    onCancel: () => {
      if (!leavingCluster) setShowLeaveCluster(false)
    },
    onConfirm: () => {
      void confirmLeaveCluster()
    }
  }

  return {
    clusterInfo,
    loadingClusterInfo,
    showClusterWizard,
    showJoinCluster,
    openClusterWizard: () => setShowClusterWizard(true),
    openJoinCluster: () => setShowJoinCluster(true),
    closeClusterWizard: () => setShowClusterWizard(false),
    closeJoinCluster: () => setShowJoinCluster(false),
    handleClusterCreated,
    leaveCluster
  }
}

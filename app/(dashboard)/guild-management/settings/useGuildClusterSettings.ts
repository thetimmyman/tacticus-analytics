import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/hooks/useToast'
import type {
  ClusterDetails,
  GuildSettingsRecord
} from '@/app/lib/services/guild-settings-service'

export function useGuildClusterSettings(config: GuildSettingsRecord) {
  const { toast } = useToast()
  const [clusterInfo, setClusterInfo] = useState<ClusterDetails | null>(null)
  const [loadingClusterInfo, setLoadingClusterInfo] = useState(false)
  const [showClusterWizard, setShowClusterWizard] = useState(false)
  const [showJoinCluster, setShowJoinCluster] = useState(false)
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

  return {
    clusterInfo,
    loadingClusterInfo,
    showClusterWizard,
    showJoinCluster,
    openClusterWizard: () => setShowClusterWizard(true),
    openJoinCluster: () => setShowJoinCluster(true),
    closeClusterWizard: () => setShowClusterWizard(false),
    closeJoinCluster: () => setShowJoinCluster(false),
    handleClusterCreated
  }
}

'use client'

import { useState } from 'react'

import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
import type { ClusterConfig } from '../types'
import { extractErrorMessage } from './useClusterData'

const logger = createComponentLogger(
  'leaderboards.cluster-management.useClusterConfigActions'
)

export function useClusterConfigActions(clusterCode?: string) {
  const supabase = dbClient()
  const [savingClusterConfig, setSavingClusterConfig] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const saveClusterConfig = async (config: ClusterConfig) => {
    if (!clusterCode) return
    setSavingClusterConfig(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const updatedAt = new Date().toISOString()
      const { data, error } = (await supabase
        .from('clusters')
        .update({ updated_at: updatedAt })
        .eq('cluster_code', clusterCode)
        .select()
        .single()) as { data: unknown; error: Error | null }
      if (error) throw error

      logger.info(
        {
          cluster_code: clusterCode,
          minimum_player_level: config.minimum_player_level,
          data
        },
        'Cluster configuration saved successfully'
      )
      setSuccessMessage('Configuration saved successfully!')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      logger.error({ err: error }, 'Error saving cluster config:')
      setErrorMessage(
        extractErrorMessage(error) || 'Failed to save configuration'
      )
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setSavingClusterConfig(false)
    }
  }

  return {
    savingClusterConfig,
    errorMessage,
    setErrorMessage,
    successMessage,
    setSuccessMessage,
    saveClusterConfig
  }
}

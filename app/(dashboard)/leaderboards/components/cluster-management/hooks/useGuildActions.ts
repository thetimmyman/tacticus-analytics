'use client'

import { useToast } from '@/app/hooks/useToast'
import type { Guild } from '../types'
import { useClusterConfigActions } from './useClusterConfigActions'
import { useGuildEditingActions } from './useGuildEditingActions'
import {
  useGuildOnboardingActions,
  type ClaimGuildInfo
} from './useGuildOnboardingActions'

export type { ClaimGuildInfo }

interface UseGuildActionsOptions {
  clusterCode?: string
  clusterId: string | null
  guilds: Guild[]
  currentUserDisplayName: string | null
  setGuilds: React.Dispatch<React.SetStateAction<Guild[]>>
  fetchGuilds: () => Promise<void>
}

export function useGuildActions({
  clusterCode,
  clusterId,
  guilds,
  currentUserDisplayName,
  setGuilds,
  fetchGuilds
}: UseGuildActionsOptions) {
  const { toast } = useToast()
  const editing = useGuildEditingActions({
    guilds,
    currentUserDisplayName,
    setGuilds,
    fetchGuilds,
    toast
  })
  const onboarding = useGuildOnboardingActions({
    clusterCode,
    clusterId,
    fetchGuilds,
    toast
  })
  const clusterConfig = useClusterConfigActions(clusterCode)

  return {
    ...editing,
    ...onboarding,
    ...clusterConfig
  }
}

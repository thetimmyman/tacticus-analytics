import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import {
  normalizePlayerTokenAllocations,
  normalizeTokenAllocationRecord
} from '@/app/lib/boss-assignments/target-ids'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.useAutoSave'
)
import {
  convertToPrimarySecondary,
  type PlayerTokenAllocation
} from '../utils/token-optimizer'
import type { AssignmentState, AssignmentActions } from './useAssignmentState'
import type { PlayerTokenAllocations } from '../types'

interface SaveAssignmentsParams {
  allocations?: PlayerTokenAllocations
  currentState: ReturnType<AssignmentActions['getLatestState']>
  guildCode: string
  seasonNumber: string
  primaryTokenValue: number
  secondaryTokenValue: number
  mode: 'current'
}

async function saveAssignments(params: SaveAssignmentsParams) {
  const {
    allocations,
    currentState,
    guildCode,
    seasonNumber,
    primaryTokenValue,
    secondaryTokenValue,
    mode
  } = params
  const supabase = dbClient()
  const normalizedEffectiveAllocations = normalizePlayerTokenAllocations(
    allocations || currentState.playerTokenAllocations
  )

  const bossData = Object.entries(currentState.selectedBosses)
    .filter(([, boss]) => boss !== '')
    .map(([level, boss_name]) => {
      const sub1 = currentState.selectedSubBosses[`${level}_Sub1`] || ''
      const sub2 = currentState.selectedSubBosses[`${level}_Sub2`] || ''
      const sub1Skipped = currentState.skippedPrimes[`${level}_Sub1`] || false
      const sub2Skipped = currentState.skippedPrimes[`${level}_Sub2`] || false

      return {
        guild_code: guildCode,
        season_number: seasonNumber,
        level,
        boss_name: boss_name.trim(),
        sub_bosses: {
          sub1: sub1.trim(),
          sub2: sub2.trim(),
          sub1_skip: sub1Skipped,
          sub2_skip: sub2Skipped
        }
      }
    })

  const playerAllocationsForSave: PlayerTokenAllocation[] = []
  const assignmentData = currentState.players.map((player) => {
    const playerTokens = normalizeTokenAllocationRecord(
      normalizedEffectiveAllocations[player.display_name] || {}
    )
    const totalTokens = Object.values(playerTokens).reduce(
      (sum, tokens) => sum + tokens,
      0
    )

    playerAllocationsForSave.push({
      player_id: player.player_id,
      display_name: player.display_name,
      allocations: playerTokens,
      totalTokensUsed: totalTokens
    })

    return {
      guild_code: guildCode,
      season_number: seasonNumber,
      player_id: player.player_id,
      display_name: player.display_name,
      primary_boss: null,
      secondary_boss: null,
      token_allocations: playerTokens,
      uses_flexible_tokens: true,
      total_tokens_allocated: totalTokens
    }
  })

  const effectiveAllocations = normalizedEffectiveAllocations
  const assignedCount = currentState.players.filter((p) => {
    const playerTokens = effectiveAllocations[p.display_name] || {}
    return Object.values(playerTokens).some((tokens) => tokens > 0)
  }).length
  const totalPlayers = currentState.players.length
  const totalTokens = Object.values(effectiveAllocations).reduce(
    (sum, playerTokens) => {
      return (
        sum +
        Object.values(playerTokens).reduce(
          (playerSum, tokens) => playerSum + tokens,
          0
        )
      )
    },
    0
  )

  let primarySecondaryPayload: Array<{
    player_id: string
    primary_boss: string | null
    secondary_boss: string | null
  }> = []

  if (mode === 'current') {
    const primarySecondaryAssignments = convertToPrimarySecondary(
      playerAllocationsForSave,
      primaryTokenValue,
      secondaryTokenValue
    )

    const resolveBossName = (bossKey: string | null) => {
      if (!bossKey) return null
      const match = bossKey.match(/^([ML][1-5])(_Sub[12])?$/)
      if (!match) return bossKey

      if (!match[2]) {
        const level = match[1]
        if (!level) return bossKey
        return currentState.selectedBosses[level] || bossKey
      }

      return currentState.selectedSubBosses[bossKey] || bossKey
    }

    primarySecondaryPayload = primarySecondaryAssignments.map((allocation) => ({
      player_id: allocation.player_id,
      primary_boss: resolveBossName(allocation.primary_boss),
      secondary_boss: resolveBossName(allocation.secondary_boss)
    }))
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'manage_season_assignments',
    {
      p_guild_code: guildCode,
      p_season_number: seasonNumber,
      p_mode: mode,
      p_bosses: bossData,
      p_assignments: assignmentData,
      p_primary_secondary: primarySecondaryPayload
    }
  )

  if (rpcError) {
    logger.error({ err: rpcError }, 'Error saving assignments:')
    throw new Error('Save failed')
  }

  const assignmentDataForStorage = {
    guild: guildCode,
    seasonNumber,
    selectedBosses: currentState.selectedBosses,
    selectedSubBosses: currentState.selectedSubBosses,
    skippedPrimes: currentState.skippedPrimes,
    playerAssignments: currentState.players.filter(
      (p) => p.primary_boss || p.secondary_boss
    ),
    lastSaved: new Date().toISOString()
  }
  localStorage.setItem(
    `upcoming_assignments_${guildCode}_${seasonNumber}`,
    JSON.stringify(assignmentDataForStorage)
  )

  const coerceNumber = (value: unknown, fallbackValue: number) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (
      typeof value === 'string' &&
      value.trim() !== '' &&
      Number.isFinite(Number(value))
    ) {
      return Number(value)
    }
    return fallbackValue
  }

  const rpcPayload =
    rpcData && typeof rpcData === 'object'
      ? (rpcData as Record<string, unknown>)
      : null

  return {
    assignedCount: coerceNumber(rpcPayload?.assignedCount, assignedCount),
    totalPlayers: coerceNumber(rpcPayload?.totalPlayers, totalPlayers),
    totalTokens: coerceNumber(rpcPayload?.totalTokens, totalTokens)
  }
}

interface ClearAssignmentsParams {
  guildCode: string
  seasonNumber: string
  availableLevels: string[]
}

async function clearAssignmentsApi(params: ClearAssignmentsParams) {
  const { guildCode, seasonNumber } = params
  const supabase = dbClient()

  const { error } = await supabase.rpc('clear_season_assignments', {
    p_guild_code: guildCode,
    p_season_number: seasonNumber
  })

  if (error) {
    logger.error({ err: error }, 'Error clearing assignments:')
    throw new Error('Failed to clear assignments')
  }

  localStorage.removeItem(`upcoming_assignments_${guildCode}_${seasonNumber}`)
  localStorage.removeItem(`upcoming_assignments_${guildCode}`)
}

export function useAutoSave(
  _state: AssignmentState,
  actions: AssignmentActions,
  guildCode: string,
  _clusterCode: string | undefined,
  computeTargetSeason: () => string,
  primaryTokenValue: number,
  secondaryTokenValue: number,
  mode: 'current',
  // AUTH-CRITICAL: when false, autoSave/clearAssignments no-op so no member session writes
  // assignments even if a caller fires; hiding controls is the other layer.
  canEdit: boolean
) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: saveAssignments,
    onMutate: () => {
      actions.setSaving(true)
    },
    onSuccess: (result) => {
      actions.setSaveMessage(
        `Saved! ${result.assignedCount}/${result.totalPlayers} players assigned (${result.totalTokens} tokens)`
      )
      const seasonNumber = computeTargetSeason()
      queryClient.invalidateQueries({
        queryKey: ['player-assignments', guildCode, seasonNumber, mode]
      })
      queryClient.invalidateQueries({
        queryKey: ['upcoming-assignments', guildCode]
      })
      setTimeout(() => actions.setSaveMessage(''), 3000)
    },
    onError: (error) => {
      logger.error({ err: error }, 'Error saving assignments:')
      actions.setSaveMessage(
        error instanceof Error && error.message === 'Save partially failed'
          ? 'Save partially failed'
          : 'Save failed - check console'
      )
      setTimeout(() => actions.setSaveMessage(''), 3000)
    },
    onSettled: () => {
      actions.setSaving(false)
    }
  })

  const clearMutation = useMutation({
    mutationFn: clearAssignmentsApi,
    onMutate: () => {
      actions.setClearing(true)
    },
    onSuccess: () => {
      const currentState = actions.getLatestState()
      const resetBosses: Record<string, string> = {}
      const resetSubBosses: Record<string, string> = {}
      actions.setPlayerTokenAllocations({})
      currentState.availableLevels.forEach((level) => {
        resetBosses[level] = ''
        resetSubBosses[`${level}_Sub1`] = ''
        resetSubBosses[`${level}_Sub2`] = ''
      })
      actions.setSelectedBosses(resetBosses)
      actions.setSelectedSubBosses(resetSubBosses)
      actions.setPlayers((prev) =>
        prev.map((player) => ({
          ...player,
          primary_boss: null,
          secondary_boss: null
        }))
      )
      actions.setSaveMessage('All assignments cleared')
      actions.setShowClearConfirm(false)
      const seasonNumber = computeTargetSeason()
      queryClient.invalidateQueries({
        queryKey: ['player-assignments', guildCode, seasonNumber, mode]
      })
      queryClient.invalidateQueries({
        queryKey: ['upcoming-assignments', guildCode]
      })
      setTimeout(() => actions.setSaveMessage(''), 3000)
    },
    onError: (error) => {
      logger.error({ err: error }, 'Error clearing assignments:')
      actions.setSaveMessage('Failed to clear assignments')
      setTimeout(() => actions.setSaveMessage(''), 3000)
    },
    onSettled: () => {
      actions.setClearing(false)
    }
  })

  const autoSave = useCallback(
    async (allocations?: PlayerTokenAllocations) => {
      // AUTH-CRITICAL read-only gate — members never write assignments.
      if (!canEdit) return
      const currentState = actions.getLatestState()
      const seasonNumber = computeTargetSeason()
      saveMutation.mutate({
        allocations,
        currentState,
        guildCode,
        seasonNumber,
        primaryTokenValue,
        secondaryTokenValue,
        mode
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      actions,
      guildCode,
      computeTargetSeason,
      primaryTokenValue,
      secondaryTokenValue,
      mode,
      canEdit
    ]
  )

  const clearAssignments = useCallback(async () => {
    // AUTH-CRITICAL read-only gate — members never clear assignments.
    if (!canEdit) return
    const targetSeason = computeTargetSeason()
    const currentState = actions.getLatestState()
    clearMutation.mutate({
      guildCode,
      seasonNumber: targetSeason,
      availableLevels: currentState.availableLevels
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, guildCode, computeTargetSeason, canEdit])

  return { autoSave, clearAssignments }
}

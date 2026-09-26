'use client'

import { useBaseQuery } from '@/app/lib/hooks/shared'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.useCurrentBossAttacks'
)
import { deriveRarityAndSetFromStageCode } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import type { EOTGRData } from '@tacticus/app-core/types'

export type BossAttackRow = Pick<
  EOTGRData,
  | 'id'
  | 'userId'
  | 'displayName'
  | 'encounterId'
  | 'damageDealt'
  | 'startedOn'
  | 'completedOn'
  | 'timestamp'
>

async function fetchCurrentBossAttacks(args: {
  guildCode: string
  seasonNumber: string
  stageCode: string
  loopIndex: number
}): Promise<BossAttackRow[]> {
  const supabase = dbClient()
  const stageIdentity = deriveRarityAndSetFromStageCode(args.stageCode)
  if (!stageIdentity) {
    return []
  }

  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select(
      'id, userId, displayName, encounterId, damageDealt, startedOn, completedOn, timestamp'
    )
    .eq('Guild', args.guildCode)
    .eq('Season', args.seasonNumber)
    .eq('damageType', 'Battle')
    .in('encounterId', [0, 1, 2])
    .eq('rarity', stageIdentity.rarity)
    .eq('set', stageIdentity.set)
    .eq('loopIndex', args.loopIndex)
    .order('id', { ascending: true })
    .limit(500)

  if (error) {
    logger.warn(
      { error: error.message },
      'Failed to fetch current boss attacks'
    )
    return []
  }

  return data ?? []
}

export function useCurrentBossAttacks(args: {
  guildCode: string
  seasonNumber: string
  stageCode: string
  loopIndex: number
  enabled: boolean
}) {
  return useBaseQuery({
    queryKey: [
      'boss-assignments-current-boss-attacks',
      args.guildCode,
      args.seasonNumber,
      args.stageCode,
      args.loopIndex
    ],
    queryFn: () =>
      fetchCurrentBossAttacks({
        guildCode: args.guildCode,
        seasonNumber: args.seasonNumber,
        stageCode: args.stageCode,
        loopIndex: args.loopIndex
      }),
    enabled: args.enabled,
    cacheDuration: 15 * 1000,
    refetchInterval: 30 * 1000
  })
}

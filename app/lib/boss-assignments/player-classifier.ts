import type { DamageModel } from '@/app/lib/boss-assignments/season-planner/damage-model'
import { estimateDamage } from '@/app/lib/boss-assignments/season-planner/damage-model'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

export type PlayerTier = 'strong' | 'mid' | 'developing'

export interface ClassifiedPlayer {
  playerId: string
  displayName: string
  tier: PlayerTier
  overallAvgDamage: number
  avgDamageByStage: Record<string, number>
}

export interface PlayerInfo {
  playerId: string
  displayName: string
}

/** Strong = top 25% expected damage, Mid = middle 50%, Developing = the rest or no data. */
export function classifyPlayers(args: {
  players: PlayerInfo[]
  damageModel: DamageModel
  bossSequence: BossStageEntry[]
}): ClassifiedPlayer[] {
  const { players, damageModel, bossSequence } = args

  const classified = players.map((player) => {
    const avgDamageByStage: Record<string, number> = {}
    let totalDamage = 0
    let stageCount = 0

    for (const stage of bossSequence) {
      const estimate = estimateDamage(damageModel, {
        playerId: player.playerId,
        bossName: stage.encounters.main.bossName,
        stageCode: stage.stageCode,
        encounterId: 0
      })

      if (estimate.expectedDamage != null && estimate.expectedDamage > 0) {
        avgDamageByStage[stage.stageCode] = estimate.expectedDamage
        totalDamage += estimate.expectedDamage
        stageCount += 1
      }
    }

    const overallAvgDamage = stageCount > 0 ? totalDamage / stageCount : 0

    return {
      playerId: player.playerId,
      displayName: player.displayName,
      tier: 'mid' as PlayerTier,
      overallAvgDamage,
      avgDamageByStage
    }
  })

  const sorted = [...classified].sort(
    (a, b) => b.overallAvgDamage - a.overallAvgDamage
  )
  const total = sorted.length

  if (total === 0) return classified

  const strongCutoff = Math.max(1, Math.floor(total * 0.25))
  const developingCutoff = Math.max(strongCutoff + 1, Math.ceil(total * 0.75))

  for (const [i, player] of sorted.entries()) {
    if (player.overallAvgDamage === 0) {
      player.tier = 'developing'
    } else if (i < strongCutoff) {
      player.tier = 'strong'
    } else if (i >= developingCutoff) {
      player.tier = 'developing'
    } else {
      player.tier = 'mid'
    }
  }

  const tierMap = new Map(sorted.map((p) => [p.playerId, p.tier]))
  for (const player of classified) {
    player.tier = tierMap.get(player.playerId) ?? 'mid'
  }

  return classified
}

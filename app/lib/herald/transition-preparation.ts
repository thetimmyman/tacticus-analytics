import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
import type {
  AvailabilityTransition,
  DefeatTransition,
  HeraldBattle,
  HeraldPingMode
} from './contracts'
import {
  deriveDeadPrimeCandidates,
  detectAvailabilityTransitions,
  detectDefeatTransitions
} from './detect'
import {
  loadAvailabilitySnapshot,
  loadKillThresholdsForSeasons,
  loadPingModesForSeasons,
  loadSkippedPrimesForSeasons
} from './season-state'
import {
  predictAvailabilityFromDefeats,
  predictMainAvailableAfterPrimesCleared
} from './predict'

const logger = createComponentLogger('herald')

interface PrepareHeraldTransitionsParams {
  supabase: SupabaseClient
  guildCode: string
  battles: HeraldBattle[]
  allBattles?: HeraldBattle[]
  nowMs?: number
  invocationId: string
  onDefeatsDetected?: (count: number) => void
}

export interface PreparedHeraldTransitions {
  killThresholdMap: Map<string, number>
  pingModesPerSeason: Map<string, HeraldPingMode>
  defeatTransitions: DefeatTransition[]
  availabilityTransitions: AvailabilityTransition[]
  skippedPrimesForPredict: Map<string, Set<string>>
}

const availabilityKey = (transition: AvailabilityTransition): string =>
  `${transition.season}|${transition.boss_id}|${transition.loop_index}|${transition.rarity}|${transition.set ?? 'null'}`

export async function prepareHeraldTransitions({
  supabase,
  guildCode,
  battles,
  allBattles,
  nowMs,
  invocationId,
  onDefeatsDetected
}: PrepareHeraldTransitionsParams): Promise<PreparedHeraldTransitions> {
  // Seasons come from the full battle stream so below-threshold (HP > 0) rows are covered too.
  const detectorBattles =
    allBattles && allBattles.length > 0 ? allBattles : battles
  const detectorSeasons = new Set<string>()
  for (const battle of detectorBattles) {
    if (battle.Season !== null && battle.Season !== undefined) {
      detectorSeasons.add(String(battle.Season))
    }
  }

  const seasons = [...detectorSeasons]
  const killThresholdMap =
    seasons.length > 0
      ? await loadKillThresholdsForSeasons(supabase, guildCode, seasons)
      : new Map<string, number>()
  const pingModesPerSeason =
    seasons.length > 0
      ? await loadPingModesForSeasons(supabase, guildCode, seasons)
      : new Map<string, HeraldPingMode>()
  const defeatTransitions = detectDefeatTransitions(detectorBattles, {
    nowMs,
    killThresholdMap
  })
  onDefeatsDetected?.(defeatTransitions.length)

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      detected: defeatTransitions.length,
      kill_threshold_overrides: killThresholdMap.size
    },
    'herald.detect'
  )

  const snapshot =
    (allBattles && allBattles.length > 0) || defeatTransitions.length > 0
      ? await loadAvailabilitySnapshot(supabase, guildCode)
      : new Set<string>()
  let availabilityTransitions =
    allBattles && allBattles.length > 0
      ? detectAvailabilityTransitions(allBattles, snapshot)
      : []

  const predictorSeasons = new Set<string>()
  for (const transition of defeatTransitions) {
    if (transition.season !== null) {
      predictorSeasons.add(String(transition.season))
    }
  }
  for (const transition of availabilityTransitions) {
    predictorSeasons.add(String(transition.season))
  }
  for (const battle of allBattles ?? []) {
    if (battle.Season !== null && battle.Season !== undefined) {
      predictorSeasons.add(String(battle.Season))
    }
  }

  const skippedPrimesForPredict =
    predictorSeasons.size > 0
      ? await loadSkippedPrimesForSeasons(supabase, guildCode, [
          ...predictorSeasons
        ])
      : new Map<string, Set<string>>()
  const existingKeys = new Set(availabilityTransitions.map(availabilityKey))
  const mergePredicted = (predicted: AvailabilityTransition[]) => {
    for (const transition of predicted) {
      const key = availabilityKey(transition)
      if (snapshot.has(key) || existingKeys.has(key)) continue
      availabilityTransitions.push(transition)
      existingKeys.add(key)
    }
  }

  // Predictor (a): a fresh main defeat unlocks the stage's primes (or the main if both are skipped).
  if (defeatTransitions.length > 0) {
    try {
      const predicted = await predictAvailabilityFromDefeats(
        guildCode,
        defeatTransitions,
        skippedPrimesForPredict
      )
      mergePredicted(predicted)
      if (predicted.length > 0) {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            stage_unlock_predicted: predicted.length,
            merged_total: availabilityTransitions.length
          },
          'herald.available.predict.stage_unlock'
        )
      }
    } catch (error) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          error: error instanceof Error ? error.message : String(error)
        },
        'herald.available.predict.stage_unlock.exception'
      )
    }
  }

  // Predictor (b): primes cleared -> main. Falls back to allBattles so a delayed
  // sync still announces the main; the predictor's remainingHp=0 query gates it.
  const primeCandidates =
    defeatTransitions.length > 0
      ? defeatTransitions
      : allBattles && allBattles.length > 0
        ? deriveDeadPrimeCandidates(allBattles)
        : []
  if (primeCandidates.length > 0) {
    try {
      const predicted = await predictMainAvailableAfterPrimesCleared(
        guildCode,
        primeCandidates,
        skippedPrimesForPredict,
        supabase
      )
      mergePredicted(predicted)
      if (predicted.length > 0) {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            primes_cleared_predicted: predicted.length,
            source:
              defeatTransitions.length > 0
                ? 'defeat_transitions'
                : 'allBattles_fallback',
            merged_total: availabilityTransitions.length
          },
          'herald.available.predict.primes_cleared'
        )
      }
    } catch (error) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          error: error instanceof Error ? error.message : String(error)
        },
        'herald.available.predict.primes_cleared.exception'
      )
    }
  }

  if (allBattles && allBattles.length > 0) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        detected: availabilityTransitions.length
      },
      'herald.available.detect'
    )
  }

  return {
    killThresholdMap,
    pingModesPerSeason,
    defeatTransitions,
    availabilityTransitions,
    skippedPrimesForPredict
  }
}

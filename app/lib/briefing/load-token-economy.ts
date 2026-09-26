/** Reuses the solver pipeline so ETAs match the app. */

import { serviceDb } from '@/app/lib/db'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import { computeRemainingBossSequence } from '@/app/lib/boss-assignments/season-sequence'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { buildPlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot'
import {
  getSeasonPosition,
  SEASON_ROTATION
} from '@/app/lib/loki/season-configs'
import {
  loadStageKillDurationMedians,
  projectStageStartSeconds
} from '@/app/lib/boss-assignments/stage-timing'
import { buildUpcomingMains } from '@/app/lib/briefing/upcoming-mains'
import { createComponentLogger } from '@/app/lib/logging'
import type { UpcomingMain } from '@/app/lib/briefing/build-next-move-economy'

const logger = createComponentLogger('briefing.token-economy')

export interface TokenEconomySignals {
  upcomingMains: UpcomingMain[]
  paceFromHistory: boolean
}

const EMPTY: TokenEconomySignals = { upcomingMains: [], paceFromHistory: false }

const MAX_STAGES = 12

interface LoadArgs {
  guildCode: string | undefined
  season: string
}

async function load(args: LoadArgs): Promise<TokenEconomySignals> {
  if (!args.guildCode) return EMPTY
  const guildCode = args.guildCode
  const seasonNum = Number.parseInt(args.season, 10)
  if (!Number.isFinite(seasonNum)) return EMPTY

  const [progressionConfig, rotationSnapshot, bossHpData] = await Promise.all([
    getActiveProgressionConfig(guildCode, seasonNum),
    ensureRotationSnapshot().catch(() => null),
    getAllBossHp(guildCode)
  ])
  if (!rotationSnapshot) return EMPTY

  const supabase = serviceDb()
  const seasonId = SEASON_ROTATION[getSeasonPosition().index] ?? null
  const snapshot = await buildPlanFromNowSnapshot({
    supabase,
    guildCode,
    season: args.season,
    seasonId,
    snapshotAt: new Date().toISOString(),
    rotationSnapshot,
    bossHpData,
    progressionConfig
  })

  // Main-only and stage-based, so skippedPrimes and guildAvgDamage are not needed.
  const sequence = computeRemainingBossSequence({
    progressionConfig,
    currentStageCode: snapshot.stageCode,
    currentLoopIndex: snapshot.loopIndex,
    seasonBosses: rotationSnapshot.currentBosses ?? [],
    bossHpData,
    guildAvgDamage: 0,
    currentStageHp: {
      mainRemainingHp: snapshot.encounters.main.remainingHp,
      prime1RemainingHp: snapshot.encounters.prime1.remainingHp,
      prime2RemainingHp: snapshot.encounters.prime2.remainingHp
    },
    maxStages: MAX_STAGES
  })
  if (sequence.length <= 1) return EMPTY

  const medians = await loadStageKillDurationMedians(
    supabase,
    guildCode,
    seasonNum
  ).catch((err) => {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'token-economy: kill-duration medians unavailable; using fallback pace'
    )
    return new Map()
  })

  const projections = projectStageStartSeconds(sequence, medians)

  const displayByType = new Map<string, string>()
  for (const b of rotationSnapshot.currentBosses ?? []) {
    if (b.boss_type && b.boss_name) displayByType.set(b.boss_type, b.boss_name)
  }

  const curMain = sequence[0]!.encounters.main
  const remainingFrac =
    curMain.maxHp > 0 ? curMain.remainingHp / curMain.maxHp : 1

  const upcomingMains = buildUpcomingMains(
    sequence,
    projections,
    remainingFrac,
    displayByType
  )

  return {
    upcomingMains,
    paceFromHistory: projections.some(
      (p) =>
        p.inboundDurationSource != null &&
        p.inboundDurationSource !== 'fallback'
    )
  }
}

export async function loadTokenEconomyWithTimeout(
  args: LoadArgs,
  timeoutMs = 3500
): Promise<TokenEconomySignals> {
  const timeout = new Promise<TokenEconomySignals>((resolve) =>
    setTimeout(() => resolve(EMPTY), timeoutMs)
  )
  return Promise.race([
    load(args).catch((err) => {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'token-economy load failed'
      )
      return EMPTY
    }),
    timeout
  ])
}

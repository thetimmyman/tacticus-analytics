import 'server-only'

import { getAllBossHp } from '@/app/lib/data/boss-hp'
import type { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import {
  FIRST_SEASON_START_MS,
  GLOBAL_CONFIG,
  SEASON_DURATION_SECONDS,
  SEASON_NUMBER_OFFSET,
  getSeasonConfigForSeasonNumber
} from '@/app/lib/loki/season-configs'
import { buildPlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot'
import { resolvePlanningRotation } from '@/app/lib/boss-assignments/season-planner/planning-rotation'
import { computeSeasonWindowMs } from '@/app/lib/boss-assignments/season-planner/season-window'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import { computeRemainingBossSequence } from '@/app/lib/boss-assignments/season-sequence'
import { loadSkippedPrimesForSeason } from '@/app/lib/boss-assignments/resolve-skipped-primes'
import {
  buildDamageModel,
  estimateDamage,
  type DamageModel,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import type { StageTemplate } from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type {
  ProjectionContext,
  RosterStrategyGuild,
  RosterStrategySeasonSpec,
  StrategyBattleRow,
  SupabaseService
} from './types'

const makeDamageRecords = (rows: StrategyBattleRow[]): DamageRecord[] =>
  rows
    .filter(
      (row) =>
        row.damageType === 'Battle' &&
        typeof row.damageDealt === 'number' &&
        row.damageDealt > 0
    )
    .map((row) => ({
      playerId: row.userId,
      bossName: row.Name ?? 'UnknownBoss',
      encounterId: row.encounterId ?? 0,
      rarity: row.rarity ?? null,
      set: row.set ?? null,
      startedOn: row.startedOn,
      damageDealt: row.damageDealt ?? 0
    }))

export const estimatePersonalDamage = (
  model: DamageModel,
  args: Parameters<typeof estimateDamage>[1]
) => {
  const est = estimateDamage(model, args)
  return est.source === 'player_target' ? est : null
}

export const filterBattleRowsForProjection = (
  rows: StrategyBattleRow[],
  args: { season: string; seasonStartMs: number; snapshotMs: number }
): StrategyBattleRow[] =>
  rows.filter((row) => {
    const rowSeason = String(row.Season)
    const startedMs = new Date(row.startedOn).getTime()
    return (
      rowSeason === args.season &&
      Number.isFinite(startedMs) &&
      startedMs >= args.seasonStartMs &&
      startedMs <= args.snapshotMs
    )
  })

export const filterSignalRowsForProjection = (
  rows: StrategyBattleRow[],
  referenceMs: number
): StrategyBattleRow[] =>
  rows.filter((row) => {
    const startedMs = new Date(row.startedOn).getTime()
    return Number.isFinite(startedMs) && startedMs <= referenceMs
  })

export const filterTokenRowsForProjection = (
  rows: StrategyBattleRow[],
  args: { season: string; seasonStartMs: number; snapshotMs: number }
): StrategyBattleRow[] =>
  rows.filter((row) => {
    const rowSeason = String(row.Season)
    const startedMs = new Date(row.startedOn).getTime()
    return (
      rowSeason === args.season &&
      Number.isFinite(startedMs) &&
      startedMs >= args.seasonStartMs &&
      startedMs <= args.snapshotMs
    )
  })

export const resolveSignalReferenceMs = (
  requestedSnapshotMs: number,
  nowMs = Date.now()
): number =>
  Number.isFinite(requestedSnapshotMs)
    ? Math.min(requestedSnapshotMs, nowMs)
    : nowMs

export const buildProjectionContext = async (args: {
  service: SupabaseService
  guild: RosterStrategyGuild
  seasonSpec: RosterStrategySeasonSpec
  snapshotAt: string
  battleRows: StrategyBattleRow[]
  signalRows: StrategyBattleRow[]
  lookbackDays: number
  liveRotation: Awaited<ReturnType<typeof ensureRotationSnapshot>>
}): Promise<ProjectionContext> => {
  const seasonNumber = Number.parseInt(args.seasonSpec.season, 10)
  const misc = GLOBAL_CONFIG?.guildBoss?.misc ?? {}
  const bufferAfterSeasonEnd =
    typeof misc.bufferAfterSeasonEnd === 'number'
      ? misc.bufferAfterSeasonEnd
      : 86_400
  const { seasonStartMs, seasonEndMs } = computeSeasonWindowMs(seasonNumber, {
    firstSeasonStartMs: FIRST_SEASON_START_MS,
    seasonDurationSeconds: SEASON_DURATION_SECONDS,
    bufferAfterSeasonEndSeconds: bufferAfterSeasonEnd,
    seasonNumberOffset: SEASON_NUMBER_OFFSET
  })
  const requestedSnapshotMs = new Date(args.snapshotAt).getTime()
  const boundedSeasonEndMs = Math.max(seasonStartMs, seasonEndMs - 1)
  const effectiveSnapshotMs = Math.min(
    Math.max(
      Number.isFinite(requestedSnapshotMs) ? requestedSnapshotMs : Date.now(),
      seasonStartMs
    ),
    boundedSeasonEndMs
  )
  const effectiveSnapshotAt = new Date(effectiveSnapshotMs).toISOString()
  const signalReferenceMs = resolveSignalReferenceMs(requestedSnapshotMs)

  // Shared by the before/after projections so both use the same skips.
  const [bossHpData, progressionConfig, skippedPrimes] = await Promise.all([
    getAllBossHp(args.guild.guildCode),
    getActiveProgressionConfig(args.guild.guildCode, seasonNumber),
    loadSkippedPrimesForSeason(
      args.service,
      args.guild.guildCode,
      args.seasonSpec.season
    )
  ])
  const { rotation, seasonId } = resolvePlanningRotation({
    configId: args.seasonSpec.configId,
    seasonConfig: getSeasonConfigForSeasonNumber(seasonNumber),
    liveRotation: args.liveRotation
  })

  const snapshot = await buildPlanFromNowSnapshot({
    supabase: args.service,
    guildCode: args.guild.guildCode,
    season: args.seasonSpec.season,
    seasonId,
    snapshotAt: effectiveSnapshotAt,
    bossHpData,
    rotationSnapshot: rotation,
    preferAsOfStatus: true,
    progressionConfig
  })

  const scopedRows = filterBattleRowsForProjection(args.battleRows, {
    season: args.seasonSpec.season,
    seasonStartMs,
    snapshotMs: effectiveSnapshotMs
  })
  const scopedSignalRows = filterSignalRowsForProjection(
    args.signalRows,
    signalReferenceMs
  )
  const tokenRows = filterTokenRowsForProjection(args.battleRows, {
    season: args.seasonSpec.season,
    seasonStartMs,
    snapshotMs: effectiveSnapshotMs
  })
  const damageRecords = makeDamageRecords(scopedSignalRows)
  const damageModel = buildDamageModel(damageRecords, {
    referenceAt: new Date(signalReferenceMs).toISOString()
  })
  const guildAvgTokenDamage =
    damageRecords.length > 0
      ? damageRecords.reduce((sum, record) => sum + record.damageDealt, 0) /
        damageRecords.length
      : 0

  const remainingBossSequence = computeRemainingBossSequence({
    progressionConfig,
    currentStageCode: snapshot.stageCode,
    currentLoopIndex: snapshot.loopIndex,
    seasonBosses: rotation?.currentBosses ?? [],
    bossHpData,
    guildAvgDamage: guildAvgTokenDamage,
    currentStageHp: {
      mainRemainingHp: snapshot.encounters.main.remainingHp,
      prime1RemainingHp: snapshot.encounters.prime1.remainingHp,
      prime2RemainingHp: snapshot.encounters.prime2.remainingHp
    },
    skippedPrimes
  })

  const stageTemplates: StageTemplate[] = remainingBossSequence.map(
    (entry) => ({
      stageCode: entry.stageCode,
      encounters: {
        0: {
          bossName: entry.encounters.main.bossName,
          maxHp: entry.encounters.main.maxHp
        },
        1: {
          bossName:
            entry.encounters.prime1?.bossName ??
            `${entry.encounters.main.bossName}_Prime1`,
          maxHp: entry.encounters.prime1?.maxHp ?? 0
        },
        2: {
          bossName:
            entry.encounters.prime2?.bossName ??
            `${entry.encounters.main.bossName}_Prime2`,
          maxHp: entry.encounters.prime2?.maxHp ?? 0
        }
      }
    })
  )

  return {
    guildCode: args.guild.guildCode,
    season: args.seasonSpec.season,
    seasonId,
    seasonStartMs,
    seasonEndMs,
    seasonStartAt: new Date(seasonStartMs).toISOString(),
    seasonEndAt: new Date(seasonEndMs).toISOString(),
    snapshotAt: effectiveSnapshotAt,
    timeZone: args.guild.timeZone || 'UTC',
    snapshot,
    seasonBosses: rotation?.currentBosses ?? [],
    remainingBossSequence,
    stageTemplates,
    // The current stage comes from the snapshot, so zero skipped primes here too.
    raidState: {
      stageCode: snapshot.stageCode,
      loopIndex: snapshot.loopIndex,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: snapshot.encounters.main.stageCode,
          loopIndex: snapshot.encounters.main.loopIndex,
          bossName: snapshot.encounters.main.bossName,
          maxHp: snapshot.encounters.main.maxHp,
          remainingHp: snapshot.encounters.main.remainingHp
        },
        1: {
          encounterId: 1,
          stageCode: snapshot.encounters.prime1.stageCode,
          loopIndex: snapshot.encounters.prime1.loopIndex,
          bossName: snapshot.encounters.prime1.bossName,
          maxHp: skippedPrimes.get(snapshot.stageCode)?.has(1)
            ? 0
            : snapshot.encounters.prime1.maxHp,
          remainingHp: skippedPrimes.get(snapshot.stageCode)?.has(1)
            ? 0
            : snapshot.encounters.prime1.remainingHp
        },
        2: {
          encounterId: 2,
          stageCode: snapshot.encounters.prime2.stageCode,
          loopIndex: snapshot.encounters.prime2.loopIndex,
          bossName: snapshot.encounters.prime2.bossName,
          maxHp: skippedPrimes.get(snapshot.stageCode)?.has(2)
            ? 0
            : snapshot.encounters.prime2.maxHp,
          remainingHp: skippedPrimes.get(snapshot.stageCode)?.has(2)
            ? 0
            : snapshot.encounters.prime2.remainingHp
        }
      }
    },
    damageModel,
    battleRows: scopedRows,
    signalRows: scopedSignalRows,
    tokenRows,
    lookbackStartMs: effectiveSnapshotMs - args.lookbackDays * 86_400_000,
    signalLookbackStartMs: signalReferenceMs - args.lookbackDays * 86_400_000,
    signalReferenceMs,
    progressionConfig
  }
}

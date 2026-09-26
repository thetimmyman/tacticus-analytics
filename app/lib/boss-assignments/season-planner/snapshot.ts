import 'server-only'

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { SeasonRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import {
  getMainBossMaxHp,
  getPrimeBossMaxHp,
  type BossHpData,
  resolveBossHpKey
} from '@/app/lib/boss-assignments/season-planner/boss-hp'
import {
  makeTargetLabel,
  makeTargetUid,
  type EncounterId
} from '@/app/lib/boss-assignments/season-planner/identifiers'
import type {
  PlanFromNowEncounterSnapshot,
  PlanFromNowSnapshot
} from '@/app/lib/boss-assignments/season-planner/snapshot-types'
import {
  computeStageFromMainEncounter,
  deriveRarityAndSetFromStageCode as deriveRarityAndSet,
  deriveStageCodeFromSetAndRarity as deriveStageCode
} from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import {
  getStageSequence,
  type ProgressionConfig
} from '@/app/lib/boss-assignments/progression-config-shared'

type RawEncounterRow = {
  Name: string | null
  rarity: string | null
  set: number | null
  loopIndex: number | null
  maxHp: number | null
  remainingHp: number | null
  encounterId: number | null
  startedOn: string | null
  completedOn: string | null
  timestamp: string | null
}

const toNonNegativeInt = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.trunc(value))
}

const toNonNegativeHp = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return value
}

function findRotationBoss(
  rotation: SeasonRotationSnapshot | null,
  stageCode: string,
  encounterId: number
): { bossName: string } | null {
  const bosses = rotation?.currentBosses ?? []
  const match = bosses.find((boss) => {
    if (boss.encounter_id !== encounterId) return false
    const bossStage = deriveStageCode(boss.set ?? 0, boss.rarity ?? 'Legendary')
    return bossStage === stageCode
  })
  if (!match) return null
  return { bossName: match.canonical ?? match.boss_name }
}

const eventTimeMs = (row: RawEncounterRow): number => {
  const raw = row.completedOn ?? row.timestamp ?? row.startedOn
  if (!raw) return Number.NEGATIVE_INFINITY
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

const startedTimeMs = (row: RawEncounterRow): number => {
  if (!row.startedOn) return Number.NEGATIVE_INFINITY
  const ms = new Date(row.startedOn).getTime()
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

async function loadAsOfEncounterRow(args: {
  supabase: TypedSupabaseClient
  guildCode: string
  season: string
  snapshotAt: string
  encounterId: number
  stageIdentity?: { rarity: 'Legendary' | 'Mythic'; set: number } | null
  loopIndex?: number
}): Promise<{ row: RawEncounterRow | null; errorMessage: string | null }> {
  let query = args.supabase
    .from('EOT_GR_data')
    .select(
      'Name, rarity, set, loopIndex, maxHp, remainingHp, encounterId, startedOn, completedOn, timestamp'
    )
    .eq('Guild', args.guildCode)
    .eq('Season', args.season)
    .in('damageType', ['Battle', 'Bomb'])
    .eq('encounterId', args.encounterId)
    .lte('startedOn', args.snapshotAt)

  if (args.stageIdentity) {
    query = query
      .eq('rarity', args.stageIdentity.rarity)
      .eq('set', args.stageIdentity.set)
  }
  if (typeof args.loopIndex === 'number') {
    query = query.eq('loopIndex', args.loopIndex)
  }

  const { data, error } = await query
    .order('startedOn', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (error) {
    return { row: null, errorMessage: error.message }
  }

  const snapshotMs = new Date(args.snapshotAt).getTime()
  if (!Number.isFinite(snapshotMs)) return { row: null, errorMessage: null }

  const rows = Array.isArray(data) ? (data as RawEncounterRow[]) : []
  const row =
    rows
      .filter((candidate) => eventTimeMs(candidate) <= snapshotMs)
      .sort((a, b) => {
        const byEvent = eventTimeMs(b) - eventTimeMs(a)
        if (byEvent !== 0) return byEvent
        return startedTimeMs(b) - startedTimeMs(a)
      })[0] ?? null

  return { row, errorMessage: null }
}

function buildEncounterSnapshot(args: {
  seasonId: string | null
  stageCode: string
  loopIndex: number
  encounterId: EncounterId
  bossName: string
  maxHp: number
  remainingHp: number
  seededFromMax: boolean
  confidence: 'high' | 'low'
}): PlanFromNowEncounterSnapshot {
  const resolvedSeasonId = args.seasonId ?? 'unknown-season'
  const targetUid = makeTargetUid({
    seasonId: resolvedSeasonId,
    loopIndex: args.loopIndex,
    stageCode: args.stageCode,
    encounterId: args.encounterId
  })

  return {
    encounterId: args.encounterId,
    targetUid,
    targetLabel: makeTargetLabel(args.stageCode, args.encounterId),
    stageCode: args.stageCode,
    loopIndex: args.loopIndex,
    bossName: args.bossName,
    maxHp: args.maxHp,
    remainingHp: args.remainingHp,
    seededFromMax: args.seededFromMax,
    confidence: args.confidence
  }
}

export async function buildPlanFromNowSnapshot(args: {
  supabase: TypedSupabaseClient
  guildCode: string
  season: string
  seasonId: string | null
  snapshotAt: string
  bossHpData: BossHpData
  rotationSnapshot: SeasonRotationSnapshot | null
  preferAsOfStatus?: boolean
  progressionConfig: ProgressionConfig
}): Promise<PlanFromNowSnapshot> {
  const warnings: string[] = []
  let mainRow: RawEncounterRow | null = null

  if (args.preferAsOfStatus) {
    const { row, errorMessage } = await loadAsOfEncounterRow({
      supabase: args.supabase,
      guildCode: args.guildCode,
      season: args.season,
      snapshotAt: args.snapshotAt,
      encounterId: 0
    })

    if (errorMessage) {
      warnings.push(`Failed to load as-of boss status: ${errorMessage}`)
    } else {
      mainRow = row
    }
  } else {
    // Same RPC as the client hook so both halves of the page agree on the current boss.
    type StatusRow = {
      boss_name: string | null
      rarity: string | null
      set: number | null
      encounter_id: number | null
      max_hp: number | null
      remaining_hp: number | null
      loop_index: number | null
      completed_on: string | null
    }

    const { data: statusRows, error: statusError } = await args.supabase.rpc(
      'get_current_boss_status',
      { p_guild_code: args.guildCode, p_season: args.season }
    )

    if (statusError) {
      warnings.push(`Failed to load boss status: ${statusError.message}`)
    }

    const rpcRows: StatusRow[] = Array.isArray(statusRows)
      ? (statusRows as StatusRow[])
      : []
    const mainRpcRow = rpcRows.find((r) => (r.encounter_id ?? 0) === 0) ?? null

    mainRow = mainRpcRow
      ? {
          Name: mainRpcRow.boss_name,
          rarity: mainRpcRow.rarity,
          set: mainRpcRow.set,
          loopIndex: mainRpcRow.loop_index,
          maxHp: mainRpcRow.max_hp,
          remainingHp: mainRpcRow.remaining_hp ?? 0,
          encounterId: mainRpcRow.encounter_id,
          startedOn: mainRpcRow.completed_on,
          completedOn: mainRpcRow.completed_on,
          timestamp: mainRpcRow.completed_on
        }
      : null
  }
  const baseLoopIndex = toNonNegativeInt(mainRow?.loopIndex, 0)
  // Seed from the season's own ladder: a season can restart at L4.
  const baseSequence = getStageSequence(args.progressionConfig, baseLoopIndex)
  const firstStage = baseSequence[0]
  if (!firstStage) {
    throw new Error(`Progression sequence is empty for loop ${baseLoopIndex}`)
  }
  const baseStageCode =
    mainRow?.rarity && typeof mainRow.set === 'number'
      ? deriveStageCode(mainRow.set, mainRow.rarity)
      : firstStage
  const baseStageIdentity = deriveRarityAndSet(baseStageCode)
  const baseRotationMainBoss = findRotationBoss(
    args.rotationSnapshot,
    baseStageCode,
    0
  )
  const baseMainBossName =
    baseRotationMainBoss?.bossName ?? mainRow?.Name ?? 'UnknownBoss'
  const baseMainMaxHp =
    getMainBossMaxHp(args.bossHpData, baseMainBossName, baseStageCode) ?? 0
  const baseMainRemainingHp = !mainRow
    ? baseMainMaxHp
    : Math.min(
        baseMainMaxHp || Number.MAX_SAFE_INTEGER,
        toNonNegativeHp(mainRow.remainingHp, baseMainMaxHp)
      )

  let prime1Row: RawEncounterRow | null = null
  let prime2Row: RawEncounterRow | null = null

  if (mainRow && baseStageIdentity) {
    const [prime1Result, prime2Result] = await Promise.all([
      loadAsOfEncounterRow({
        supabase: args.supabase,
        guildCode: args.guildCode,
        season: args.season,
        snapshotAt: args.snapshotAt,
        encounterId: 1,
        stageIdentity: baseStageIdentity,
        loopIndex: baseLoopIndex
      }),
      loadAsOfEncounterRow({
        supabase: args.supabase,
        guildCode: args.guildCode,
        season: args.season,
        snapshotAt: args.snapshotAt,
        encounterId: 2,
        stageIdentity: baseStageIdentity,
        loopIndex: baseLoopIndex
      })
    ])

    if (prime1Result.errorMessage) {
      warnings.push(
        `Failed to load prime1 snapshot: ${prime1Result.errorMessage}`
      )
    } else {
      prime1Row = prime1Result.row
    }

    if (prime2Result.errorMessage) {
      warnings.push(
        `Failed to load prime2 snapshot: ${prime2Result.errorMessage}`
      )
    } else {
      prime2Row = prime2Result.row
    }
  }

  const basePrime1MaxHp =
    getPrimeBossMaxHp(args.bossHpData, baseMainBossName, baseStageCode, 1) ?? 0
  const basePrime2MaxHp =
    getPrimeBossMaxHp(args.bossHpData, baseMainBossName, baseStageCode, 2) ?? 0

  const basePrime1RemainingHp = prime1Row
    ? Math.min(
        basePrime1MaxHp || Number.MAX_SAFE_INTEGER,
        toNonNegativeHp(prime1Row.remainingHp, basePrime1MaxHp)
      )
    : basePrime1MaxHp
  const basePrime2RemainingHp = prime2Row
    ? Math.min(
        basePrime2MaxHp || Number.MAX_SAFE_INTEGER,
        toNonNegativeHp(prime2Row.remainingHp, basePrime2MaxHp)
      )
    : basePrime2MaxHp

  const encounterActive = (maxHp: number, remainingHp: number): boolean =>
    maxHp > 0 && remainingHp > 0
  const stageFullyCleared =
    Boolean(mainRow) &&
    !encounterActive(baseMainMaxHp, baseMainRemainingHp) &&
    !encounterActive(basePrime1MaxHp, basePrime1RemainingHp) &&
    !encounterActive(basePrime2MaxHp, basePrime2RemainingHp)

  const stage = stageFullyCleared
    ? computeStageFromMainEncounter(mainRow, args.progressionConfig)
    : {
        stageCode: baseStageCode,
        loopIndex: baseLoopIndex,
        advancedStage: false
      }
  const stageCode = stage.stageCode
  const loopIndex = stage.loopIndex
  const advancedStage = stage.advancedStage

  const rotationMainBoss = findRotationBoss(args.rotationSnapshot, stageCode, 0)
  const mainBossName = advancedStage
    ? (rotationMainBoss?.bossName ?? mainRow?.Name ?? 'UnknownBoss')
    : baseMainBossName

  const bossHpKey = resolveBossHpKey(mainBossName)
  if (!bossHpKey) {
    warnings.push(
      `Unknown boss HP key for ${mainBossName}; falling back to average HP tables`
    )
  }

  const mainMaxHp = advancedStage
    ? (getMainBossMaxHp(args.bossHpData, mainBossName, stageCode) ?? 0)
    : baseMainMaxHp
  const mainRemainingHp = advancedStage ? mainMaxHp : baseMainRemainingHp

  const prime1Rotation = findRotationBoss(args.rotationSnapshot, stageCode, 1)
  const prime2Rotation = findRotationBoss(args.rotationSnapshot, stageCode, 2)
  const prime1MaxHp = advancedStage
    ? (getPrimeBossMaxHp(args.bossHpData, mainBossName, stageCode, 1) ?? 0)
    : basePrime1MaxHp
  const prime2MaxHp = advancedStage
    ? (getPrimeBossMaxHp(args.bossHpData, mainBossName, stageCode, 2) ?? 0)
    : basePrime2MaxHp
  const prime1RemainingHp = advancedStage ? prime1MaxHp : basePrime1RemainingHp
  const prime2RemainingHp = advancedStage ? prime2MaxHp : basePrime2RemainingHp
  if (advancedStage) {
    prime1Row = null
    prime2Row = null
  }

  const mainSnapshot = buildEncounterSnapshot({
    seasonId: args.seasonId,
    stageCode,
    loopIndex,
    encounterId: 0,
    bossName: mainBossName,
    maxHp: mainMaxHp,
    remainingHp: mainRemainingHp,
    seededFromMax: advancedStage || !mainRow,
    confidence: mainRow ? 'high' : 'low'
  })

  const prime1Snapshot = buildEncounterSnapshot({
    seasonId: args.seasonId,
    stageCode,
    loopIndex,
    encounterId: 1,
    bossName:
      prime1Row?.Name ?? prime1Rotation?.bossName ?? `${mainBossName}_Prime1`,
    maxHp: prime1MaxHp,
    remainingHp: prime1RemainingHp,
    seededFromMax: !prime1Row,
    confidence: prime1Row ? 'high' : 'low'
  })

  const prime2Snapshot = buildEncounterSnapshot({
    seasonId: args.seasonId,
    stageCode,
    loopIndex,
    encounterId: 2,
    bossName:
      prime2Row?.Name ?? prime2Rotation?.bossName ?? `${mainBossName}_Prime2`,
    maxHp: prime2MaxHp,
    remainingHp: prime2RemainingHp,
    seededFromMax: !prime2Row,
    confidence: prime2Row ? 'high' : 'low'
  })

  return {
    snapshotAt: args.snapshotAt,
    guildCode: args.guildCode,
    season: args.season,
    seasonId: args.seasonId,
    stageCode,
    loopIndex,
    advancedStage,
    encounters: {
      main: mainSnapshot,
      prime1: prime1Snapshot,
      prime2: prime2Snapshot
    },
    warnings
  }
}

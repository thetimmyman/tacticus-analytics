import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import 'server-only'

import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'lib.boss-assignments.season-planner.generate-season-plan'
)
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import {
  GLOBAL_CONFIG,
  FIRST_SEASON_START_MS,
  SEASON_DURATION_SECONDS,
  SEASON_NUMBER_OFFSET
} from '@/app/lib/loki/season-configs'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { buildPlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot'
import { resolvePlanningRotation } from '@/app/lib/boss-assignments/season-planner/planning-rotation'
import { computeSeasonWindowMs } from '@/app/lib/boss-assignments/season-planner/season-window'
import type { PlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot-types'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import {
  computeRemainingBossSequence,
  type BossStageEntry
} from '@/app/lib/boss-assignments/season-sequence'
import { inferHourlyAvailability } from '@/app/lib/boss-assignments/season-planner/availability'
import {
  generateSessions,
  pickSessionTemplates
} from '@/app/lib/boss-assignments/season-planner/sessions'
import {
  buildDamageModel,
  computeMeanDamagePerBattle,
  computeRosterEncounterDamagePerToken,
  estimateDamage,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import { loadPlanTargetSignalsForSeason } from '@/app/lib/boss-assignments/resolve-officer-targets'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import {
  planSeason,
  type PlannerPlayer,
  type PlannerResult,
  type RaidState,
  type StageTemplate
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import {
  getTokenAvailability,
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS,
  SEASON_MAX_SPENDABLE_TOKENS
} from '@/app/lib/calculations/token-calculation'
import {
  computeSeasonTokenAggregates,
  type PlayerTokenPaceRow
} from '@/app/lib/season-forecast/season-token-economy'
import type { EOTGRData } from '@tacticus/app-core/types'

type MemberRow = {
  player_id: string
  display_name: string
}

type BattleQueryRow = Pick<
  EOTGRData,
  | 'userId'
  | 'displayName'
  | 'damageType'
  | 'startedOn'
  | 'damageDealt'
  | 'Name'
  | 'encounterId'
  | 'rarity'
  | 'set'
  | 'Season'
>

type BattleRow = Omit<
  BattleQueryRow,
  'userId' | 'displayName' | 'startedOn'
> & {
  userId: string
  displayName: string
  startedOn: string
}

const hasPlanningBattleIdentity = (row: BattleQueryRow): row is BattleRow =>
  Boolean(row.userId && row.displayName && row.startedOn)

export interface GeneratedSeasonPlanPayload {
  season: string
  season_id: string | null
  season_start_at: string
  season_end_at: string
  snapshot_at: string
  time_zone: string
  lookback_days: number
  sessions_per_day: number
  snapshot: PlanFromNowSnapshot
  plan: PlannerResult
  remainingBossSequence?: BossStageEntry[]
  /** Battle attacks only (no bombs). */
  tokens_used_this_season: number
  tokens_remaining_spendable: number
  tokens_projected_waste: number
  players_at_cap_risk: number
  member_count: number
  /** PRIVACY: identifies members; member-facing consumers must see only the caller's row. */
  per_player_pace?: PlayerTokenPaceRow[]
}

export async function generateSeasonPlanForGuild(args: {
  guildCode: string
  season: string
  snapshotAt: string
  lookbackDays: number
  sessionsPerDay: number
  timeZone?: string | null
  optionalSpendMinHpMultiplier?: number
  configId?: string | null
}): Promise<GeneratedSeasonPlanPayload> {
  const requestedSnapshotDate = new Date(args.snapshotAt)
  const requestedSnapshotMs = requestedSnapshotDate.getTime()
  if (!Number.isFinite(requestedSnapshotMs)) {
    throw new Error('Invalid snapshotAt timestamp')
  }

  const seasonNumber = Number.parseInt(args.season, 10)
  if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
    throw new Error('Invalid season number')
  }

  const misc = GLOBAL_CONFIG?.guildBoss?.misc ?? {}
  const bufferAfterSeasonEnd =
    typeof misc.bufferAfterSeasonEnd === 'number'
      ? misc.bufferAfterSeasonEnd
      : 86_400
  // The inter-season gap is baked into the start; without it both boundaries land 24h early.
  const { seasonStartMs, seasonEndMs } = computeSeasonWindowMs(seasonNumber, {
    firstSeasonStartMs: FIRST_SEASON_START_MS,
    seasonDurationSeconds: SEASON_DURATION_SECONDS,
    bufferAfterSeasonEndSeconds: bufferAfterSeasonEnd,
    seasonNumberOffset: SEASON_NUMBER_OFFSET
  })
  const boundedSeasonEndMs = Math.max(seasonStartMs, seasonEndMs - 1)
  const effectiveSnapshotMs = Math.min(
    Math.max(requestedSnapshotMs, seasonStartMs),
    boundedSeasonEndMs
  )
  const snapshotDate = new Date(effectiveSnapshotMs)
  const effectiveSnapshotAt = snapshotDate.toISOString()

  const season_start_at = new Date(seasonStartMs).toISOString()
  const season_end_at = new Date(seasonEndMs).toISOString()

  const service = serviceDb()

  let time_zone = args.timeZone ?? null
  if (args.timeZone === undefined) {
    const { data: guildConfig, error: guildConfigError } = await service
      .from('guild_config')
      .select('timezone')
      .eq('guild_code', args.guildCode)
      .maybeSingle()

    if (guildConfigError) {
      logger.warn(
        {
          guildCode: args.guildCode,
          error: guildConfigError.message
        },
        'Failed to resolve guild timezone; defaulting to UTC'
      )
    }

    time_zone = guildConfig?.timezone ?? 'UTC'
  }
  time_zone = time_zone ?? 'UTC'

  const [bossHpData, liveRotation, { skippedPrimes, officerTargets }] =
    await Promise.all([
      getAllBossHp(args.guildCode),
      ensureRotationSnapshot(),
      loadPlanTargetSignalsForSeason(service, args.guildCode, args.season)
    ])

  const seasonConfig = getSeasonConfigForSeasonNumber(seasonNumber)
  const { rotation: rotationSnapshot, seasonId: season_id } =
    resolvePlanningRotation({
      configId: args.configId,
      seasonConfig,
      liveRotation
    })

  const progressionConfig = await getActiveProgressionConfig(
    args.guildCode,
    seasonNumber
  )

  const snapshot = await buildPlanFromNowSnapshot({
    supabase: service,
    guildCode: args.guildCode,
    season: args.season,
    seasonId: season_id,
    snapshotAt: effectiveSnapshotAt,
    bossHpData,
    rotationSnapshot,
    preferAsOfStatus: true,
    progressionConfig
  })

  const { data: members, error: memberError } = await guildRosterQuery(
    service,
    args.guildCode,
    'player_id, display_name'
  ).order('display_name')

  if (memberError) {
    throw new Error(`Failed to load guild roster: ${memberError.message}`)
  }

  const currentMembers = ((members ?? []) as MemberRow[]).filter(
    (member) =>
      typeof member.player_id === 'string' && member.player_id.length > 0
  )
  const rosterIds = new Set(currentMembers.map((member) => member.player_id))
  const rosterPlayerIds = [...rosterIds]

  const previousSeason = seasonNumber > 1 ? String(seasonNumber - 1) : null
  const seasonsToQuery = previousSeason
    ? [args.season, previousSeason]
    : [args.season]

  const { data: battleRows, error: battlesError } = await service
    // eot-gr-data-requires-order: .order('startedOn', desc) is on the chain below
    .from('EOT_GR_data')
    .select(
      'userId, displayName, damageType, startedOn, damageDealt, Name, encounterId, rarity, set, Season'
    )
    .eq('Guild', args.guildCode)
    .in('Season', seasonsToQuery)
    .in('damageType', ['Battle', 'Bomb'])
    // DESC so a PGRST_DB_MAX_ROWS cap drops the oldest rows first.
    .order('startedOn', { ascending: false })

  if (battlesError) {
    throw new Error(`Failed to load battle history: ${battlesError.message}`)
  }

  const battles = (battleRows ?? []).filter(hasPlanningBattleIdentity)

  const lookbackStartMs =
    snapshotDate.getTime() - args.lookbackDays * 86_400_000

  const availabilityEventsByPlayer = new Map<string, string[]>()
  const battlesByPlayer = new Map<string, BattleRow[]>()

  for (const row of battles) {
    if (!battlesByPlayer.has(row.userId)) {
      battlesByPlayer.set(row.userId, [])
    }
    battlesByPlayer.get(row.userId)!.push(row)

    const startedMs = new Date(row.startedOn).getTime()
    if (
      Number.isFinite(startedMs) &&
      startedMs >= lookbackStartMs &&
      startedMs <= snapshotDate.getTime()
    ) {
      if (!availabilityEventsByPlayer.has(row.userId)) {
        availabilityEventsByPlayer.set(row.userId, [])
      }
      availabilityEventsByPlayer.get(row.userId)!.push(row.startedOn)
    }
  }

  const damageRecords: DamageRecord[] = battles
    .filter((row) => {
      const startedMs = new Date(row.startedOn).getTime()
      return (
        row.damageType === 'Battle' &&
        typeof row.damageDealt === 'number' &&
        row.damageDealt > 0 &&
        Number.isFinite(startedMs) &&
        startedMs <= snapshotDate.getTime()
      )
    })
    .map((row) => ({
      playerId: row.userId,
      bossName: row.Name ?? 'UnknownBoss',
      encounterId: row.encounterId ?? 0,
      rarity: row.rarity ?? null,
      set: row.set ?? null,
      startedOn: row.startedOn,
      damageDealt: row.damageDealt ?? 0
    }))

  const damageModel = buildDamageModel(damageRecords, {
    referenceAt: effectiveSnapshotAt
  })

  // Must not be 0, or every stage renders as 'hard' / 0 tokens.
  const guildAvgTokenDamage = computeMeanDamagePerBattle(damageRecords)

  const remainingBossSequence = computeRemainingBossSequence({
    progressionConfig,
    currentStageCode: snapshot.stageCode,
    currentLoopIndex: snapshot.loopIndex,
    seasonBosses: rotationSnapshot?.currentBosses ?? [],
    bossHpData,
    guildAvgDamage: guildAvgTokenDamage,
    currentStageHp: {
      mainRemainingHp: snapshot.encounters.main.remainingHp,
      prime1RemainingHp: snapshot.encounters.prime1.remainingHp,
      prime2RemainingHp: snapshot.encounters.prime2.remainingHp
    },
    skippedPrimes,
    encounterDamagePerToken: (target) =>
      computeRosterEncounterDamagePerToken(
        damageModel,
        rosterPlayerIds,
        target
      ),
    // Budget only; the sim books tokens against real HP.
    officerTargets
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

  const stamina = {
    max: MAX_TOKENS,
    regenerationSeconds: TWELVE_HOURS_IN_SECONDS,
    amountPerTick: 1
  }

  const usedByPlayer = new Map<string, number>()
  const recentByPlayer = new Map<string, number>()
  for (const row of battles) {
    if (row.damageType !== 'Battle') continue
    if (String(row.Season) !== String(seasonNumber)) continue
    if (!rosterIds.has(row.userId)) continue
    const startedMs = new Date(row.startedOn).getTime()
    if (!Number.isFinite(startedMs) || startedMs > snapshotDate.getTime()) {
      continue
    }
    usedByPlayer.set(row.userId, (usedByPlayer.get(row.userId) ?? 0) + 1)
    if (startedMs >= lookbackStartMs && startedMs <= snapshotDate.getTime()) {
      recentByPlayer.set(row.userId, (recentByPlayer.get(row.userId) ?? 0) + 1)
    }
  }

  const players: PlannerPlayer[] = currentMembers.map((member) => {
    const playerBattles = (battlesByPlayer.get(member.player_id) ?? []).filter(
      (battle) => {
        const startedMs = new Date(battle.startedOn).getTime()
        return (
          String(battle.Season) === String(seasonNumber) &&
          Number.isFinite(startedMs) &&
          startedMs >= seasonStartMs &&
          startedMs <= snapshotDate.getTime()
        )
      }
    )
    const battleData = playerBattles.map((battle) => ({
      displayName: battle.displayName,
      damageType: (battle.damageType === 'Bomb' ? 'Bomb' : 'Battle') as
        'Battle' | 'Bomb',
      startedOn: battle.startedOn
    }))

    const tokenAvailability = getTokenAvailability(
      null,
      battleData,
      new Date(season_start_at),
      snapshotDate
    )

    const nextSeconds =
      typeof tokenAvailability.tokenNextSeconds === 'number' &&
      Number.isFinite(tokenAvailability.tokenNextSeconds)
        ? Math.max(0, Math.floor(tokenAvailability.tokenNextSeconds))
        : stamina.regenerationSeconds

    const tokenState = {
      available: Math.max(
        0,
        Math.min(stamina.max, Math.floor(tokenAvailability.tokensAvailable))
      ),
      nextRegenAt:
        tokenAvailability.tokensAvailable >= stamina.max
          ? null
          : snapshotDate.getTime() + nextSeconds * 1000
    }

    const availability = inferHourlyAvailability({
      timeZone: time_zone ?? 'UTC',
      observedDays: args.lookbackDays,
      eventTimestamps: availabilityEventsByPlayer.get(member.player_id) ?? []
    })

    const templates = pickSessionTemplates({
      windows: availability.windows,
      maxPerDay: args.sessionsPerDay
    })

    const sessions = generateSessions({
      seasonStartAt: effectiveSnapshotAt,
      seasonEndAt: season_end_at,
      timeZone: time_zone ?? 'UTC',
      templates
    })

    return {
      playerId: member.player_id,
      displayName: member.display_name ?? member.player_id,
      sessionsAt: sessions
        .map((s) => new Date(s.at).getTime())
        .filter((ms) => Number.isFinite(ms)),
      tokenState,
      seasonSpent: usedByPlayer.get(member.player_id) ?? 0
    }
  })

  const secondsRemaining = Math.max(
    0,
    (seasonEndMs - snapshotDate.getTime()) / 1000
  )
  const regenToEnd = Math.floor(secondsRemaining / TWELVE_HOURS_IN_SECONDS)
  // Current-season battles only, so the window is the season's age, not the lookback.
  const seasonAgeDays = (snapshotDate.getTime() - seasonStartMs) / 86_400_000
  const rateWindowDays = Math.min(args.lookbackDays, Math.max(1, seasonAgeDays))
  const economy = computeSeasonTokenAggregates({
    players: players.map((p) => ({
      bank: p.tokenState.available,
      usedThisSeason: usedByPlayer.get(p.playerId) ?? 0,
      recentBattleCount: recentByPlayer.get(p.playerId) ?? 0,
      playerId: p.playerId,
      displayName: p.displayName
    })),
    regenToEnd,
    daysRemaining: secondsRemaining / 86_400,
    rateWindowDays,
    seasonMaxTokens: SEASON_MAX_SPENDABLE_TOKENS,
    regenPerDay: 86_400 / TWELVE_HOURS_IN_SECONDS
  })
  const member_count = economy.memberCount
  const tokens_used_this_season = economy.tokensUsed
  const tokens_remaining_spendable = economy.tokensRemaining
  const tokens_projected_waste = economy.projectedWaste
  const players_at_cap_risk = economy.playersAtCapRisk

  // The current stage comes from the snapshot, so zero skipped primes here too.
  const currentStageSkips = skippedPrimes.get(snapshot.stageCode)
  const raidState: RaidState = {
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
        maxHp: currentStageSkips?.has(1) ? 0 : snapshot.encounters.prime1.maxHp,
        remainingHp: currentStageSkips?.has(1)
          ? 0
          : snapshot.encounters.prime1.remainingHp
      },
      2: {
        encounterId: 2,
        stageCode: snapshot.encounters.prime2.stageCode,
        loopIndex: snapshot.encounters.prime2.loopIndex,
        bossName: snapshot.encounters.prime2.bossName,
        maxHp: currentStageSkips?.has(2) ? 0 : snapshot.encounters.prime2.maxHp,
        remainingHp: currentStageSkips?.has(2)
          ? 0
          : snapshot.encounters.prime2.remainingHp
      }
    }
  }

  const plan = planSeason({
    players,
    initialRaidState: raidState,
    stageTemplates,
    options: {
      snapshotAt: snapshotDate.getTime(),
      seasonEndAt: seasonEndMs,
      stamina,
      optionalSpendMinHpMultiplier: args.optionalSpendMinHpMultiplier ?? 1.25,
      seasonMaxTokens: SEASON_MAX_SPENDABLE_TOKENS
    },
    estimateDamage: ({ playerId, encounter }) => {
      const est = estimateDamage(damageModel, {
        playerId,
        bossName: encounter.bossName,
        stageCode: encounter.stageCode,
        encounterId: encounter.encounterId
      })
      return est.expectedDamage ?? 0
    },
    progressionConfig
  })

  return {
    season: args.season,
    season_id,
    season_start_at,
    season_end_at,
    snapshot_at: effectiveSnapshotAt,
    time_zone: time_zone ?? 'UTC',
    lookback_days: args.lookbackDays,
    sessions_per_day: args.sessionsPerDay,
    snapshot,
    plan,
    remainingBossSequence,
    tokens_used_this_season,
    tokens_remaining_spendable,
    tokens_projected_waste,
    players_at_cap_risk,
    member_count,
    per_player_pace: economy.players
  }
}

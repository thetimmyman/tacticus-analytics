import 'server-only'

import { inferHourlyAvailability } from '@/app/lib/boss-assignments/season-planner/availability'
import {
  generateSessions,
  pickSessionTemplates
} from '@/app/lib/boss-assignments/season-planner/sessions'
import {
  planSeason,
  type PlannerPlayer,
  type PlannerResult
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import { estimateDamage } from '@/app/lib/boss-assignments/season-planner/damage-model'
import {
  getTokenAvailability,
  MAX_TOKENS,
  SEASON_MAX_SPENDABLE_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import { computeSeasonTokenAggregates } from '@/app/lib/season-forecast/season-token-economy'
import {
  summarizeMemberContributions,
  summarizePlannerResult,
  type StrategyMemberContribution,
  type StrategyPlanDelta,
  type StrategyPlanSummary
} from '@/app/lib/boss-assignments/season-planner/roster-strategy-core'
import { OPTIMIZER_EVALUATION_MULTIPLIER, aggregateSummaries } from './shared'
import { estimatePersonalDamage } from './projection-context'
import type {
  ProjectionContext,
  RosterStrategyMember,
  RosterStrategyProjection,
  StrategyBattleRow
} from './types'

const buildPlannerPlayers = (args: {
  members: RosterStrategyMember[]
  context: ProjectionContext
  lookbackDays: number
  sessionsPerDay: number
}): PlannerPlayer[] => {
  const snapshotMs = new Date(args.context.snapshotAt).getTime()
  const battleRowsByPlayer = new Map<string, StrategyBattleRow[]>()
  const tokenRowsByPlayer = new Map<string, StrategyBattleRow[]>()
  const availabilityEventsByPlayer = new Map<string, string[]>()
  const usedThisSeasonByPlayer = new Map<string, number>()

  for (const row of args.context.battleRows) {
    if (!battleRowsByPlayer.has(row.userId))
      battleRowsByPlayer.set(row.userId, [])
    battleRowsByPlayer.get(row.userId)!.push(row)
    if (
      row.damageType === 'Battle' &&
      String(row.Season) === args.context.season
    ) {
      usedThisSeasonByPlayer.set(
        row.userId,
        (usedThisSeasonByPlayer.get(row.userId) ?? 0) + 1
      )
    }
  }

  for (const row of args.context.tokenRows) {
    if (!tokenRowsByPlayer.has(row.userId))
      tokenRowsByPlayer.set(row.userId, [])
    tokenRowsByPlayer.get(row.userId)!.push(row)
  }

  for (const row of args.context.signalRows) {
    const startedMs = new Date(row.startedOn).getTime()
    if (
      Number.isFinite(startedMs) &&
      startedMs >= args.context.signalLookbackStartMs &&
      startedMs <= args.context.signalReferenceMs
    ) {
      const list = availabilityEventsByPlayer.get(row.userId) ?? []
      list.push(row.startedOn)
      availabilityEventsByPlayer.set(row.userId, list)
    }
  }

  const stamina = {
    max: MAX_TOKENS,
    regenerationSeconds: TWELVE_HOURS_IN_SECONDS,
    amountPerTick: 1
  }

  return args.members.map((member) => {
    const playerBattles = tokenRowsByPlayer.get(member.playerId) ?? []
    const battleData = playerBattles.map((battle) => ({
      displayName: battle.displayName ?? member.displayName,
      damageType: (battle.damageType === 'Bomb' ? 'Bomb' : 'Battle') as
        'Battle' | 'Bomb',
      startedOn: battle.startedOn
    }))

    const tokenAvailability = getTokenAvailability(
      null,
      battleData,
      new Date(args.context.seasonStartAt),
      new Date(args.context.snapshotAt)
    )

    const nextSeconds =
      typeof tokenAvailability.tokenNextSeconds === 'number' &&
      Number.isFinite(tokenAvailability.tokenNextSeconds)
        ? Math.max(0, Math.floor(tokenAvailability.tokenNextSeconds))
        : stamina.regenerationSeconds

    const availability = inferHourlyAvailability({
      timeZone: args.context.timeZone,
      observedDays: args.lookbackDays,
      eventTimestamps: availabilityEventsByPlayer.get(member.playerId) ?? []
    })
    const templates = pickSessionTemplates({
      windows: availability.windows,
      maxPerDay: args.sessionsPerDay
    })
    const sessions = generateSessions({
      seasonStartAt: args.context.snapshotAt,
      seasonEndAt: args.context.seasonEndAt,
      timeZone: args.context.timeZone,
      templates
    })

    return {
      playerId: member.playerId,
      displayName: member.displayName,
      sessionsAt: sessions
        .map((session) => new Date(session.at).getTime())
        .filter((ms) => Number.isFinite(ms)),
      tokenState: {
        available: Math.max(
          0,
          Math.min(stamina.max, Math.floor(tokenAvailability.tokensAvailable))
        ),
        nextRegenAt:
          tokenAvailability.tokensAvailable >= stamina.max
            ? null
            : snapshotMs + nextSeconds * 1000
      },
      seasonSpent: usedThisSeasonByPlayer.get(member.playerId) ?? 0
    }
  })
}

const computeTokenEconomy = (args: {
  context: ProjectionContext
  players: PlannerPlayer[]
  lookbackDays: number
}) => {
  const snapshotMs = new Date(args.context.snapshotAt).getTime()
  const secondsRemaining = Math.max(
    0,
    (args.context.seasonEndMs - snapshotMs) / 1000
  )
  const regenToEnd = Math.floor(secondsRemaining / TWELVE_HOURS_IN_SECONDS)
  const rosterIds = new Set(args.players.map((player) => player.playerId))
  const usedByPlayer = new Map<string, number>()
  const recentByPlayer = new Map<string, number>()

  for (const row of args.context.battleRows) {
    if (row.damageType !== 'Battle') continue
    if (String(row.Season) !== args.context.season) continue
    if (!rosterIds.has(row.userId)) continue
    usedByPlayer.set(row.userId, (usedByPlayer.get(row.userId) ?? 0) + 1)
  }

  for (const row of args.context.signalRows) {
    if (row.damageType !== 'Battle') continue
    if (!rosterIds.has(row.userId)) continue
    const startedMs = new Date(row.startedOn).getTime()
    if (
      Number.isFinite(startedMs) &&
      startedMs >= args.context.signalLookbackStartMs &&
      startedMs <= args.context.signalReferenceMs
    ) {
      recentByPlayer.set(row.userId, (recentByPlayer.get(row.userId) ?? 0) + 1)
    }
  }

  const seasonAgeDays = (snapshotMs - args.context.seasonStartMs) / 86_400_000
  const rateWindowDays = Math.min(args.lookbackDays, Math.max(1, seasonAgeDays))

  return computeSeasonTokenAggregates({
    players: args.players.map((player) => ({
      bank: player.tokenState.available,
      usedThisSeason: usedByPlayer.get(player.playerId) ?? 0,
      recentBattleCount: recentByPlayer.get(player.playerId) ?? 0
    })),
    regenToEnd,
    daysRemaining: secondsRemaining / 86_400,
    rateWindowDays,
    seasonMaxTokens: SEASON_MAX_SPENDABLE_TOKENS,
    regenPerDay: 86_400 / TWELVE_HOURS_IN_SECONDS
  })
}

const projectContext = (args: {
  guildCode: string
  context: ProjectionContext
  members: RosterStrategyMember[]
  lookbackDays: number
  sessionsPerDay: number
}): { result: PlannerResult; summary: StrategyPlanSummary } => {
  const players = buildPlannerPlayers({
    members: args.members,
    context: args.context,
    lookbackDays: args.lookbackDays,
    sessionsPerDay: args.sessionsPerDay
  })
  const economy = computeTokenEconomy({
    context: args.context,
    players,
    lookbackDays: args.lookbackDays
  })

  const result = planSeason({
    players,
    initialRaidState: args.context.raidState,
    stageTemplates: args.context.stageTemplates,
    options: {
      snapshotAt: new Date(args.context.snapshotAt).getTime(),
      seasonEndAt: args.context.seasonEndMs,
      stamina: {
        max: MAX_TOKENS,
        regenerationSeconds: TWELVE_HOURS_IN_SECONDS,
        amountPerTick: 1
      },
      optionalSpendMinHpMultiplier: 1.25,
      seasonMaxTokens: SEASON_MAX_SPENDABLE_TOKENS
    },
    estimateDamage: ({ playerId, encounter }) => {
      // Full cascade: player_target alone projects 0 without per-boss history.
      const est = estimateDamage(args.context.damageModel, {
        playerId,
        bossName: encounter.bossName,
        stageCode: encounter.stageCode,
        encounterId: encounter.encounterId
      })
      return est.expectedDamage ?? 0
    },
    progressionConfig: args.context.progressionConfig
  })

  return {
    result,
    summary: summarizePlannerResult({
      guildCode: args.guildCode,
      memberCount: args.members.length,
      result,
      tokensRemainingSpendable: economy.tokensRemaining
    })
  }
}

export const summarizeProjectionContributions = (
  results: PlannerResult[]
): StrategyMemberContribution[] => {
  const allSessions = results.flatMap((result) => result.sessions)
  return allSessions.length > 0 ? summarizeMemberContributions(allSessions) : []
}

export const projectGuildWindow = (args: {
  guildCode: string
  contexts: ProjectionContext[]
  members: RosterStrategyMember[]
  lookbackDays: number
  sessionsPerDay: number
}): RosterStrategyProjection => {
  const seasonRows = args.contexts.map((context) => {
    const projected = projectContext({
      guildCode: args.guildCode,
      context,
      members: args.members,
      lookbackDays: args.lookbackDays,
      sessionsPerDay: args.sessionsPerDay
    })
    return {
      season: context.season,
      seasonId: context.seasonId,
      summary: projected.summary,
      result: projected.result
    }
  })

  return {
    guildCode: args.guildCode,
    aggregate: aggregateSummaries(
      args.guildCode,
      seasonRows.map((row) => row.summary)
    ),
    seasons: seasonRows.map(({ result: _result, ...row }) => row),
    contributions: summarizeProjectionContributions(
      seasonRows.map((row) => row.result)
    )
  }
}

export const candidateFit = (
  candidate: RosterStrategyMember,
  contexts: ProjectionContext[]
): { fitDamage: number; sampleCount: number } => {
  let damageSum = 0
  let sampleCount = 0

  for (const context of contexts) {
    for (const stage of context.remainingBossSequence.slice(0, 10)) {
      for (const encounter of [
        stage.encounters.main,
        stage.encounters.prime1,
        stage.encounters.prime2
      ]) {
        if (!encounter) continue
        if (encounter.skipped) continue
        const est = estimatePersonalDamage(context.damageModel, {
          playerId: candidate.playerId,
          bossName: encounter.bossName,
          stageCode: stage.stageCode,
          encounterId:
            encounter === stage.encounters.main
              ? 0
              : encounter === stage.encounters.prime1
                ? 1
                : 2
        })
        if (est?.expectedDamage != null && est.expectedDamage > 0) {
          damageSum += est.expectedDamage
          sampleCount += est.sampleCount
        }
      }
    }
  }

  return {
    fitDamage: Math.round(damageSum),
    sampleCount
  }
}

export const replaceMember = (
  members: RosterStrategyMember[],
  outgoingPlayerId: string,
  incoming: RosterStrategyMember
) =>
  members.map((member) =>
    member.playerId === outgoingPlayerId ? incoming : member
  )

export const optimizerEvaluationBudget = (optimizerLimit: number): number =>
  Math.max(1, optimizerLimit) * OPTIMIZER_EVALUATION_MULTIPLIER

export const isOptimizerDeltaBeneficial = (delta: StrategyPlanDelta): boolean =>
  delta.score > 0 &&
  delta.bossesDefeated >= 0 &&
  delta.loopAdvances >= 0 &&
  delta.appliedDamage >= 0 &&
  delta.expectedDamage >= 0 &&
  (delta.bossesDefeated > 0 ||
    delta.loopAdvances > 0 ||
    delta.appliedDamage > 0 ||
    delta.expectedDamage > 0)
